import { requiredRecipientCount, rollUpReportStatus } from "@/lib/db/deliveries";
import type { DeliveryStatus } from "@/generated/prisma/enums";
import {
  kindForDeliveryStatus,
  reportBounced,
  reportDelivered,
  reportFailed,
} from "@/lib/push/kinds";
import { notify } from "@/lib/push/send";

/**
 * Called after a webhook moves a delivery. Two jobs: roll the report's own
 * status up from its deliveries, and raise the notification for it.
 *
 * It writes no audit event -- `applyDeliveryWebhook` already wrote one for the
 * delivery itself, and a second row saying the same thing would make the audit
 * trail count every bounce twice.
 *
 * The push hangs off the same `complete` flag that decides the status, so the
 * two can never disagree about whether a report actually landed.
 */

type Applied = {
  delivery: {
    id: string;
    reportId: string;
    status: string;
    email: string;
    bounceReason: string | null;
  };
  report: {
    id: string;
    status: string;
    shift: {
      id: string;
      guardId: string;
      site: { name: string };
    };
  };
};

export async function notifyDelivery(
  applied: Applied,
): Promise<{ reportStatus: string; complete: boolean; notified: boolean }> {
  const outcome = await rollUpReportStatus(applied.report.id, applied.report.status);
  const notified = await raiseNotification(applied, outcome.complete);
  return { ...outcome, notified };
}

/**
 * Raises the guard-facing notification for one delivery transition.
 *
 * Returns whether a notification was written, so a test can prove the quiet
 * cases really are quiet rather than assuming it.
 */
async function raiseNotification(
  applied: Applied,
  complete: boolean,
): Promise<boolean> {
  const kind = kindForDeliveryStatus(applied.delivery.status as DeliveryStatus);
  if (!kind) return false;

  const ctx = {
    siteName: applied.report.shift.site.name,
    shiftId: applied.report.shift.id,
  };
  const guardId = applied.report.shift.guardId;

  if (kind === "REPORT_DELIVERED") {
    // One notification per report, not per recipient.
    //
    // A site with four recipients would otherwise buzz a guard four times for
    // one report, and only the fourth buzz means "you can go home". So this
    // fires on the transition that completes the set and says nothing for the
    // ones that merely got closer.
    if (!complete) return false;
    const count = await requiredRecipientCount(applied.report.id);
    await notify(guardId, reportDelivered(ctx, count));
    return true;
  }

  if (kind === "REPORT_BOUNCED") {
    // Per recipient, deliberately, unlike delivered. Each bounce is a
    // different address needing a different phone call, so collapsing them
    // would hide every address after the first.
    await notify(
      guardId,
      reportBounced(ctx, applied.delivery.email, applied.delivery.bounceReason),
    );
    return true;
  }

  await notify(guardId, reportFailed(ctx, applied.delivery.bounceReason));
  return true;
}
