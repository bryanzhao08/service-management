import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  StartUnscheduled,
  type StartableSite,
} from "@/components/shift/start-unscheduled";
import { ShiftFocusCard } from "@/components/dashboard/shift-focus-card";
import { formatClock } from "@/lib/time";
import { formatDuration } from "@/lib/utils";

export type RecentReport = {
  id: string;
  createdAt: Date;
  shift: { site: { name: string; timezone: string } };
  deliveries: { status: string }[];
};
type Assignment = {
  id: string;
  site: { name: string; timezone: string };
  clockInAt: Date | null;
  scheduledStart: Date;
  template: { name: string } | null;
};
export function GuardDashboardView({
  active,
  startable,
  recent,
  pace,
  assignedSites,
  shiftHref,
  reportDownloads = true,
}: {
  active: Omit<Assignment, "template"> | null;
  startable: Assignment[];
  recent: RecentReport[];
  pace: { averageMs: number; shifts: number } | null;
  assignedSites: readonly StartableSite[];
  shiftHref?: string;
  reportDownloads?: boolean;
}) {
  const next = startable.find((shift) => shift.id !== active?.id);
  const others = startable.filter((shift) => shift.id !== next?.id);
  return (
    <div className="space-y-6">
      {active ? (
        <ShiftFocusCard
          siteName={active.site.name}
          label="On shift"
          detail={
            active.clockInAt
              ? `Started ${formatClock(active.clockInAt, active.site.timezone)}`
              : "Not clocked in yet"
          }
          clockInAt={active.clockInAt?.toISOString()}
          href={shiftHref ?? `/shift/${active.id}`}
          action="Resume shift"
        />
      ) : next ? (
        <ShiftFocusCard
          siteName={next.site.name}
          label="Next shift"
          detail={`${next.template?.name ?? "Scheduled"} · ${formatClock(next.scheduledStart, next.site.timezone)}`}
          href={shiftHref ?? `/shift/${next.id}/start`}
          action="Start shift"
        />
      ) : (
        <StartUnscheduled sites={assignedSites} />
      )}

      {/* More than one assignment, so the picker is the list itself rather
          than a dropdown the guard must open to discover. */}
      {!active && others.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Also scheduled</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {others.map((shift) => (
                <li
                  key={shift.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-text">{shift.site.name}</p>
                    <p className="text-sm text-text-muted">
                      {formatClock(shift.scheduledStart, shift.site.timezone)}
                    </p>
                  </div>
                  <Button asChild variant="secondary">
                    <Link href={`/shift/${shift.id}/start`}>Start</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <RecentReports reports={recent} downloadEnabled={reportDownloads} />
      <EndOfShiftPace pace={pace} />
    </div>
  );
}

function EndOfShiftPace({
  pace,
}: {
  pace: { averageMs: number; shifts: number } | null;
}) {
  if (!pace) return null;
  return (
    <Card>
      <CardContent className="flex items-baseline justify-between gap-4 py-4">
        <div className="min-w-0">
          <p className="text-sm text-text-muted">Your end-of-shift time this month</p>
          <p className="text-xs text-text-muted">
            Across {pace.shifts} {pace.shifts === 1 ? "shift" : "shifts"}
          </p>
        </div>
        <p className="text-xl font-semibold text-text tabular-nums">
          {formatDuration(pace.averageMs)}
        </p>
      </CardContent>
    </Card>
  );
}

export function RecentReports({
  reports,
  downloadEnabled = true,
}: {
  reports: RecentReport[];
  downloadEnabled?: boolean;
}) {
  if (reports.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent reports</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {reports.map((report) => {
            // Worst status wins. One bounce out of five deliveries is exactly
            // the thing the reader needs to see, and an aggregate "sent" would
            // bury it.
            const bounced = report.deliveries.some((d) => d.status === "BOUNCED");
            const delivered =
              report.deliveries.length > 0 &&
              report.deliveries.every((d) => d.status === "DELIVERED");
            return (
              <li
                key={report.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="glass-icon shrink-0">
                    <FileText
                      className="size-5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </span>
                  <a
                    // A plain anchor, not a Link, for the same reason as the
                    // CSV export: this returns a file. It used to point at
                    // `/reports/${report.id}`, which no route ever served, so
                    // every row in this card was a 404 -- and because Next
                    // prefetches Links, it 404'd on hover without anyone
                    // clicking. The PDF is the report as far as a reader is
                    // concerned, so link the artifact rather than build a
                    // second rendering of it.
                    href={downloadEnabled ? `/api/reports/${report.id}/pdf` : undefined}
                    aria-disabled={!downloadEnabled || undefined}
                    className="block min-w-0"
                  >
                    <span className="block truncate text-text">
                      {report.shift.site.name}
                    </span>
                    <span className="block text-sm text-text-muted">
                      {formatClock(report.createdAt, report.shift.site.timezone)}
                    </span>
                  </a>
                </div>
                <Badge tone={bounced ? "danger" : delivered ? "primary" : "neutral"}>
                  {bounced ? "Bounced" : delivered ? "Delivered" : "Sent"}
                </Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
