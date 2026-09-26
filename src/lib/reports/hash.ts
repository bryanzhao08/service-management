import { createHash } from "node:crypto";
import type { ReportSource } from "@/lib/db/reports";

/**
 * Two different hashes, because they answer two different questions and
 * conflating them produces a number that cannot verify anything.
 *
 * **Content hash** (`contentHash`, printed in the PDF footer). A digest of the
 * canonical facts the report was built from: the shift times, every entry with
 * its `occurredAt`, every incident, every revision. It goes *inside* the
 * document because it can: it does not depend on the rendered bytes. Anyone
 * with database access can recompute it and prove the PDF describes the log
 * that actually exists. Change an entry after the fact and it moves.
 *
 * **File hash** (`Report.sha256`, shown in the app and the delivery email). A
 * digest of the finished PDF bytes. It cannot go in the footer — stamping a
 * hash into a document changes the document, so the printed value would be the
 * hash of a file nobody has. It answers "is the attachment I received the one
 * Transient sent", which the content hash cannot.
 *
 * Section 11 offered a second render pass or a receipt page and said to pick
 * one and document it. Both of those produce a self-referential hash, so this
 * picks neither, and this comment is the documentation.
 */
export function contentHash(shift: ReportSource): string {
  const canonical = {
    shift: {
      id: shift.id,
      clockInAt: iso(shift.clockInAt),
      clockOutAt: iso(shift.clockOutAt),
      scheduledStart: iso(shift.scheduledStart),
      scheduledEnd: iso(shift.scheduledEnd),
      isEventNight: shift.isEventNight,
      summary: shift.summary ?? null,
      handoffNote: shift.handoffNote ?? null,
    },
    site: { id: shift.site.id, name: shift.site.name, code: shift.site.code },
    guard: { id: shift.guard.id, name: shift.guard.name ?? null },
    // Sorted by id, not by the query's order, so a change to an `orderBy`
    // somewhere else cannot silently move the hash of an unchanged shift.
    propertyChecks: [...shift.propertyChecks].sort(byId).map((c) => ({
      id: c.id,
      areaId: c.areaId,
      result: c.result,
      note: c.note ?? null,
    })),
    blindSpotChecks: [...shift.blindSpotChecks].sort(byId).map((c) => ({
      id: c.id,
      blindSpotId: c.blindSpotId,
      method: c.method,
      at: iso(c.at),
      reason: c.reason ?? null,
    })),
    entries: [...shift.entries].sort(byId).map((e) => ({
      id: e.id,
      type: e.type,
      occurredAt: iso(e.occurredAt),
      text: e.text ?? null,
      areaId: e.areaId ?? null,
      deletedAt: iso(e.deletedAt),
      deleteReason: e.deleteReason ?? null,
      revisions: e.revisions.length,
      mediaIds: e.media.map((m) => m.id).sort(),
      incident: e.incident
        ? {
            code: e.incident.code,
            categoryKey: e.incident.categoryKey,
            severity: e.incident.severity,
            status: e.incident.status,
            resolutionNote: e.incident.resolutionNote ?? null,
          }
        : null,
      packageInfo: e.packageInfo
        ? {
            carrier: e.packageInfo.carrier ?? null,
            trackingNumber: e.packageInfo.trackingNumber ?? null,
            recipientName: e.packageInfo.recipientName ?? null,
            deliveredAt: iso(e.packageInfo.deliveredAt),
            deliveredTo: e.packageInfo.deliveredTo ?? null,
          }
        : null,
    })),
  };
  return sha256(JSON.stringify(canonical));
}

export function sha256(input: string | Buffer | Uint8Array): string {
  return createHash("sha256")
    .update(input instanceof Uint8Array ? Buffer.from(input) : input)
    .digest("hex");
}

/** First 16 hex chars. A full digest wraps the footer and nobody reads it. */
export function shortHash(hex: string): string {
  return hex.slice(0, 16);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
