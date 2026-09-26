import type { DeliveryStatus } from "@/generated/prisma/enums";

import { prisma } from "./client";
import { record as recordAudit, type AuditAction } from "./audit";

/**
 * Delivery rows and the audit trail behind them (section 12).
 *
 * Like `jobs.ts` and the build half of `reports.ts`, nothing here is scoped by
 * an actor: these are written by the worker and by a provider webhook, neither
 * of which has a session. Every function derives the company from the row it
 * already loaded rather than from anything a caller passed in, so an untrusted
 * webhook body can never reach across a company boundary. Reads by a *human*
 * go through `scoped.ts` like everything else.
 */

/**
 * How long a `SENT` row may wait for a webhook before we stop calling it sent.
 *
 * Section 12 is explicit that this becomes `UNCONFIRMED`, not `FAILED`. The
 * difference is the whole product: "we sent it and never heard back" is true
 * and useful, while "it failed" is a guess that would have an operations
 * manager re-sending a report that already arrived.
 */
export const UNCONFIRMED_AFTER_MS = 30 * 60_000;

/**
 * Terminal states. A webhook that arrives after one of these is ignored rather
 * than applied, because providers retry and reorder: a `delivered` webhook
 * replayed an hour after a `bounced` one would otherwise resurrect a dead
 * address and quietly stop the bounce alert.
 */
const TERMINAL: readonly DeliveryStatus[] = ["BOUNCED", "COMPLAINED", "FAILED"];

export async function createDeliveries(
  reportId: string,
  recipients: { id: string; email: string }[],
) {
  if (recipients.length === 0) return [];
  await prisma.reportDelivery.createMany({
    data: recipients.map((r) => ({
      reportId,
      recipientId: r.id,
      email: r.email,
      status: "QUEUED" as const,
    })),
    skipDuplicates: true,
  });
  return prisma.reportDelivery.findMany({
    where: { reportId },
    orderBy: { email: "asc" },
  });
}

export async function deliveriesForReport(reportId: string) {
  return prisma.reportDelivery.findMany({
    where: { reportId },
    orderBy: { email: "asc" },
    include: { recipient: { select: { name: true, required: true } } },
  });
}

/**
 * Counts a report's deliveries by outcome, for the guard's end-of-shift screen.
 *
 * Counts only, deliberately. `lastError` holds whatever the provider said
 * ("resend: validation_error: ..."), which is a supervisor's problem and not
 * something to render on a guard's phone: they need to know it did not go and
 * that trying again is the move, not which API rejected it.
 *
 * This is what separates "nobody has pressed Send yet" from "Send ran and
 * every address failed". Without it the two are indistinguishable, because a
 * report whose deliveries all failed is still READY with a null `sentAt` --
 * the same row a freshly built report has.
 */
export async function deliveryOutcomes(reportId: string): Promise<{
  total: number;
  failed: number;
  sent: number;
}> {
  // Bounded by the recipients configured for one site plus tonight's one-off
  // CCs, so this is a handful of rows, not a scan.
  const rows = await prisma.reportDelivery.findMany({
    where: { reportId },
    select: { status: true },
  });
  return {
    total: rows.length,
    failed: rows.filter((row) => row.status === "FAILED").length,
    sent: rows.filter((row) => row.status === "SENT").length,
  };
}

export async function markDeliverySent(
  id: string,
  providerMessageId: string,
): Promise<void> {
  await prisma.reportDelivery.update({
    where: { id },
    data: {
      status: "SENT",
      providerMessageId,
      statusAt: new Date(),
      attempts: { increment: 1 },
      lastError: null,
    },
  });
}

export async function markDeliveryFailed(id: string, error: string): Promise<void> {
  await prisma.reportDelivery.update({
    where: { id },
    data: {
      status: "FAILED",
      statusAt: new Date(),
      attempts: { increment: 1 },
      lastError: error.slice(0, 500),
    },
  });
}

/**
 * Applies a provider webhook to a delivery row.
 *
 * Matched on `providerMessageId`, never on the email address. An address is not
 * unique across reports and changes the moment someone fixes a typo, so
 * matching on it would apply a bounce for last Tuesday's report to tonight's.
 *
 * Returns the updated row, or null when the message id is unknown or the row
 * has already reached a terminal state. Both are ordinary outcomes and the
 * route answers 200 to them, because a provider that gets a 4xx retries
 * forever against a message we will never recognise.
 */
export async function applyDeliveryWebhook(params: {
  providerMessageId: string;
  status: DeliveryStatus;
  at: Date;
  bounceReason?: string;
}) {
  const { providerMessageId, status, at, bounceReason } = params;

  const existing = await prisma.reportDelivery.findFirst({
    where: { providerMessageId },
    include: {
      report: { include: { shift: { include: { site: true, guard: true } } } },
    },
  });
  if (!existing) return null;
  if (TERMINAL.includes(existing.status)) return null;

  // A webhook older than a state *a webhook* already set is a reordered replay.
  //
  // QUEUED and SENT are excluded because we set them ourselves, off our own
  // clock. Resend stamps an event when it accepts the message; we stamp SENT
  // when the HTTP response gets back to us. A few hundred ms of clock skew the
  // wrong way would make every `delivered` look like a stale replay and get
  // dropped -- silently losing the one signal this product is sold on.
  if (
    existing.statusAt > at &&
    existing.status !== "QUEUED" &&
    existing.status !== "SENT"
  ) {
    return null;
  }

  const updated = await prisma.reportDelivery.update({
    where: { id: existing.id },
    data: {
      status,
      statusAt: at,
      ...(bounceReason ? { bounceReason: bounceReason.slice(0, 500) } : {}),
    },
  });

  // A bounce is also a fact about the recipient, not only about this report.
  // Without this the same dead address keeps being sent tonight's report, and
  // tomorrow's, each one bouncing on its own and nobody connecting them.
  if (
    (status === "BOUNCED" || status === "COMPLAINED") &&
    existing.recipientId !== null
  ) {
    await prisma.recipient.update({
      where: { id: existing.recipientId },
      data: {
        status: "BOUNCED",
        lastBounceAt: at,
        lastBounceReason: bounceReason?.slice(0, 500) ?? null,
      },
    });
  }

  await recordAudit({
    companyId: existing.report.shift.site.companyId,
    action: `delivery.${status.toLowerCase()}` as AuditAction,
    entityType: "ReportDelivery",
    entityId: existing.id,
    at,
    metadata: {
      email: existing.email,
      providerMessageId,
      ...(bounceReason ? { bounceReason } : {}),
    },
  });

  return { delivery: updated, report: existing.report, previous: existing.status };
}

/**
 * Moves stale `SENT` rows to `UNCONFIRMED`.
 *
 * Run by the sweep, not by a timer on the request that sent the email: a
 * process that exits between the send and the timeout would otherwise leave a
 * row claiming `SENT` forever.
 */
export async function expireUnconfirmed(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - UNCONFIRMED_AFTER_MS);
  const { count } = await prisma.reportDelivery.updateMany({
    where: { status: "SENT", statusAt: { lt: cutoff } },
    data: { status: "UNCONFIRMED" },
  });
  return count;
}

/**
 * True when every *required* recipient of a report has reached `DELIVERED`.
 *
 * Optional recipients are excluded deliberately. A cc'd regional manager whose
 * mail server is slow must not hold back the "delivered to everyone" push the
 * guard is waiting on before they go home.
 */
export async function allRequiredDelivered(reportId: string): Promise<boolean> {
  const rows = await prisma.reportDelivery.findMany({
    where: { reportId },
    select: { status: true, recipient: { select: { required: true } } },
  });
  const required = rows.filter((r) => r.recipient?.required !== false);
  if (required.length === 0) return false;
  return required.every((r) => r.status === "DELIVERED");
}

/**
 * How many recipients a "delivered to everyone" notification is counting.
 *
 * Uses the same required/optional rule as `allRequiredDelivered`, not a count
 * of every delivery row, so the number in the notification matches the
 * condition that produced it. Counting all rows here would tell a guard
 * "delivered to 4 recipients" at the moment three required ones landed and an
 * optional fourth was still in flight.
 */
export async function requiredRecipientCount(reportId: string): Promise<number> {
  const rows = await prisma.reportDelivery.findMany({
    where: { reportId },
    select: { recipient: { select: { required: true } } },
  });
  return rows.filter((r) => r.recipient?.required !== false).length;
}

/**
 * Everything the `SEND_REPORT` handler needs, in one read.
 *
 * It lives here rather than in the handler because `lib/db/**` is the only
 * place allowed to touch Prisma (section 17), and that rule is what keeps
 * company scoping from being something each caller remembers to do.
 *
 * Incidents come through `Entry`, not off `Shift`: an incident *is* an entry
 * with an `Incident` attached. Reading them any other way would invent a second
 * source of truth for what happened on a shift.
 */
export async function reportForSend(reportId: string) {
  return prisma.report.findUnique({
    where: { id: reportId },
    include: {
      shift: {
        include: {
          guard: true,
          site: {
            include: {
              recipients: { orderBy: { email: "asc" } },
            },
          },
          entries: {
            where: { deletedAt: null, incident: { isNot: null } },
            include: { incident: true },
            orderBy: { occurredAt: "asc" },
          },
          _count: { select: { entries: { where: { deletedAt: null } } } },
        },
      },
    },
  });
}

/** Blind-spot coverage for the email summary: checked over configured. */
export async function blindSpotCoverage(
  shiftId: string,
  siteId: string,
): Promise<{ checked: number; total: number }> {
  const [checked, total] = await Promise.all([
    prisma.blindSpotCheck.count({
      where: { shiftId, method: { not: "NOT_CHECKED" } },
    }),
    prisma.blindSpot.count({ where: { siteId } }),
  ]);
  return { checked, total };
}

/** Marks a report SENT the first time any recipient is accepted by the provider. */
export async function markReportSent(reportId: string): Promise<void> {
  await prisma.report.update({
    where: { id: reportId },
    data: { status: "SENT", sentAt: new Date() },
  });
}

/**
 * Rolls a report's status up from its deliveries, after a webhook moves one.
 *
 * `PARTIAL` is sticky against later good news, on purpose. Once an address has
 * bounced, the report did not reach everyone it was addressed to, and a
 * `delivered` arriving afterwards for a *different* recipient does not undo
 * that. The supervisor needs to see the gap, not an average.
 */
export async function rollUpReportStatus(
  reportId: string,
  current: string,
): Promise<{ reportStatus: string; complete: boolean }> {
  const deliveries = await prisma.reportDelivery.findMany({
    where: { reportId },
    select: { status: true },
  });

  const complete = await allRequiredDelivered(reportId);
  const anyDead = deliveries.some((d) =>
    (["BOUNCED", "COMPLAINED", "FAILED"] as string[]).includes(d.status),
  );

  if (anyDead && current !== "PARTIAL") {
    await prisma.report.update({
      where: { id: reportId },
      data: { status: "PARTIAL" },
    });
    return { reportStatus: "PARTIAL", complete };
  }

  return { reportStatus: current, complete };
}

/** `SENT` rows old enough for the console-mode confirmer to act on. */
export async function sentDeliveriesOlderThan(
  cutoff: Date,
  take = 50,
): Promise<string[]> {
  const rows = await prisma.reportDelivery.findMany({
    where: {
      status: "SENT",
      statusAt: { lt: cutoff },
      providerMessageId: { not: null },
    },
    select: { providerMessageId: true },
    take,
  });
  return rows.flatMap((r) => (r.providerMessageId ? [r.providerMessageId] : []));
}

/**
 * A delivery by id, but only if it belongs to the caller's own company.
 *
 * The scoping is the point. Looking a delivery up by id alone would let any
 * signed-in user anywhere mark another company's report delivered, which is
 * exactly the forgery the webhook signature exists to prevent.
 */
export async function deliveryInCompany(
  id: string,
  companyId: string,
): Promise<{ providerMessageId: string | null } | null> {
  return prisma.reportDelivery.findFirst({
    where: { id, report: { shift: { site: { companyId } } } },
    select: { providerMessageId: true },
  });
}
