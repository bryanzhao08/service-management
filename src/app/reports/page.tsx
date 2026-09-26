import type { Metadata } from "next";
import Link from "next/link";

import { ReportsTable } from "@/components/reports/reports-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUnlockedActor } from "@/lib/auth/guards";
import {
  DELIVERY_FILTERS,
  DELIVERY_FILTER_LABELS,
  type DeliveryFilter,
  filterableSites,
  listReports,
  retentionHorizon,
  REPORTS_PAGE_SIZE,
} from "@/lib/db/report-history";
import { companySubscription } from "@/lib/db/billing";

export const metadata: Metadata = { title: "Reports" };

/**
 * Section 9.6. Every report this person is allowed to see, filterable.
 *
 * Filters live in the URL rather than component state for three reasons that
 * all come from how this screen is actually used: a supervisor pastes "all the
 * bounced ones at Westside last month" into a message, the browser back button
 * steps back through filters instead of leaving the page, and the CSV route
 * can be handed the identical query string so the export and the list can
 * never disagree about what was filtered.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

/**
 * Parses `YYYY-MM-DD` from the URL.
 *
 * `new Date("2026-01-15")` is UTC midnight, which in a US timezone is the
 * evening of the 14th — so a naive parse silently drops the first night of
 * whatever range someone picked. The `to` bound is pushed to the end of its
 * day for the same reason: a report generated at 03:00 belongs to the range
 * its user meant, not the one the string literally says.
 */
function parseDay(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireUnlockedActor();
  const params = await searchParams;

  const deliveryParam = one(params.delivery);
  const delivery: DeliveryFilter = DELIVERY_FILTERS.includes(
    deliveryParam as DeliveryFilter,
  )
    ? (deliveryParam as DeliveryFilter)
    : "any";

  const page = Math.max(0, Number.parseInt(one(params.page) ?? "0", 10) || 0);

  const subscription = await companySubscription(actor.companyId);
  const notBefore = retentionHorizon(subscription.retentionMonths);

  const filters = {
    siteId: one(params.site),
    from: parseDay(one(params.from)),
    to: parseDay(one(params.to), true),
    delivery,
    eventNight: one(params.event) === "1",
    hasIncidents: one(params.incidents) === "1",
    notBefore,
  };

  const [{ rows, total, hasMore }, sites] = await Promise.all([
    listReports(actor, filters, page),
    filterableSites(actor),
  ]);

  const query = new URLSearchParams();
  if (filters.siteId) query.set("site", filters.siteId);
  if (one(params.from)) query.set("from", one(params.from)!);
  if (one(params.to)) query.set("to", one(params.to)!);
  if (delivery !== "any") query.set("delivery", delivery);
  if (filters.eventNight) query.set("event", "1");
  if (filters.hasIncidents) query.set("incidents", "1");

  const pageHref = (target: number) => {
    const next = new URLSearchParams(query);
    next.set("page", String(target));
    return `/reports?${next.toString()}`;
  };

  return (
    <main
      className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6"
      data-reports-page
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-text">Reports</h1>
          <p className="text-sm text-text-muted" data-reports-total={total}>
            {total === 0
              ? "No reports match these filters."
              : `${total} report${total === 1 ? "" : "s"}`}
          </p>
        </div>
        <a
          // A plain anchor, not a Link: this returns a file, and the client
          // router would try to render the CSV as a page.
          href={`/api/reports/export?${query.toString()}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-text hover:bg-surface"
          data-export-csv
        >
          Export CSV
        </a>
      </header>

      <ReportsTable
        rows={rows}
        sites={sites}
        deliveryOptions={DELIVERY_FILTERS.map((value) => ({
          value,
          label: DELIVERY_FILTER_LABELS[value],
        }))}
        selected={{
          site: filters.siteId ?? "",
          from: one(params.from) ?? "",
          to: one(params.to) ?? "",
          delivery,
          event: filters.eventNight,
          incidents: filters.hasIncidents,
        }}
      />

      {total > REPORTS_PAGE_SIZE ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <span className="text-sm text-text-muted">
              Page {page + 1} of {Math.ceil(total / REPORTS_PAGE_SIZE)}
            </span>
            <div className="flex gap-2">
              {page > 0 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-text"
                  data-page-prev
                >
                  Previous
                </Link>
              ) : null}
              {hasMore ? (
                <Link
                  href={pageHref(page + 1)}
                  className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-text"
                  data-page-next
                >
                  Next
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {actor.role === "GUARD" ? (
        <p className="text-xs text-text-muted">
          <Badge tone="outline">Your reports</Badge> You see reports from shifts you
          worked. A supervisor sees every report at your sites.
        </p>
      ) : null}
    </main>
  );
}
