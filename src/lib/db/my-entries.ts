import "server-only";

import { prisma } from "./client";
import type { Actor } from "./scoped";

/**
 * "Data export (all my entries as JSON + CSV)" — section 9.10.
 *
 * Scoped to the signed-in person, not to their company. This sits in the
 * personal settings screen next to their PIN and their theme, so "my entries"
 * means the ones they wrote. A supervisor who wants everything at a site uses
 * the reports history export, which is gated on a supervisor role and says so.
 *
 * Deleted entries are included and flagged, rather than dropped. A guard
 * exporting their own record after a dispute needs the full picture, and a
 * soft-deleted entry with its reason is evidence — silently omitting it would
 * make the export a worse record than the app it came from.
 */

/** Nobody has written more than this in a career, and it bounds the memory. */
export const EXPORT_ROW_CAP = 20000;

export type ExportedEntry = {
  id: string;
  shiftId: string;
  siteName: string;
  type: string;
  occurredAt: Date;
  createdAt: Date;
  text: string | null;
  incidentCode: string | null;
  severity: string | null;
  incidentStatus: string | null;
  areaName: string | null;
  photoCount: number;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedReason: string | null;
};

export async function myEntries(actor: Actor): Promise<ExportedEntry[]> {
  const rows = await prisma.entry.findMany({
    where: {
      // `Entry` carries no author column — authorship runs through the shift,
      // because in this product an entry is always written by whoever is on
      // that shift. So "my entries" is "entries on shifts I worked", which is
      // the honest reading of the only relationship the schema records.
      shift: { guardId: actor.userId, site: { companyId: actor.companyId } },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: EXPORT_ROW_CAP,
    select: {
      id: true,
      shiftId: true,
      type: true,
      occurredAt: true,
      createdAt: true,
      text: true,
      deletedAt: true,
      deleteReason: true,
      area: { select: { name: true } },
      shift: { select: { site: { select: { name: true } } } },
      incident: { select: { code: true, severity: true, status: true } },
      // `editedAt` is not a column: an edit writes an `EntryRevision`, so the
      // most recent one is the answer. Taking 1 rather than counting keeps
      // this a single indexed lookup per row.
      revisions: {
        orderBy: { editedAt: "desc" },
        take: 1,
        select: { editedAt: true },
      },
      _count: { select: { media: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    shiftId: row.shiftId,
    siteName: row.shift.site.name,
    type: row.type,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    text: row.text,
    incidentCode: row.incident?.code ?? null,
    severity: row.incident?.severity ?? null,
    incidentStatus: row.incident?.status ?? null,
    areaName: row.area?.name ?? null,
    photoCount: row._count.media,
    editedAt: row.revisions[0]?.editedAt ?? null,
    deletedAt: row.deletedAt,
    deletedReason: row.deleteReason,
  }));
}

/**
 * Who the export belongs to, for the JSON envelope.
 *
 * Named in the file so an export that gets emailed around still says whose
 * record it is. A bare array of entries with no owner is the kind of artefact
 * that gets attached to the wrong dispute.
 */
export async function exportIdentity(actor: Actor): Promise<{
  user: { id: string; name: string; email: string };
  company: { id: string; name: string };
}> {
  const [user, company] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { id: true, name: true, email: true },
    }),
    prisma.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { id: true, name: true },
    }),
  ]);
  return { user, company };
}
