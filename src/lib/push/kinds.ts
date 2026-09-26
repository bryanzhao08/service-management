import type { DeliveryStatus } from "@/generated/prisma/enums";

/**
 * The notification kinds, and the words each one uses (section 13).
 *
 * `Notification.type` is a `String` in the schema, which means the database
 * will accept any spelling. So the union lives here and every writer goes
 * through these builders, rather than each call site passing a literal and a
 * typo producing a row that renders but can never be filtered.
 *
 * The copy is here too, for the same reason the email palette is read out of
 * globals.css: a push notification and the bell row it creates are the same
 * event, and writing them in two places is how they end up saying different
 * things about one report.
 */
export type NotificationKind =
  | "REPORT_DELIVERED"
  | "REPORT_BOUNCED"
  | "REPORT_FAILED"
  | "HANDOFF_WAITING"
  | "RECIPIENT_UNVERIFIED_REMINDER";

export type NotificationContent = {
  kind: NotificationKind;
  title: string;
  body: string;
  url: string | null;
  /**
   * Whether this should vibrate and stay on screen, or arrive quietly.
   *
   * A bounce is someone's evidence not arriving, and the guard can still fix
   * it tonight. A delivery confirmation is good news that can wait until they
   * pick the phone up. Treating both as urgent trains people to swipe away the
   * one that mattered.
   */
  urgent: boolean;
};

type ReportContext = {
  siteName: string;
  shiftId: string;
};

/** Phrases a count so "1 recipients" can never be rendered. */
function people(count: number): string {
  return count === 1 ? "1 recipient" : `${count} recipients`;
}

export function reportDelivered(
  ctx: ReportContext,
  recipientCount: number,
): NotificationContent {
  return {
    kind: "REPORT_DELIVERED",
    title: "Report delivered",
    // Naming the site matters more than naming the report: a guard covering
    // three properties in a week has no idea which one "your report" was.
    body: `${ctx.siteName} — delivered to ${people(recipientCount)}.`,
    url: `/shift/${ctx.shiftId}/report`,
    urgent: false,
  };
}

export function reportBounced(
  ctx: ReportContext,
  email: string,
  reason: string | null,
): NotificationContent {
  return {
    kind: "REPORT_BOUNCED",
    title: "A report did not arrive",
    // The address is in the body because it is the only part the reader can
    // act on. "A delivery bounced" sends them looking; the address tells them
    // who to phone.
    body: reason
      ? `${ctx.siteName} — ${email} bounced: ${reason}`
      : `${ctx.siteName} — ${email} bounced.`,
    url: `/shift/${ctx.shiftId}/report`,
    urgent: true,
  };
}

export function reportFailed(
  ctx: ReportContext,
  detail: string | null,
): NotificationContent {
  return {
    kind: "REPORT_FAILED",
    title: "Report could not be sent",
    body: detail
      ? `${ctx.siteName} — ${detail}`
      : `${ctx.siteName} — the send failed. Open the shift to try again.`,
    url: `/shift/${ctx.shiftId}/end`,
    urgent: true,
  };
}

export function handoffWaiting(params: {
  siteName: string;
  incomingGuardName: string;
  shiftId: string;
}): NotificationContent {
  return {
    kind: "HANDOFF_WAITING",
    title: "Someone is waiting for handoff",
    body: `${params.incomingGuardName} clocked in at ${params.siteName}.`,
    url: `/shift/${params.shiftId}`,
    urgent: true,
  };
}

export function recipientUnverifiedReminder(params: {
  siteName: string;
  siteId: string;
  count: number;
}): NotificationContent {
  return {
    kind: "RECIPIENT_UNVERIFIED_REMINDER",
    title: "Unverified recipients",
    // Says what the consequence is, not just what the state is. A supervisor
    // who reads "2 recipients are unverified" has no reason to act tonight;
    // one who reads that reports are not reaching them does.
    body: `${params.siteName} — ${people(params.count)} never confirmed their address, so reports are not reaching them.`,
    url: `/sites/${params.siteId}`,
    urgent: false,
  };
}

/**
 * The delivery states worth waking someone for.
 *
 * `UNCONFIRMED` is deliberately absent. It means we sent the mail and the
 * provider never said anything back, which is usually a quiet provider rather
 * than a missing report; pushing it would cry wolf on every slow webhook. It
 * is still on the receipt, where someone is already looking.
 */
export function kindForDeliveryStatus(
  status: DeliveryStatus,
): "REPORT_DELIVERED" | "REPORT_BOUNCED" | "REPORT_FAILED" | null {
  switch (status) {
    case "DELIVERED":
      return "REPORT_DELIVERED";
    case "BOUNCED":
    case "COMPLAINED":
      return "REPORT_BOUNCED";
    case "FAILED":
      return "REPORT_FAILED";
    case "QUEUED":
    case "SENT":
    case "DELAYED":
    case "UNCONFIRMED":
      return null;
  }
}
