import { companyHasEntitlement } from "@/lib/db/billing";
import {
  handoffContext,
  incidentAlertContext,
  notifiedSince,
  sitesWithUnverifiedRecipients,
} from "@/lib/db/notifications";
import {
  handoffWaiting,
  incidentHighSeverity,
  recipientUnverifiedReminder,
} from "@/lib/push/kinds";
import { notify } from "@/lib/push/send";

/**
 * The two notifications that are not triggered by an email webhook
 * (section 13).
 *
 * Both are best-effort by design. A handoff notification that throws must not
 * stop a guard clocking in — the shift is the product, the buzz is a courtesy
 * — and a reminder that throws must not abort the rest of a nightly sweep.
 * So both swallow, and both return what they did so a test can prove the
 * quiet cases are actually quiet rather than merely silent.
 */

export async function notifyHandoffWaiting(params: {
  siteId: string;
  incomingGuardId: string;
  incomingShiftId: string;
}): Promise<{ notified: boolean }> {
  try {
    const context = await handoffContext(params);
    if (!context) return { notified: false };

    await notify(
      context.outgoingUserId,
      handoffWaiting({
        siteName: context.siteName,
        incomingGuardName: context.incomingGuardName,
        // Links to the outgoing guard's own shift, not the incoming one's.
        // They are being told to go and hand over, and the handoff note lives
        // on the shift they are ending.
        shiftId: context.outgoingShiftId,
      }),
    );
    return { notified: true };
  } catch {
    return { notified: false };
  }
}

/**
 * How long a supervisor gets before the same site nags them again. The sweep
 * runs every minute; this is what stops that being a notification every
 * minute.
 */
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function remindUnverifiedRecipients(
  now: Date = new Date(),
): Promise<{ sites: number; notifications: number; throttled: number }> {
  const sites = await sitesWithUnverifiedRecipients();
  const since = new Date(now.getTime() - REMINDER_INTERVAL_MS);
  let notifications = 0;
  let throttled = 0;

  for (const site of sites) {
    const content = recipientUnverifiedReminder({
      siteName: site.siteName,
      siteId: site.siteId,
      count: site.count,
    });
    for (const supervisorId of site.supervisorIds) {
      try {
        if (
          await notifiedSince({
            userId: supervisorId,
            type: content.kind,
            url: content.url,
            since,
          })
        ) {
          throttled += 1;
          continue;
        }
        await notify(supervisorId, content);
        notifications += 1;
      } catch {
        // One unreachable supervisor must not cost the other sites their
        // reminder. The sweep is the only thing that raises this at all.
      }
    }
  }

  return { sites: sites.length, notifications, throttled };
}

/**
 * Alerts supervisors that a high-severity incident was just logged.
 *
 * This is the one notification in the product that a plan can switch off, and
 * the gate is narrow on purpose. It decides whether a phone buzzes. It does
 * not touch the entry, the photos, the incident row, the report, or the
 * delivery, all of which are in `ALWAYS_INCLUDED` and are written identically
 * for a company with no subscription at all.
 *
 * Best-effort like its siblings: the incident is already saved by the time
 * this runs, so a push service outage must not turn into a failed action on
 * the guard's screen. It returns what it did so a test can tell "gated off"
 * from "tried and nothing happened", which look identical from outside.
 */
export async function notifyHighSeverityIncident(params: {
  incidentId: string;
}): Promise<{ notified: number; reason?: "not-entitled" | "gone" }> {
  try {
    const context = await incidentAlertContext(params.incidentId);
    if (!context) return { notified: 0, reason: "gone" };

    if (!(await companyHasEntitlement(context.companyId, "push_alerts"))) {
      return { notified: 0, reason: "not-entitled" };
    }

    const content = incidentHighSeverity({
      siteName: context.siteName,
      categoryLabel: context.categoryLabel,
      code: context.code,
      shiftId: context.shiftId,
    });

    let notified = 0;
    for (const supervisorId of context.supervisorIds) {
      try {
        await notify(supervisorId, content);
        notified += 1;
      } catch {
        // One unreachable supervisor must not cost the others their alert.
      }
    }
    return { notified };
  } catch {
    return { notified: 0 };
  }
}
