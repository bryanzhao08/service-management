/**
 * The audit vocabulary, kept out of the database layer on purpose.
 *
 * The log's table is a client component (it owns the filter selects), and a
 * "use client" file that imports `@/lib/db/audit` drags the Prisma client into
 * the browser bundle — which fails the build, and would otherwise have shipped
 * the schema to every visitor. Labels and the row shape are not database
 * concerns, so they live here and both sides import them.
 */

/**
 * The actions worth recording, from section 20.
 *
 * A union rather than a free string, because the viewer filters on these and
 * a typo would create a category that exists in the database and nowhere in
 * the UI — invisible, and only discovered by whoever needed it most.
 */
export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "shift.start",
  "shift.end",
  "entry.edit",
  "entry.delete",
  "report.generate",
  "report.send",
  "recipient.add",
  "recipient.remove",
  "recipient.verify",
  "site.config_change",
  "link.revoke",
  // Section 12 asks the webhook to append an event for every delivery status
  // it applies, not only bounces. Keeping the whole family means the log can
  // answer "when exactly did this address start failing", which is the
  // question a manager actually brings.
  "delivery.sent",
  "delivery.delivered",
  "delivery.delayed",
  "delivery.bounced",
  "delivery.complained",
  "delivery.failed",
  "delivery.unconfirmed",
  "delivery.queued",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Human wording for the viewer. Kept beside the union so one cannot drift. */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  "auth.sign_in": "Signed in",
  "shift.start": "Started a shift",
  "shift.end": "Ended a shift",
  "entry.edit": "Edited an entry",
  "entry.delete": "Deleted an entry",
  "report.generate": "Generated a report",
  "report.send": "Sent a report",
  "recipient.add": "Added a recipient",
  "recipient.remove": "Removed a recipient",
  "recipient.verify": "Recipient confirmed their address",
  "site.config_change": "Changed site configuration",
  "link.revoke": "Revoked a link",
  "delivery.sent": "Provider accepted a report",
  "delivery.delivered": "A report was delivered",
  "delivery.delayed": "A report was delayed",
  "delivery.bounced": "A report bounced",
  "delivery.complained": "A recipient marked a report as spam",
  "delivery.failed": "A report failed to send",
  "delivery.unconfirmed": "Delivery was never confirmed",
  "delivery.queued": "A report was queued",
};

export type AuditRow = {
  id: string;
  at: Date;
  action: string;
  label: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  actorEmail: string | null;
  metadata: unknown;
};

/** The label to show, falling back to the raw action for anything unmapped. */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action as AuditAction] ?? action;
}
