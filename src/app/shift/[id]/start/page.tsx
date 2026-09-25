import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClockInFlow } from "@/components/shift/clock-in-flow";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";

export const metadata: Metadata = { title: "Start shift" };

/**
 * Section 9.2. The server half: resolve everything the flow needs in one
 * round trip, because the guard may be on a car-park signal and each extra
 * request is another chance to stall mid clock-in.
 */
export default async function StartShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUnlockedActor();
  const scoped = db(actor);

  const shift = await scoped.shift.findByIdWithSite(id);
  // The scoped read already returns null for another company's shift, so this
  // is a 404 for "not yours" and "does not exist" alike. Section 17: never
  // confirm the existence of a record the caller cannot see.
  if (!shift) notFound();

  // Starting someone else's shift is not a permission the flow should even
  // render. clockIn() rejects it too — this is the polite half of that.
  if (shift.guardId !== actor.userId) notFound();

  const [site, handoff, existingProperty, existingBlindSpot] = await Promise.all([
    scoped.site.withConfig(shift.siteId),
    scoped.shift.findOpenHandoffSource({
      siteId: shift.siteId,
      excludeShiftId: shift.id,
    }),
    scoped.propertyCheck.listForShift(shift.id),
    scoped.blindSpotCheck.listForShift(shift.id),
  ]);
  if (!site) notFound();

  return (
    <ClockInFlow
      shift={{
        id: shift.id,
        clockInAt: shift.clockInAt?.toISOString() ?? null,
        isEventNight: shift.isEventNight,
        scheduledStart: shift.scheduledStart?.toISOString() ?? null,
        scheduledEnd: shift.scheduledEnd?.toISOString() ?? null,
      }}
      site={{
        id: site.id,
        name: site.name,
        timezone: site.timezone,
        areas: site.areas.map((a) => ({ id: a.id, name: a.name })),
        blindSpots: site.blindSpots.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
        })),
      }}
      handoff={
        handoff
          ? {
              shiftId: handoff.id,
              guardName: handoff.guard.name ?? handoff.guard.email ?? "Outgoing guard",
              openIncidents: handoff.entries
                .filter((entry) => entry.incident)
                .map((entry) => ({
                  id: entry.incident!.id,
                  code: entry.incident!.code,
                  category: entry.incident!.categoryKey,
                  severity: entry.incident!.severity,
                  text: entry.text,
                })),
              note: handoff.handoffNote,
            }
          : null
      }
      done={{
        property: existingProperty.map((c) => c.areaId),
        blindSpot: existingBlindSpot.map((c) => c.blindSpotId),
      }}
    />
  );
}
