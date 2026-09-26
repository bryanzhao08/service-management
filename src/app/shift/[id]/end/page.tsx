import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EndOfShiftFlow } from "@/components/shift/end-of-shift-flow";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";
import {
  endOfShiftData,
  recipientsForSend,
  startEndFlow,
  summaryTemplate,
} from "@/lib/db/shift-end";
import { formatClock } from "@/lib/time";
import { capabilitiesFor } from "@/lib/sites/logging-mode";

export const metadata: Metadata = { title: "End of shift" };

/**
 * Section 9.4. Four steps, one screen each.
 *
 * Server-rendered because every number on step 1 is a claim the guard is about
 * to put their name on. Counting entries on the client from whatever happens
 * to be in memory would let a tab that has been open since midnight report
 * last night's totals.
 */
export default async function EndOfShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUnlockedActor();
  const scoped = db(actor);

  const shift = await scoped.shift.findByIdWithSite(id);
  if (!shift) notFound();

  // A supervisor can read the shift but cannot end it. Sending them to the
  // read-only view is friendlier than a permission error on a screen whose
  // every button they would be refused.
  if (shift.guardId !== actor.userId) redirect(`/shift/${id}`);

  // Start the end-of-shift clock here, on the server, during the render that
  // puts the screen in front of the guard.
  //
  // It used to be a client effect calling a server action, which meant the
  // number this product is sold on only started if JavaScript hydrated and a
  // round trip completed. In a stairwell at 6am -- the exact condition this is
  // built for -- that silently under-reports, and it under-reports in the
  // direction that flatters us. `startEndFlow` is first-write-wins, so doing it
  // on every render is safe and re-entry still cannot reset it.
  // A site with no recipient list is not asked for one. `recipientsForSend`
  // would happily return an empty pair, but the query still runs and the shape
  // still reads as "we looked and found nobody" rather than "there is nobody
  // to look for".
  const sends = shift.site.loggingMode !== "VERBAL";
  const [data, recipients, reports] = await Promise.all([
    endOfShiftData(id),
    sends
      ? recipientsForSend(id, shift.siteId)
      : Promise.resolve({ configured: [], oneOffs: [] as string[] }),
    sends ? scoped.report.listForShift(id) : Promise.resolve([]),
    shift.clockOutAt === null ? startEndFlow(id) : Promise.resolve(),
  ]);
  if (!data) notFound();

  const prefilled = data.summary ?? summaryTemplate(data, formatClock);
  const capabilities = capabilitiesFor(data.loggingMode);

  return (
    <EndOfShiftFlow
      shiftId={id}
      siteName={data.siteName}
      timeZone={data.siteTimezone}
      reportMode={capabilities.report}
      alreadyClockedOut={data.clockOutAt !== null}
      startedAt={data.endFlowStartedAt?.toISOString() ?? null}
      clockInAt={data.clockInAt?.toISOString() ?? null}
      clockOutAt={data.clockOutAt?.toISOString() ?? null}
      review={{
        counts: data.counts,
        incidents: data.incidents.map((incident) => ({
          id: incident.id,
          code: incident.code,
          text: incident.text,
          severity: incident.severity,
          open: incident.resolvedAt === null && incident.ongoingSince !== null,
        })),
        unattachedPhotos: data.unattachedPhotos,
        blindSpots: data.blindSpots,
        propertyChecks: data.propertyChecks,
      }}
      summary={prefilled}
      handoffNote={data.handoffNote ?? ""}
      recipients={recipients.configured.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        roleLabel: r.roleLabel,
        required: r.required,
        status: r.status,
      }))}
      oneOffs={recipients.oneOffs}
      reports={reports.map((report) => ({
        id: report.id,
        version: report.version,
        status: report.status,
        bytes: report.bytes,
        pages: report.pages,
        sentAt: report.sentAt?.toISOString() ?? null,
        ready: report.storageKey !== null,
      }))}
    />
  );
}
