import "server-only";

import webpush from "web-push";

import {
  createNotification,
  deleteSubscriptionsById,
  subscriptionsForUser,
} from "@/lib/db/notifications";

import type { NotificationContent } from "./kinds";

/**
 * The Web Push transport (section 13).
 *
 * Every notification is a *row first* and a push second, and that order is the
 * design. Push delivery is best-effort by specification: the phone may be off,
 * the subscription may be dead, the browser may have dropped it months ago. If
 * the row only existed when the push succeeded, the product would be telling a
 * guard their report bounced exactly when their phone happened to be
 * reachable, and saying nothing at all the rest of the time. The bell menu is
 * the durable channel; push is the interruption layered on top.
 */

/**
 * What the service worker receives.
 *
 * Kept narrow on purpose. A push payload is delivered by a third party and
 * lands in a worker with no session, so it carries display text and one
 * relative URL — never a record the page then trusts.
 */
export type PushPayload = {
  title: string;
  body: string;
  url: string | null;
  urgent: boolean;
  notificationId: string;
};

let configured = false;

export function pushIsConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Loads the VAPID keys, or reports that push is off.
 *
 * Returns a boolean rather than throwing, because a deployment without keys is
 * a legitimate configuration — push is an enhancement and `pnpm gen:vapid` is
 * a step someone can reasonably not have run yet. What must never happen is
 * the *notification* failing because the *push* is unconfigured, so callers
 * read false as "write the row, skip the fan-out".
 */
function configure(): boolean {
  if (!pushIsConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:ops@transient.local",
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    configured = true;
  }
  return true;
}

/**
 * A subscription the push service says is gone.
 *
 * 404 and 410 are the two codes that mean the endpoint itself is dead: the
 * user cleared site data, the browser rotated it, the app was uninstalled.
 * Anything else (429, 500, a timeout) is the push service having a bad minute,
 * and deleting a live subscription over one is how a guard silently stops
 * getting notifications with nothing anywhere to explain why.
 */
function subscriptionIsGone(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Writes the notification row for one user, then pushes it to their devices.
 *
 * `pushed` counts endpoints that *accepted* the payload, which is not the same
 * as phones that displayed it — nothing downstream of the push service reports
 * back — so no surface is allowed to phrase it as "we told them".
 */
export async function notify(
  userId: string,
  content: NotificationContent,
): Promise<{ id: string; pushed: number; pruned: number }> {
  const row = await createNotification({
    userId,
    type: content.kind,
    title: content.title,
    body: content.body,
    url: content.url,
  });

  if (!configure()) return { id: row.id, pushed: 0, pruned: 0 };

  const subscriptions = await subscriptionsForUser(userId);
  if (subscriptions.length === 0) return { id: row.id, pushed: 0, pruned: 0 };

  const payload: PushPayload = {
    title: content.title,
    body: content.body,
    url: content.url,
    urgent: content.urgent,
    notificationId: row.id,
  };
  const encoded = JSON.stringify(payload);

  const dead: string[] = [];
  // Sent in parallel: one unreachable endpoint must not delay the others, or a
  // guard with a dead old phone slows every push to the one they carry.
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const keys = sub.keys as { p256dh?: string; auth?: string } | null;
      if (!keys?.p256dh || !keys?.auth) {
        // A row that cannot be used will fail forever. Prune it now rather
        // than rediscovering it one send at a time.
        dead.push(sub.id);
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
          },
          encoded,
          // An urgent notification that arrives tomorrow is noise, so it
          // expires in an hour. A delivery confirmation is still worth having
          // when the phone comes back on, so it gets a day.
          { TTL: content.urgent ? 60 * 60 : 24 * 60 * 60 },
        );
      } catch (error) {
        if (subscriptionIsGone(error)) {
          dead.push(sub.id);
          return;
        }
        throw error;
      }
    }),
  );

  const pruned = await deleteSubscriptionsById(dead);
  const accepted = results.filter((r) => r.status === "fulfilled").length;
  return { id: row.id, pushed: Math.max(0, accepted - dead.length), pruned };
}
