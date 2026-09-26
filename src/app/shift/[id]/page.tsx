import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ShiftTimeline } from "@/components/shift/shift-timeline";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";

export const metadata: Metadata = { title: "Shift" };

/**
 * Section 9.3. The screen the guard lives on all night.
 *
 * Rendered on the server so the first paint already has the night's entries:
 * a guard reopening the tab at 4am should not watch a spinner. Everything
 * added after that is client state, reconciled against the server through the
 * entry `clientId`.
 */
export default async function ShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUnlockedActor();
  const scoped = db(actor);

  const shift = await scoped.shift.findByIdWithSite(id);
  if (!shift) notFound();

  const [site, entries] = await Promise.all([
    scoped.site.withConfig(shift.siteId),
    scoped.entry.listForShift(shift.id),
  ]);
  if (!site) notFound();

  // A supervisor reading a guard's shift is a legitimate, read-only view
  // (section 8). The write surface is gated on ownership, not on the route,
  // so the page passes the fact down rather than branching into a second one.
  const canWrite = shift.guardId === actor.userId && shift.clockOutAt === null;

  return (
    <ShiftTimeline
      canWrite={canWrite}
      shift={{
        id: shift.id,
        clockInAt: shift.clockInAt?.toISOString() ?? null,
        clockOutAt: shift.clockOutAt?.toISOString() ?? null,
        isEventNight: shift.isEventNight,
        guardName: shift.guard.name ?? shift.guard.email ?? "Guard",
      }}
      site={{
        id: site.id,
        name: site.name,
        code: site.code,
        timezone: site.timezone,
        areas: site.areas.map((a) => ({ id: a.id, name: a.name })),
        // One configured list serves both the incident category chips and
        // the "More > custom entry type" menu. The schema has no discriminator
        // between them (recorded in ASSUMPTIONS.md) and the seeded list is
        // exactly section 9.3's category set, so the categories are the
        // primary reading and a custom entry simply reuses a row.
        entryTypes: site.entryTypes
          .filter((t) => t.enabled)
          .map((t) => ({ id: t.id, label: t.label, key: t.key, color: t.color })),
      }}
      initialEntries={entries.map((entry) => ({
        id: entry.id,
        clientId: entry.clientId,
        type: entry.type,
        occurredAt: entry.occurredAt.toISOString(),
        text: entry.text,
        deletedAt: entry.deletedAt?.toISOString() ?? null,
        areaName: entry.area?.name ?? null,
        revisionCount: entry.revisions.length,
        mediaCount: entry.media.length,
        // The ids, not URLs: the client builds `/api/media/<id>?variant=thumb`
        // so the route stays the one place that decides which stored object a
        // viewer is allowed to see.
        media: entry.media.map((m) => ({ id: m.id, status: m.status })),
        incident: entry.incident
          ? {
              id: entry.incident.id,
              code: entry.incident.code,
              categoryKey: entry.incident.categoryKey,
              severity: entry.incident.severity,
              status: entry.incident.status,
              ongoingSince: entry.incident.ongoingSince?.toISOString() ?? null,
            }
          : null,
        packageInfo: entry.packageInfo
          ? {
              id: entry.packageInfo.id,
              carrier: entry.packageInfo.carrier,
              trackingNumber: entry.packageInfo.trackingNumber,
              recipientName: entry.packageInfo.recipientName,
              deliveredAt: entry.packageInfo.deliveredAt?.toISOString() ?? null,
            }
          : null,
      }))}
    />
  );
}
