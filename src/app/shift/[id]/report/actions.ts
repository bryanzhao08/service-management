"use server";

import { revalidatePath } from "next/cache";
import { can, requireUnlockedActor } from "@/lib/auth/guards";
import { record as recordAudit } from "@/lib/db/audit";
import { clearGalleryToken } from "@/lib/db/reports";
import { db } from "@/lib/db/scoped";
import { receiptClaims, signReceiptToken } from "@/lib/storage/tokens";

/**
 * Mints the signed `/r/[token]` URL from section 9.5.
 *
 * A server action rather than a value rendered into the page because a receipt
 * link is a bearer credential: anyone holding it can read who the report went
 * to. Minting it on demand means it only exists once someone deliberately asks
 * for it, instead of sitting in the HTML of every receipt page for anyone who
 * views source.
 *
 * The scoped read is the authorisation. `findById` already refuses a report
 * outside the actor's company, so a guard cannot mint a link to someone else's
 * site by guessing an id.
 */
export async function receiptLink(
  reportId: string,
): Promise<{ url: string | null; error: string | null }> {
  const actor = await requireUnlockedActor();
  const report = await db(actor).report.findById(reportId);
  if (!report) return { url: null, error: "That report isn't available." };

  const token = signReceiptToken(receiptClaims(report.id));
  return { url: `/r/${token}`, error: null };
}

/**
 * Section 20: link revocation.
 *
 * The gallery link is a bearer credential handed to people with no account —
 * a client contact forwards it, and now whoever has the email can see every
 * photo from that shift. Revoking is nulling the token, which is enough
 * because `/g/[token]` looks the report up *by* it: there is no second path
 * to the same media, so a dead token has nothing to resolve to.
 *
 * Deliberately one-way. Re-issuing would mint a different token, so anyone
 * still holding the old URL stays locked out, which is the whole point of
 * pressing revoke.
 */
export async function revokeGalleryLink(
  reportId: string,
): Promise<{ ok: boolean; error: string | null }> {
  const actor = await requireUnlockedActor();
  if (!can.configureSite(actor)) {
    return { ok: false, error: "Only a supervisor can revoke a link." };
  }

  const report = await db(actor).report.findById(reportId);
  if (!report) return { ok: false, error: "That report isn't available." };
  if (!report.galleryToken) return { ok: true, error: null };

  await clearGalleryToken(report.id);
  await recordAudit({
    companyId: actor.companyId,
    actorId: actor.userId,
    action: "link.revoke",
    entityType: "Report",
    entityId: report.id,
    metadata: { kind: "gallery" },
  });
  revalidatePath(`/shift/${report.shiftId}/report`);
  return { ok: true, error: null };
}
