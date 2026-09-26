import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { DeliveryStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { type Actor, visible } from "@/lib/db/scoped";
import { csvDocument } from "@/lib/export/csv";

/**
 * Reports history (section 9.6).
 *
 * The filters are built from `visible.report(actor)`, the same fragment the
 * report detail page uses, so a guard sees only their own reports here and a
 * supervisor sees every report at their assigned sites. Writing a second
 * where-clause for this screen is how a history page becomes the one place
 * scoping leaks.
 */

export const REPORTS_PAGE_SIZE = 25;

/** Which delivery outcome the row is filtered on, not a database enum. */
export const DELIVERY_FILTERS = ["any", "delivered", "pending", "problem"] as const;
export type DeliveryFilter = (typeof DELIVERY_FILTERS)[number];

export const DELIVERY_FILTER_LABELS: Record<DeliveryFilter, string> = {
  any: "Any status",
  delivered: "All delivered",
  pending: "Still in flight",
  problem: "Bounced or failed",
};

export type ReportFilters = {
  /**
   * Hard floor on how far back to look, set by the plan and never by a query
   * string. Applied together with `from`, taking whichever is later.
   */
  notBefore?: Date;
  siteId?: string;
  from?: Date;
  to?: Date;
  delivery?: DeliveryFilter;
  eventNight?: boolean;
  hasIncidents?: boolean;
};

export type ReportHistoryRow = {
  id: string;
  shiftId: string;
  version: number;
  generatedAt: Date | null;
  siteName: string;
  siteId: string;
  guardName: string | null;
  incidentCount: number;
  bytes: number | null;
  pageCount: number | null;
  isEventNight: boolean;
  deliveries: { status: string; count: number }[];
};

/**
 * Statuses that mean "this landed", "this is still moving" and "this needs a
 * human". Kept as one mapping because the list filter, the CSV and the chips
 * must agree on what "problem" means — a row shown as fine in the list and
 * counted as a bounce in the export is worse than either answer alone.
 */
const PROBLEM: DeliveryStatus[] = ["BOUNCED", "FAILED", "COMPLAINED"];
const PENDING: DeliveryStatus[] = ["QUEUED", "SENT", "DELAYED", "UNCONFIRMED"];

function deliveryWhere(filter: DeliveryFilter): Prisma.ReportWhereInput | undefined {
  switch (filter) {
    case "problem":
      return { deliveries: { some: { status: { in: PROBLEM } } } };
    case "pending":
      // Nothing broken, but something still outstanding. The `none` on
      // PROBLEM is what stops a report with one bounce and one queued row
      // from showing up under both filters and reading as two reports.
      return {
        deliveries: {
          some: { status: { in: PENDING } },
          none: { status: { in: PROBLEM } },
        },
      };
    case "delivered":
      // Every row delivered, expressed as "has at least one, and none that
      // is anything else". `every` alone is true for a report with zero
      // deliveries, which has not been delivered to anyone.
      return {
        deliveries: {
          some: { status: "DELIVERED" },
          none: { status: { not: "DELIVERED" } },
        },
      };
    default:
      return undefined;
  }
}

/** The later of two optional dates, which is the narrower window. */
function laterOf(a: Date | undefined, b: Date | undefined): Date | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * The oldest clock-in a plan will show in report history.
 *
 * Months back from now, computed on the calendar rather than in milliseconds,
 * so "12 months" lands on the same day of the month instead of drifting by
 * the number of 31-day months in between.
 */
export function retentionHorizon(months: number, now = new Date()): Date {
  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() - months);
  return horizon;
}

function buildWhere(actor: Actor, filters: ReportFilters): Prisma.ReportWhereInput {
  const effectiveFrom = laterOf(filters.from, filters.notBefore);
  const shift: Prisma.ShiftWhereInput = {
    ...visible.shift(actor),
    ...(actor.role === "GUARD" ? { guardId: actor.userId } : {}),
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    ...(filters.eventNight ? { isEventNight: true } : {}),
    // `notBefore` is the plan's retention horizon and is applied with the
    // user's own `from` by taking the later of the two. It is a separate
    // field rather than a default for `from` so that no query string can
    // widen it: a caller can only ever narrow the window from here.
    //
    // What this limits is *browsing history inside the product*. It does not
    // touch a report that was already delivered — the client has that PDF in
    // their inbox and nothing here can reach it — and the floor in
    // `EVIDENCE_FLOOR_MONTHS` means the horizon is never less than a year.
    ...(effectiveFrom || filters.to
      ? {
          clockInAt: {
            ...(effectiveFrom ? { gte: effectiveFrom } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.hasIncidents
      ? { entries: { some: { type: "INCIDENT", deletedAt: null } } }
      : {}),
  };

  return {
    shift,
    ...deliveryWhere(filters.delivery ?? "any"),
  };
}

export async function listReports(
  actor: Actor,
  filters: ReportFilters = {},
  page = 0,
): Promise<{ rows: ReportHistoryRow[]; total: number; hasMore: boolean }> {
  const where = buildWhere(actor, filters);

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page * REPORTS_PAGE_SIZE,
      take: REPORTS_PAGE_SIZE,
      select: {
        id: true,
        shiftId: true,
        version: true,
        generatedAt: true,
        bytes: true,
        pages: true,
        shift: {
          select: {
            siteId: true,
            isEventNight: true,
            site: { select: { name: true } },
            guard: { select: { name: true } },
            _count: {
              select: { entries: { where: { type: "INCIDENT", deletedAt: null } } },
            },
          },
        },
        deliveries: { select: { status: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  return {
    rows: reports.map((report) => {
      const counts = new Map<string, number>();
      for (const delivery of report.deliveries) {
        counts.set(delivery.status, (counts.get(delivery.status) ?? 0) + 1);
      }
      return {
        id: report.id,
        shiftId: report.shiftId,
        version: report.version,
        generatedAt: report.generatedAt,
        siteId: report.shift.siteId,
        siteName: report.shift.site.name,
        guardName: report.shift.guard?.name ?? null,
        incidentCount: report.shift._count.entries,
        bytes: report.bytes,
        pageCount: report.pages,
        isEventNight: report.shift.isEventNight,
        deliveries: [...counts.entries()].map(([status, count]) => ({
          status,
          count,
        })),
      };
    }),
    total,
    hasMore: (page + 1) * REPORTS_PAGE_SIZE < total,
  };
}

/**
 * The same query without the page window, for the CSV export.
 *
 * Capped rather than unbounded: a company with two years of nightly reports
 * would otherwise build a 40 MB string in memory to answer one click. The cap
 * is surfaced in the file itself (see `reportsCsv`) so a truncated export
 * never passes as a complete one.
 */
export const CSV_ROW_CAP = 5000;

export async function reportsForExport(
  actor: Actor,
  filters: ReportFilters = {},
): Promise<{ rows: ReportHistoryRow[]; capped: boolean }> {
  const { rows, total } = await listReports(actor, filters, 0);
  if (total <= REPORTS_PAGE_SIZE) return { rows, capped: false };

  const all: ReportHistoryRow[] = [];
  const pages = Math.ceil(Math.min(total, CSV_ROW_CAP) / REPORTS_PAGE_SIZE);
  for (let page = 0; page < pages; page += 1) {
    const chunk = await listReports(actor, filters, page);
    all.push(...chunk.rows);
  }
  return { rows: all, capped: total > CSV_ROW_CAP };
}

/** Sites this actor can filter by, for the dropdown. */
export async function filterableSites(
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  return prisma.site.findMany({
    where: visible.site(actor),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * The CSV a supervisor exports from the history list (section 9.6).
 *
 * The delivery outcome is flattened into three counts rather than a status
 * string, because a report with four recipients has four outcomes and picking
 * one to print would make a partial bounce look like a clean send.
 */
export function reportsCsv(rows: readonly ReportHistoryRow[], capped = false): string {
  const body = rows.map((row) => [
    row.generatedAt,
    row.siteName,
    row.guardName ?? "",
    row.version,
    row.incidentCount,
    row.isEventNight ? "yes" : "no",
    row.pageCount ?? "",
    row.bytes ?? "",
    countOf(row, "DELIVERED"),
    countOf(row, PENDING),
    countOf(row, PROBLEM),
  ]);

  const doc = csvDocument(
    [
      "Generated",
      "Site",
      "Guard",
      "Version",
      "Incidents",
      "Event night",
      "Pages",
      "Bytes",
      "Delivered",
      "In flight",
      "Problems",
    ],
    body,
  );

  // Stated in the file, not only in the UI that triggered it. A spreadsheet
  // outlives the page it came from, and someone reconciling it months later
  // has no other way to know it stops short.
  return capped
    ? `${doc}"Truncated at ${CSV_ROW_CAP} rows. Narrow the date range for a complete export."\r\n`
    : doc;
}

function countOf(
  row: ReportHistoryRow,
  status: DeliveryStatus | DeliveryStatus[],
): number {
  const wanted: string[] = Array.isArray(status) ? status : [status];
  return row.deliveries
    .filter((delivery) => wanted.includes(delivery.status))
    .reduce((sum, delivery) => sum + delivery.count, 0);
}
