import { NextResponse } from "next/server";

import { can, requireUnlockedActor } from "@/lib/auth/guards";
import {
  DELIVERY_FILTERS,
  type DeliveryFilter,
  reportsCsv,
  reportsForExport,
} from "@/lib/db/report-history";
import { csvFilename, csvResponseHeaders } from "@/lib/export/csv";

/**
 * `GET /api/reports/export` — section 9.6, "Supervisors can export a CSV".
 *
 * Supervisor and up, deliberately. `listReports` would already scope a guard's
 * export to their own reports, so the gate is not about leaking data; it is
 * that a list export is a management artifact and a guard has no use for one.
 * Refusing here keeps the permission decision beside the route rather than
 * implied by what the query happens to return.
 *
 * The query string is the same one the page uses, so whatever was on screen is
 * what lands in the file.
 */
export async function GET(request: Request) {
  const actor = await requireUnlockedActor();
  if (!can.viewAllShiftsAtSite(actor)) {
    return NextResponse.json(
      { error: "Only a supervisor can export the report list." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) || undefined;

  const deliveryParam = get("delivery");
  const delivery: DeliveryFilter = DELIVERY_FILTERS.includes(
    deliveryParam as DeliveryFilter,
  )
    ? (deliveryParam as DeliveryFilter)
    : "any";

  const parseDay = (value: string | undefined, endOfDay = false) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    return endOfDay
      ? new Date(y, m - 1, d, 23, 59, 59, 999)
      : new Date(y, m - 1, d, 0, 0, 0, 0);
  };

  const { rows, capped } = await reportsForExport(actor, {
    siteId: get("site"),
    from: parseDay(get("from")),
    to: parseDay(get("to"), true),
    delivery,
    eventNight: get("event") === "1",
    hasIncidents: get("incidents") === "1",
  });

  return new NextResponse(reportsCsv(rows, capped), {
    headers: csvResponseHeaders(csvFilename("transient-reports")),
  });
}
