import {
  handoffContext,
  notifiedSince,
  sitesWithUnverifiedRecipients,
} from "@/lib/db/notifications";
import { handoffWaiting, recipientUnverifiedReminder } from "@/lib/push/kinds";
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
