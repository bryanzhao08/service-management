import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, requireUnlockedActor } from "@/lib/auth/guards";
import { db, type Actor } from "@/lib/db/scoped";
import { formatClock, formatElapsed } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Section 9.1. Two genuinely different screens behind one route, because the
 * two roles arrive with different questions.
 *
 * A guard opens this on a phone, outside, about to start work. The only
 * question is "which shift, and start it" — so that is one large target and
 * everything else is secondary.
 *
 * A supervisor opens it to find out what is wrong right now. That is a scan
 * across sites, so it is a table, and anything needing action is lifted above
 * the table rather than left to be spotted inside it.
 */
export default async function DashboardPage() {
  const actor = await requireUnlockedActor();
  const me = await db(actor).user.findById(actor.userId);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-text">{me?.name ?? "Signed in"}</h1>
        <p className="text-sm text-text-muted capitalize">
          {actor.role.toLowerCase().replace("_", " ")}
        </p>
      </header>

      {can.viewAllShiftsAtSite(actor) ? (
        <SupervisorView actor={actor} />
      ) : (
        <GuardView actor={actor} />
      )}
    </main>
  );
}

async function GuardView({ actor }: { actor: Actor }) {
  const scoped = db(actor);
  const [active, startable, recent] = await Promise.all([
    scoped.shift.findActiveForActor(),
    scoped.shift.findStartableForActor(),
    scoped.shift.recentReportsForActor(3),
  ]);

  // An active shift is the only thing that matters while it is running, so it
  // replaces the start card rather than sitting beside it. Two primary buttons
  // on one screen is how a guard clocks into the wrong shift.
  const next = startable.find((shift) => shift.id !== active?.id);
  const others = startable.filter((shift) => shift.id !== next?.id);

  return (
    <div className="space-y-6">
      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>On shift</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-lg font-medium text-text">{active.site.name}</p>
              <p className="text-sm text-text-muted">
                {active.clockInAt
                  ? `Started ${formatClock(active.clockInAt, active.site.timezone)} · ${formatElapsed(active.clockInAt, new Date())} elapsed`
                  : "Not clocked in yet"}
              </p>
            </div>
            <Button asChild size="xl" className="w-full">
              <Link href={`/shift/${active.id}`}>Resume shift</Link>
            </Button>
          </CardContent>
        </Card>
      ) : next ? (
        <Card>
          <CardHeader>
            <CardTitle>Next shift</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-lg font-medium text-text">{next.site.name}</p>
              <p className="text-sm text-text-muted">
                {next.template?.name ?? "Scheduled"} ·{" "}
                {formatClock(next.scheduledStart, next.site.timezone)}
              </p>
            </div>
            <Button asChild size="xl" className="w-full">
              <Link href={`/shift/${next.id}/start`}>Start shift</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-text-muted">No shifts scheduled for you.</p>
          </CardContent>
        </Card>
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

      <RecentReports reports={recent} />
    </div>
  );
}

async function SupervisorView({ actor }: { actor: Actor }) {
  const scoped = db(actor);
  const [sites, recent] = await Promise.all([
    scoped.site.findManyWithDuty(),
    scoped.shift.recentReportsForActor(3),
  ]);

  const attention = sites
    .map((site) => ({
      site,
      bounced: site.recipients.filter((r) => r.status === "BOUNCED").length,
      unverified: site.recipients.filter((r) => r.status === "UNVERIFIED").length,
    }))
    .filter((row) => row.bounced > 0 || row.unverified > 0);

  return (
    <div className="space-y-6">
      {attention.length > 0 ? (
        <Card className="border-attention">
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-text">
              {attention.map(({ site, bounced, unverified }) => (
                <li key={site.id}>
                  <Link
                    href={`/sites/${site.id}/recipients`}
                    className="font-medium underline decoration-border underline-offset-4"
                  >
                    {site.name}
                  </Link>
                  {": "}
                  {[
                    bounced > 0 ? `${bounced} bounced` : null,
                    unverified > 0 ? `${unverified} unverified` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Sites</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Sites you supervise, with the guard currently on duty and the number of
                unresolved incidents.
              </caption>
              <thead className="border-b border-border text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Site
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    On duty
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Started
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sites.map((site) => {
                  const onDuty = site.shifts[0];
                  return (
                    <tr key={site.id}>
                      <th scope="row" className="px-4 py-3 font-normal text-text">
                        {site.name}
                      </th>
                      <td className="px-4 py-3 text-text-muted">
                        {onDuty?.guard.name ?? "Nobody"}
                      </td>
                      <td className="px-4 py-3 font-mono text-text-muted tabular-nums">
                        {onDuty ? formatClock(onDuty.clockInAt, site.timezone) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {site._count.shifts > 0 ? (
                          <Badge tone="danger">{site._count.shifts}</Badge>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <RecentReports reports={recent} />
    </div>
  );
}

type RecentReport = Awaited<
  ReturnType<ReturnType<typeof db>["shift"]["recentReportsForActor"]>
>[number];

function RecentReports({ reports }: { reports: RecentReport[] }) {
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
                <div className="min-w-0">
                  <Link href={`/reports/${report.id}`} className="block min-w-0">
                    <span className="block truncate text-text">
                      {report.shift.site.name}
                    </span>
                    <span className="block text-sm text-text-muted">
                      {formatClock(report.createdAt, report.shift.site.timezone)}
                    </span>
                  </Link>
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
