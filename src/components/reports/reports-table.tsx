"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { ReportHistoryRow } from "@/lib/db/report-history";
import { formatDateTimeArchival } from "@/lib/time";
import { formatBytes } from "@/lib/utils";

/**
 * The filter bar and the list (section 9.6).
 *
 * A client component only because changing a filter has to rewrite the URL.
 * The rows themselves are rendered from props the server already fetched, so
 * this ships no data-fetching code and the list is in the HTML on first paint
 * — which matters on the phone a supervisor actually opens it on.
 */
export function ReportsTable({
  rows,
  sites,
  deliveryOptions,
  selected,
}: {
  rows: readonly ReportHistoryRow[];
  sites: readonly { id: string; name: string }[];
  deliveryOptions: readonly { value: string; label: string }[];
  selected: {
    site: string;
    from: string;
    to: string;
    delivery: string;
    event: boolean;
    incidents: boolean;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      // Any filter change invalidates the offset. Without this, narrowing a
      // filter while on page 3 lands on an empty page that reads as "no
      // reports" — the filter looks broken when it worked.
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const field =
    "min-h-11 rounded-lg border border-border bg-surface px-3 text-sm text-text";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm text-text-muted">
            Site
            <select
              className={field}
              value={selected.site}
              onChange={(e) => setParam("site", e.target.value || null)}
              data-filter-site
            >
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm text-text-muted">
            Delivery
            <select
              className={field}
              value={selected.delivery}
              onChange={(e) =>
                setParam("delivery", e.target.value === "any" ? null : e.target.value)
              }
              data-filter-delivery
            >
              {deliveryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-sm text-text-muted">
              From
              <input
                type="date"
                className={field}
                value={selected.from}
                onChange={(e) => setParam("from", e.target.value || null)}
                data-filter-from
              />
            </label>
            <label className="grid gap-1 text-sm text-text-muted">
              To
              <input
                type="date"
                className={field}
                value={selected.to}
                onChange={(e) => setParam("to", e.target.value || null)}
                data-filter-to
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-3">
            <label className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.event}
                onChange={(e) => setParam("event", e.target.checked ? "1" : null)}
                data-filter-event
              />
              Event nights only
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.incidents}
                onChange={(e) => setParam("incidents", e.target.checked ? "1" : null)}
                data-filter-incidents
              />
              Has incidents
            </label>
          </div>
        </CardContent>
      </Card>

      <DataTable
        caption="Reports, newest first"
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <p className="px-4 py-8 text-center text-sm text-text-muted">
            Nothing here yet. Reports appear once a shift has been ended and a report
            built.
          </p>
        }
        columns={[
          {
            key: "date",
            header: "Generated",
            primary: true,
            cell: (row) => (
              <Link
                href={`/shift/${row.shiftId}/report`}
                className="font-medium text-text underline-offset-2 hover:underline"
                data-report-link
              >
                {row.generatedAt
                  ? formatDateTimeArchival(row.generatedAt, row.siteTimezone)
                  : "Not built"}
              </Link>
            ),
          },
          { key: "site", header: "Site", cell: (row) => row.siteName },
          {
            key: "guard",
            header: "Guard",
            hideOnMobile: true,
            cell: (row) => row.guardName ?? "—",
          },
          {
            key: "incidents",
            header: "Incidents",
            align: "end",
            cell: (row) => <span className="tabular-nums">{row.incidentCount}</span>,
          },
          {
            key: "size",
            header: "Size",
            align: "end",
            hideOnMobile: true,
            cell: (row) => (
              <span className="text-text-muted tabular-nums">
                {row.bytes === null ? "—" : formatBytes(row.bytes)}
                {row.pageCount !== null ? ` · ${row.pageCount}p` : ""}
              </span>
            ),
          },
          {
            key: "delivery",
            header: "Delivery",
            cell: (row) => <DeliveryChips row={row} />,
          },
        ]}
      />
    </div>
  );
}

const PROBLEM = new Set(["BOUNCED", "FAILED", "COMPLAINED"]);
const DONE = new Set(["DELIVERED"]);

/**
 * One chip per outcome, not per recipient.
 *
 * Four recipients produce four delivery rows, and printing four chips turns a
 * scan into a count. Grouping keeps "3 delivered, 1 bounced" readable at a
 * glance, which is the only thing this column is for.
 */
function DeliveryChips({ row }: { row: ReportHistoryRow }) {
  if (row.deliveries.length === 0) {
    return <span className="text-sm text-text-muted">Not sent</span>;
  }

  let delivered = 0;
  let problem = 0;
  let pending = 0;
  for (const entry of row.deliveries) {
    if (DONE.has(entry.status)) delivered += entry.count;
    else if (PROBLEM.has(entry.status)) problem += entry.count;
    else pending += entry.count;
  }

  return (
    <span className="flex flex-wrap gap-1" data-delivery-chips>
      {delivered > 0 ? (
        <Badge tone="primary">
          <span aria-hidden="true">•</span> {delivered} delivered
        </Badge>
      ) : null}
      {pending > 0 ? (
        <Badge tone="attention">
          <span aria-hidden="true">•</span> {pending} in flight
        </Badge>
      ) : null}
      {problem > 0 ? (
        <Badge tone="danger">
          <span aria-hidden="true">×</span> {problem} failed
        </Badge>
      ) : null}
    </span>
  );
}
