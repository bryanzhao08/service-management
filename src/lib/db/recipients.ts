import { randomBytes } from "node:crypto";

import type { RecipientStatus } from "@/generated/prisma/enums";
import { prisma } from "./client";
import { record as recordAudit } from "./audit";
import { visible, type Actor } from "./scoped";

/**
 * Recipients: who a site's reports go to, and whether that address is known to
 * be alive.
 *
 * This whole module exists because of one line in the research. A recipient's
 * address was deactivated, reports bounced silently for weeks, and the guard
 * was accused of never sending them. Two separate failures produced that: the
 * address died with nobody noticing, and there was no record proving the
 * sends had happened. Milestone 7 fixed the second. This is the first.
 */

/** How long a verified address is trusted before we ask again. */
export const REVERIFY_AFTER_DAYS = 90;

/**
 * A verification token.
 *
 * 32 random bytes rather than a signed claim, because the property that
 * matters here is revocation, not statelessness. Re-verifying has to kill the
 * previous link: if an address was compromised, the old "yes, this is me"
 * email must stop working the moment we ask again. Overwriting a column does
 * that for free, and a signed token would need a separate revocation list to
 * match it.
 */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type RecipientRow = {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  required: boolean;
  status: RecipientStatus;
  verifiedAt: Date | null;
  lastBounceAt: Date | null;
  lastBounceReason: string | null;
  siteId: string;
  siteName: string;
  siteCode: string;
  /** Verified, but long enough ago that we would ask again. */
  stale: boolean;
};

function isStale(status: RecipientStatus, verifiedAt: Date | null, now: Date): boolean {
  if (status !== "VERIFIED" || !verifiedAt) return false;
  const age = now.getTime() - verifiedAt.getTime();
  return age > REVERIFY_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Every recipient this actor can see, worst first.
 *
 * The ordering is the point of the screen. A manager opening this is looking
 * for the address that died, so bounced rows come first, then unverified, then
 * everything that is fine. Sorting alphabetically would bury the one row that
 * matters behind thirty that do not.
 */
export async function listRecipients(
  actor: Actor,
  now = new Date(),
): Promise<RecipientRow[]> {
  const rows = await prisma.recipient.findMany({
    where: visible.recipient(actor),
    include: { site: { select: { id: true, name: true, code: true } } },
  });

  const RANK: Record<RecipientStatus, number> = {
    BOUNCED: 0,
    UNVERIFIED: 1,
    VERIFIED: 2,
  };
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      roleLabel: r.roleLabel,
      required: r.required,
      status: r.status,
      verifiedAt: r.verifiedAt,
      lastBounceAt: r.lastBounceAt,
      lastBounceReason: r.lastBounceReason,
      siteId: r.site.id,
      siteName: r.site.name,
      siteCode: r.site.code,
      stale: isStale(r.status, r.verifiedAt, now),
    }))
    .sort((a, b) => {
      const byStatus = RANK[a.status] - RANK[b.status];
      if (byStatus !== 0) return byStatus;
      // Within "fine", a stale verification is the more interesting one.
      if (a.stale !== b.stale) return a.stale ? -1 : 1;
      return a.siteName.localeCompare(b.siteName) || a.name.localeCompare(b.name);
    });
}

/**
 * One site and its recipients, or null if this actor cannot see that site.
 *
 * Separate from `listRecipients` because the site has to be resolved even
 * when it has no recipients at all: "nobody is on this list" is exactly the
 * state an operator needs to see and fix, and deriving the site name from the
 * first recipient row would render that case as a blank page.
 *
 * Returning null for both "no such site" and "not your site" is deliberate.
 * Telling the two apart would confirm that a site id exists in someone else's
 * company.
 */
export async function siteRecipients(
  actor: Actor,
  siteId: string,
  now = new Date(),
): Promise<{
  site: { id: string; name: string; code: string };
  rows: RecipientRow[];
} | null> {
  const site = await prisma.site.findFirst({
    where: { ...visible.site(actor), id: siteId },
    select: { id: true, name: true, code: true },
  });
  if (!site) return null;

  const all = await listRecipients(actor, now);
  return { site, rows: all.filter((r) => r.siteId === site.id) };
}

export type RecipientHistoryRow = {
  reportId: string;
  version: number;
  status: string;
  statusAt: Date;
  providerMessageId: string | null;
  bounceReason: string | null;
  shiftId: string;
  siteName: string;
  guardName: string | null;
  shiftDate: Date | null;
};

/**
 * One recipient and every report we have ever tried to send them.
 *
 * "Which address died, and when" is a question a manager asks while somebody
 * is being blamed for something. The answer has to be a list of dates, not a
 * status chip.
 */
export async function recipientDetail(
  actor: Actor,
  id: string,
  now = new Date(),
): Promise<{ recipient: RecipientRow; history: RecipientHistoryRow[] } | null> {
  const row = await prisma.recipient.findFirst({
    where: { id, ...visible.recipient(actor) },
    include: { site: { select: { id: true, name: true, code: true } } },
  });
  if (!row) return null;

  const deliveries = await prisma.reportDelivery.findMany({
    where: { recipientId: id },
    orderBy: { statusAt: "desc" },
    take: 100,
    include: {
      report: {
        select: {
          id: true,
          version: true,
          shiftId: true,
          shift: {
            select: {
              clockInAt: true,
              site: { select: { name: true } },
              guard: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return {
    recipient: {
      id: row.id,
      name: row.name,
      email: row.email,
      roleLabel: row.roleLabel,
      required: row.required,
      status: row.status,
      verifiedAt: row.verifiedAt,
      lastBounceAt: row.lastBounceAt,
      lastBounceReason: row.lastBounceReason,
      siteId: row.site.id,
      siteName: row.site.name,
      siteCode: row.site.code,
      stale: isStale(row.status, row.verifiedAt, now),
    },
    history: deliveries.map((d) => ({
      reportId: d.report.id,
      version: d.report.version,
      status: d.status,
      statusAt: d.statusAt,
      providerMessageId: d.providerMessageId,
      bounceReason: d.bounceReason,
      shiftId: d.report.shiftId,
      siteName: d.report.shift.site.name,
      guardName: d.report.shift.guard?.name ?? null,
      shiftDate: d.report.shift.clockInAt,
    })),
  };
}

/**
 * Add a recipient and immediately ask them to confirm they receive our mail.
 *
 * The verification job is enqueued in the same transaction as the insert. If
 * it were enqueued after, a crash in between would leave a recipient who is
 * permanently UNVERIFIED with no job to fix it, which looks identical to an
 * address that simply never replied.
 */
export async function addRecipient(
  actor: Actor,
  input: {
    siteId: string;
    name: string;
    email: string;
    roleLabel: string;
    required: boolean;
  },
): Promise<{ id: string } | { error: string }> {
  const site = await prisma.site.findFirst({
    where: { id: input.siteId, ...visible.site(actor) },
    select: { id: true },
  });
  if (!site) return { error: "That site is not available." };

  const email = input.email.trim().toLowerCase();
  const existing = await prisma.recipient.findFirst({
    where: { siteId: input.siteId, email },
    select: { id: true },
  });
  if (existing) return { error: "That address is already a recipient at this site." };

  const token = newToken();
  const created = await prisma.$transaction(async (tx) => {
    const recipient = await tx.recipient.create({
      data: {
        siteId: input.siteId,
        name: input.name.trim(),
        email,
        roleLabel: input.roleLabel.trim(),
        required: input.required,
        status: "UNVERIFIED",
        verifyToken: token,
      },
      select: { id: true },
    });
    await tx.job.create({
      data: {
        type: "VERIFY_RECIPIENT",
        payload: { recipientId: recipient.id },
        runAfter: new Date(),
      },
    });
    return recipient;
  });

  await recordAudit({
    companyId: actor.companyId,
    actorId: actor.userId,
    action: "recipient.add",
    entityType: "Recipient",
    entityId: created.id,
    metadata: { email, siteId: input.siteId, required: input.required },
  });
  return { id: created.id };
}

/**
 * Issue a fresh verification token and queue the email.
 *
 * Used by "Re-verify all", by the quarterly sweep, and by a manager who has
 * just fixed a bounced address. In every case the old token stops working,
 * which is the behaviour you want when the reason you are re-asking is that
 * you no longer trust the previous answer.
 */
export async function reverify(recipientIds: string[]): Promise<number> {
  if (recipientIds.length === 0) return 0;
  let queued = 0;
  for (const id of recipientIds) {
    const token = newToken();
    await prisma.$transaction(async (tx) => {
      const updated = await tx.recipient.updateMany({
        where: { id },
        data: { verifyToken: token, status: "UNVERIFIED", verifiedAt: null },
      });
      if (updated.count === 0) return;
      await tx.job.create({
        data: {
          type: "VERIFY_RECIPIENT",
          payload: { recipientId: id },
          runAfter: new Date(),
        },
      });
      queued += 1;
    });
  }
  return queued;
}

/** Re-verify every recipient at a site the actor can see. */
export async function reverifySite(actor: Actor, siteId: string): Promise<number> {
  const rows = await prisma.recipient.findMany({
    where: { siteId, site: visible.site(actor) },
    select: { id: true },
  });
  return reverify(rows.map((r) => r.id));
}

/**
 * The one-tap confirmation from the email.
 *
 * Deliberately idempotent and deliberately quiet about failure. It returns the
 * same shape for an unknown token and an already-spent one, because the person
 * clicking is a recipient with no account and nothing useful to do with the
 * difference — and because a distinguishable "that token existed once" is an
 * oracle for anyone guessing.
 */
export async function confirmRecipient(
  token: string,
  now = new Date(),
): Promise<{ name: string; siteName: string } | null> {
  if (!token) return null;
  const row = await prisma.recipient.findFirst({
    where: { verifyToken: token },
    include: { site: { select: { name: true, companyId: true } } },
  });
  if (!row) return null;

  await prisma.recipient.update({
    where: { id: row.id },
    data: {
      status: "VERIFIED",
      verifiedAt: now,
      // Spend the token. Confirmation is a one-time act; leaving the link live
      // means a forwarded email can re-confirm an address after we have
      // deliberately un-trusted it.
      verifyToken: null,
      // A confirmed address is not a bouncing address any more. Keeping the
      // reason would leave `copper` highlighting on a recipient we just heard
      // from directly, which is exactly the false alarm this screen exists to
      // end.
      lastBounceAt: null,
      lastBounceReason: null,
    },
  });
  await recordAudit({
    // No actor: the person clicking the confirmation link is the recipient,
    // who has no account here. A null actorId is the honest answer, and the
    // viewer renders it as "Recipient" rather than inventing a user.
    companyId: row.site.companyId,
    action: "recipient.verify",
    entityType: "Recipient",
    entityId: row.id,
    at: now,
    metadata: { email: row.email, siteName: row.site.name },
  });
  return { name: row.name, siteName: row.site.name };
}

/**
 * Recipients whose verification has aged out.
 *
 * Only VERIFIED rows are considered. An UNVERIFIED recipient already has a
 * pending ask and re-queueing it every night would mail the same person
 * ninety times; a BOUNCED one needs a human to fix the address first, and
 * re-asking a dead mailbox just generates more bounces.
 */
export async function staleRecipients(
  now = new Date(),
  days = REVERIFY_AFTER_DAYS,
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.recipient.findMany({
    where: { status: "VERIFIED", verifiedAt: { lt: cutoff } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function updateRecipient(
  actor: Actor,
  id: string,
  input: { name: string; roleLabel: string; required: boolean },
): Promise<boolean> {
  const updated = await prisma.recipient.updateMany({
    where: { id, ...visible.recipient(actor) },
    data: {
      name: input.name.trim(),
      roleLabel: input.roleLabel.trim(),
      required: input.required,
    },
  });
  return updated.count === 1;
}

/**
 * Remove a recipient.
 *
 * Their delivery history survives: `ReportDelivery.recipientId` goes null
 * rather than cascading, so a report sent last March still shows it went to
 * four people even after one of them leaves the company. Deleting the evidence
 * of a send because somebody changed jobs would undo the entire point of the
 * receipt.
 */
export async function removeRecipient(actor: Actor, id: string): Promise<boolean> {
  const found = await prisma.recipient.findFirst({
    where: { id, ...visible.recipient(actor) },
    select: { id: true, email: true, siteId: true },
  });
  if (!found) return false;
  await prisma.recipient.delete({ where: { id } });
  await recordAudit({
    companyId: actor.companyId,
    actorId: actor.userId,
    action: "recipient.remove",
    entityType: "Recipient",
    entityId: id,
    metadata: { email: found.email, siteId: found.siteId },
  });
  return true;
}

/** Fire-and-forget nudge used by the sweep route. */
export async function queueStaleReverifications(now = new Date()): Promise<number> {
  const ids = await staleRecipients(now);
  return reverify(ids);
}

/**
 * Everything the `VERIFY_RECIPIENT` job needs, in one read.
 *
 * Lives here rather than in the handler because `lib/db` is the only place
 * allowed to touch Prisma (section 17, enforced by the lint rule). The handler
 * runs with no actor — a queue worker has no session — so this is deliberately
 * unscoped, and the only thing it can be reached with is a recipient id the
 * job itself was enqueued with inside a scoped transaction.
 */
export async function recipientForVerification(recipientId: string) {
  return prisma.recipient.findFirst({
    where: { id: recipientId },
    include: {
      site: { select: { name: true, company: { select: { name: true } } } },
    },
  });
}
