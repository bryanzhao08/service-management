"use server";

import { requireUnlockedActor } from "@/lib/auth/guards";
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
