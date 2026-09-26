import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/db/scoped";
import {
  AUDIT_LABELS,
  auditLabel,
  type AuditAction,
  type AuditRow,
} from "@/lib/audit-actions";
import { csvDocument } from "@/lib/export/csv";

/**
 * The audit log (section 20).
 *
 * Section 7 of the landing page sells an "immutable audit log", so this is a
 * claim the product makes to a buyer, not a debugging convenience. Two things
 * follow from that:
 *
 *   - it is append-only. There is no update and no delete in this module, and
 *     nothing else in the app writes `auditEvent`. A log a supervisor can edit
 *     proves nothing about a dispute, which is the only situation anyone ever
 *     opens it in.
 *   - writing must never fail the thing being audited. A guard cannot be
 *     stopped from clocking in because the log is unavailable. So `record`
 *     swallows, and the cost of that tradeoff is stated here rather than
 *     hidden: a dropped row is a gap nobody is told about. The alternative,
 *     a failed clock-in, is worse and more visible.
 */

export {
  AUDIT_ACTIONS,
  AUDIT_LABELS,
  auditLabel,
  type AuditAction,
  type AuditRow,
} from "@/lib/audit-actions";

export async function record(params: {
  companyId: string;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  at?: Date;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        companyId: params.companyId,
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        ...(params.at ? { at: params.at } : {}),
        ...(params.metadata
          ? { metadata: params.metadata as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch {
    // Deliberate. See the note at the top of the file: the audited action
    // wins. A webhook that 500s because its audit row failed would be retried
    // by the provider and double-apply the delivery status it carries.
  }
}

export type AuditFilters = {
  action?: string;
  actorId?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
};

/** Page size. Large enough to scan a shift's worth, small enough to render. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Reads the log for `actor`'s company.
 *
 * Company-scoped and nothing finer, on purpose. The log's whole job is to
 * answer "who did this and when" across the company, and a supervisor-scoped
 * view would hide exactly the cross-site activity someone opens it to find.
 * The route above it is ADMIN-gated for that reason, so the scoping and the
 * permission are decided in one place rather than two.
 */
/**
 * A `YYYY-MM-DD` filter value to a real instant.
 *
 * Local midnight, not UTC. `new Date("2026-03-01")` is UTC midnight, which in
 * California is 4pm the day before, so a "from" filter parsed that way
 * silently includes the previous evening. Exported because the page and the
 * export must parse a date the same way or the file will not match the screen.
 */
export function parseAuditDay(
  value: string | undefined,
  endOfDay = false,
): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

/**
 * The filter, in one place.
 *
 * The paged viewer and the bulk export must answer the same question or the
 * file will not match the screen someone exported it from, which is the exact
 * moment an audit log stops being evidence.
 */
function auditWhere(actor: Actor, filters: AuditFilters): Prisma.AuditEventWhereInput {
  return {
    companyId: actor.companyId,
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.from || filters.to
      ? {
          at: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };
}

type AuditEventRow = {
  id: string;
  at: Date;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Prisma.JsonValue;
  actor: { name: string; email: string } | null;
};

/** One row's database shape to the shape both the table and the CSV read. */
function toAuditRow(event: AuditEventRow): AuditRow {
  return {
    id: event.id,
    at: event.at,
    action: event.action,
    label: AUDIT_LABELS[event.action as AuditAction] ?? event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    actorName: event.actor?.name ?? null,
    actorEmail: event.actor?.email ?? null,
    metadata: event.metadata,
  };
}

export async function listAuditEvents(
  actor: Actor,
  filters: AuditFilters = {},
  page = 0,
): Promise<{ rows: AuditRow[]; total: number; hasMore: boolean }> {
  const where = auditWhere(actor, filters);

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      // `id` breaks the tie. Several rows land in the same millisecond during
      // a clock-in, and without a stable second key a page boundary can drop
      // or repeat a row — the one failure that makes a log untrustworthy.
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: page * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        at: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        actor: { select: { name: true, email: true } },
      },
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return {
    rows: events.map(toAuditRow),
    total,
    hasMore: (page + 1) * AUDIT_PAGE_SIZE < total,
  };
}

/** The people who appear in this company's log, for the actor filter. */
export async function auditActors(
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  const users = await prisma.user.findMany({
    where: { companyId: actor.companyId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}

/** The actions this company has actually generated, for the action filter. */
export async function auditActionsPresent(actor: Actor): Promise<string[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { companyId: actor.companyId },
    select: { action: true },
    distinct: ["action"],
    orderBy: { action: "asc" },
  });
  return rows.map((row) => row.action);
}

export function canViewAudit(actor: Actor): boolean {
  return actor.role === Role.ADMIN || actor.role === Role.OWNER;
}

/**
 * Hard ceiling on a bulk audit export.
 *
 * Higher than the reports CSV cap because an audit log is denser per row and
 * the whole reason to buy the export is a compliance window nobody wants to
 * download in slices. Still a ceiling: a company three years in should not be
 * able to ask one request to serialise everything it has ever done.
 */
export const AUDIT_EXPORT_ROW_CAP = 25000;

/**
 * Every matching event, for the bulk export.
 *
 * Separate from `listAuditEvents` rather than a `take` parameter on it,
 * because a paged viewer and a bulk export want different failure modes: the
 * viewer must always answer, the export must say when it truncated. Sharing
 * `auditWhere` keeps the filters identical, so the file matches the screen.
 */
export async function auditEventsForExport(
  actor: Actor,
  filters: AuditFilters = {},
): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const events = await prisma.auditEvent.findMany({
    where: auditWhere(actor, filters),
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: AUDIT_EXPORT_ROW_CAP + 1,
    select: {
      id: true,
      at: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      actor: { select: { name: true, email: true } },
    },
  });

  const truncated = events.length > AUDIT_EXPORT_ROW_CAP;
  return {
    rows: events.slice(0, AUDIT_EXPORT_ROW_CAP).map(toAuditRow),
    truncated,
  };
}

/** Column order for the audit CSV. Header and body read from one list. */
const AUDIT_COLUMNS = [
  "When",
  "Who",
  "Email",
  "Action",
  "What it was",
  "Thing",
  "Id",
  "Details",
] as const;

export function auditCsv(rows: AuditRow[]): string {
  return csvDocument(
    AUDIT_COLUMNS,
    rows.map((row) => [
      row.at.toISOString(),
      // A null actor is the recipient-verification case: the person who
      // clicked has no account, so naming a user here would be a lie.
      row.actorName ?? "Recipient",
      row.actorEmail ?? "",
      row.action,
      auditLabel(row.action),
      row.entityType,
      row.entityId,
      row.metadata === null ? "" : JSON.stringify(row.metadata),
    ]),
  );
}
