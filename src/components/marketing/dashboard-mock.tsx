import { StatusChip, type ReportStatus } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Section 6 of the landing page: what an operations manager sees.
 *
 * Deliberately a table, not a grid of cards. The job this screen does is
 * comparison across sites — "which one has not reported yet" — and a table is
 * the only layout that lines the answer up in a column. It renders as a real
 * <table> so a screen reader can announce row and column headers.
 *
 * Server component, no client JS.
 */

// `status` is the real `ReportStatus` union the app uses, not a marketing
// lookalike, so a mock cannot advertise a state the product cannot produce.
type Row = {
  site: string;
  lastReport: string;
  status: ReportStatus;
  open: number;
};

const ROWS: readonly Row[] = [
  { site: "Westside Hotel", lastReport: "06:12", status: "OPENED", open: 1 },
  {
    site: "Hillcrest Middle School",
    lastReport: "05:58",
    status: "DELIVERED",
    open: 0,
  },
  {
    site: "Pacific Commerce Center",
    lastReport: "06:03",
    status: "DELIVERED",
    open: 0,
  },
  { site: "Northgate Distribution", lastReport: "05:41", status: "BOUNCED", open: 2 },
  { site: "Riverside Storage", lastReport: "06:20", status: "SENDING", open: 0 },
];

export function DashboardMock() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Last night, all sites</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {/* Horizontal scroll is on a labelled, focusable region so it can be
            reached and scrolled by keyboard, which a bare overflow div cannot. */}
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Report delivery by site"
        >
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-xs text-text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-5 py-2 font-medium">
                  Site
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  Last report
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  Delivery
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  Open incidents
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.site} className="border-b border-border last:border-0">
                  <th scope="row" className="px-5 py-3 font-medium">
                    {row.site}
                  </th>
                  <td className="px-5 py-3 text-text-muted tabular-nums">
                    {row.lastReport}
                  </td>
                  <td className="px-5 py-3">
                    <StatusChip status={row.status} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {row.open === 0 ? (
                      <span className="text-text-muted">—</span>
                    ) : (
                      row.open
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
