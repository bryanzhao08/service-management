import { prisma } from "./client";

/**
 * Notification rows, push subscriptions, and the bell menu's reads (section 13).
 *
 * Like `deliveries.ts`, the writers here run without a session: a provider
 * webhook and the job worker are the two things that raise most notifications,
 * and neither has an actor. Every function takes the `userId` the caller
 * already resolved from a row it loaded, so nothing here is reachable by
 * passing an id in from outside.
 *
 * The reads are the exception and are scoped the ordinary way: `listForUser`
 * and `markRead` both take the viewer's own id and filter on it, so one
 * signed-in user cannot read or clear another's bell.
 */

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** Writes one notification row. The push fan-out is layered on top, in lib/push. */
export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
}): Promise<{ id: string }> {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      url: params.url,
    },
    select: { id: true },
  });
}

export async function subscriptionsForUser(userId: string) {
  return prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, keys: true },
  });
}

export async function deleteSubscriptionsById(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { id: { in: ids } },
  });
  return count;
}

/**
 * Stores a browser subscription.
 *
 * Upserts on `endpoint` because the browser hands back the same endpoint for
 * the same installation. Without it, a guard who turns notifications off and
 * on again collides with the unique index and sees an error for something that
 * already worked.
 *
 * `userId` is overwritten on conflict deliberately: a shared site phone passed
 * between guards produces one endpoint and several people, and the one who
 * subscribed most recently is the one holding it.
 */
export async function upsertSubscription(params: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: params.endpoint },
    create: {
      userId: params.userId,
      endpoint: params.endpoint,
      keys: { p256dh: params.p256dh, auth: params.auth },
    },
    update: {
      userId: params.userId,
      keys: { p256dh: params.p256dh, auth: params.auth },
    },
  });
}

/**
 * Forgets a browser subscription.
 *
 * Scoped by `userId` as well as endpoint, so one signed-in user cannot
 * unsubscribe another's device by posting a guessed endpoint.
 */
export async function removeSubscription(params: {
  userId: string;
  endpoint: string;
}): Promise<number> {
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { userId: params.userId, endpoint: params.endpoint },
  });
  return count;
}

export async function hasSubscription(userId: string): Promise<boolean> {
  const found = await prisma.pushSubscription.findFirst({
    where: { userId },
    select: { id: true },
  });
  return found !== null;
}

/** The bell menu. Newest first, capped, because nobody scrolls a bell. */
export async function listForUser(
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      url: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * Marks notifications read.
 *
 * With no ids, marks everything unread for that user. The `readAt: null`
 * filter is not redundant: without it, re-opening the bell would keep
 * rewriting `readAt` on rows already read, and "when did they first see this"
 * would stop being answerable.
 */
export async function markRead(params: {
  userId: string;
  ids?: string[];
}): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: {
      userId: params.userId,
      readAt: null,
      ...(params.ids && params.ids.length > 0 ? { id: { in: params.ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return count;
}

/**
 * The guard still on site when someone else clocks in (section 13).
 *
 * Handoff is the one moment in a shift where two guards have to be in the
 * same place at the same time, and the outgoing one is usually the one who
 * does not know it is happening — they are walking a floor, their relief is
 * standing at the door. This finds them so they can be told.
 *
 * Scoped to the same site and excluding the incoming guard, because a guard
 * who clocks in twice on one shift is not their own relief. `ACTIVE` with a
 * clock-in and no clock-out is the real "still here" test; `status` alone
 * would include a shift someone ended without the status ever being written.
 *
 * Returns the message's whole vocabulary in one call so the caller never has
 * to reach for Prisma itself.
 */
export async function handoffContext(params: {
  siteId: string;
  incomingGuardId: string;
  incomingShiftId: string;
}): Promise<{
  outgoingUserId: string;
  outgoingShiftId: string;
  siteName: string;
  incomingGuardName: string;
} | null> {
  const shift = await prisma.shift.findFirst({
    where: {
      siteId: params.siteId,
      id: { not: params.incomingShiftId },
      guardId: { not: params.incomingGuardId },
      status: "ACTIVE",
      clockInAt: { not: null },
      clockOutAt: null,
    },
    // If two are somehow open, the most recent one is the person actually
    // working; an older stuck row is a data problem, not a colleague.
    orderBy: { clockInAt: "desc" },
    select: { id: true, guardId: true, site: { select: { name: true } } },
  });
  if (!shift) return null;

  const incoming = await prisma.user.findUnique({
    where: { id: params.incomingGuardId },
    select: { name: true },
  });

  return {
    outgoingUserId: shift.guardId,
    outgoingShiftId: shift.id,
    siteName: shift.site.name,
    // `User.name` is non-null, so the fallback only covers a guard whose row
    // disappeared between clocking in and this query — a deleted account
    // mid-request. Rare, and still better than a notification that says
    // "undefined clocked in".
    incomingGuardName: incoming?.name ?? "A colleague",
  };
}

/**
 * Sites with verified-recipient gaps, for the nightly reminder (section 13).
 *
 * Returns the supervisor to tell and the count to tell them, per site. A site
 * with no supervisor is skipped rather than escalated — there is nobody to
 * act on it, and a notification nobody owns is noise.
 */
export async function sitesWithUnverifiedRecipients(): Promise<
  Array<{ siteId: string; siteName: string; count: number; supervisorIds: string[] }>
> {
  const sites = await prisma.site.findMany({
    where: { recipients: { some: { status: "UNVERIFIED", required: true } } },
    select: {
      id: true,
      name: true,
      companyId: true,
      recipients: {
        where: { status: "UNVERIFIED", required: true },
        select: { id: true },
      },
    },
  });
  if (sites.length === 0) return [];

  const supervisors = await prisma.user.findMany({
    where: {
      companyId: { in: [...new Set(sites.map((site) => site.companyId))] },
      role: { in: ["SUPERVISOR", "OWNER"] },
    },
    select: { id: true, companyId: true },
  });

  const byCompany = new Map<string, string[]>();
  for (const user of supervisors) {
    byCompany.set(user.companyId, [...(byCompany.get(user.companyId) ?? []), user.id]);
  }

  return sites.map((site) => ({
    siteId: site.id,
    siteName: site.name,
    count: site.recipients.length,
    supervisorIds: byCompany.get(site.companyId) ?? [],
  }));
}

/**
 * Whether this exact notification already went out recently.
 *
 * The sweep runs every minute, and "2 recipients never confirmed" is true for
 * every one of those minutes. Without a throttle the reminder would be the
 * loudest thing in the product and the first one a supervisor learns to
 * ignore, which costs the notification its meaning permanently.
 *
 * Throttling on the rows we already write rather than a new table keeps the
 * state in one place: if the notification exists, it was sent, because
 * `notify` writes the row before it attempts the push.
 */
export async function notifiedSince(params: {
  userId: string;
  type: string;
  /** Narrows to one site. Null means "any of this kind", not "url is null". */
  url: string | null;
  since: Date;
}): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      userId: params.userId,
      type: params.type,
      ...(params.url === null ? {} : { url: params.url }),
      createdAt: { gte: params.since },
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Everything needed to alert on a high-severity incident, in one read.
 *
 * Returns null when the incident is gone, which is the same shape
 * `handoffContext` uses: the caller is best-effort and a missing row is not a
 * failure to retry against.
 *
 * The category label comes from the site's own entry types when the incident
 * used one, and falls back to the built-in category key otherwise, so a site
 * that renamed "Suspicious person" gets its own words in the alert rather
 * than ours.
 */
export async function incidentAlertContext(incidentId: string): Promise<{
  companyId: string;
  siteName: string;
  shiftId: string;
  code: string;
  categoryLabel: string;
  supervisorIds: string[];
} | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      code: true,
      categoryKey: true,
      siteEntryType: { select: { label: true } },
      // The shift hangs off the entry, not off the incident: an incident IS
      // an entry with extra columns, so `entry.shift` is the only path.
      entry: {
        select: {
          shiftId: true,
          shift: { select: { site: { select: { name: true, companyId: true } } } },
        },
      },
    },
  });
  if (!incident) return null;

  const companyId = incident.entry.shift.site.companyId;
  const supervisors = await prisma.user.findMany({
    where: { companyId, role: { in: ["SUPERVISOR", "ADMIN", "OWNER"] } },
    select: { id: true },
  });

  return {
    companyId,
    siteName: incident.entry.shift.site.name,
    shiftId: incident.entry.shiftId,
    code: incident.code,
    categoryLabel: incident.siteEntryType?.label ?? incident.categoryKey,
    supervisorIds: supervisors.map((user) => user.id),
  };
}
