import type { Metadata } from "next";
import Link from "next/link";

import { AppChrome } from "@/components/app-chrome";
import {
  GuardDashboardView,
  RecentReports,
} from "@/components/dashboard/guard-dashboard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, requireUnlockedActor } from "@/lib/auth/guards";
import { db, type Actor } from "@/lib/db/scoped";
import { averageEndFlowMs } from "@/lib/db/shift-end";
import { formatClock } from "@/lib/time";

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
    <>
      <AppChrome />
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-4 pb-28 sm:px-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-text">
            {can.viewAllShiftsAtSite(actor) ? "Site overview" : "Your shifts"}
          </h1>
          <p className="text-sm text-text-muted capitalize">
            {me?.name ?? "Signed in"} · {actor.role.toLowerCase().replace("_", " ")}
          </p>
        </header>

        {can.viewAllShiftsAtSite(actor) ? (
          <SupervisorView actor={actor} />
        ) : (
          <GuardView actor={actor} />
        )}
      </main>
    </>
  );
}

async function GuardView({ actor }: { actor: Actor }) {
  const scoped = db(actor);
  const [active, startable, recent, pace, assignedSites] = await Promise.all([
    scoped.shift.findActiveForActor(),
    scoped.shift.findStartableForActor(),
    scoped.shift.recentReportsForActor(3),
    averageEndFlowMs(actor.userId, startOfMonth()),
    scoped.shift.assignedSitesForActor(),
  ]);

  return (
    <GuardDashboardView
      active={active}
      startable={startable}
      recent={recent}
      pace={pace}
      assignedSites={assignedSites}
    />
  );
}

/** Midnight on the 1st, in the viewer's own clock. */
function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
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
