import "server-only";

import {
  type ExportedEntry,
  EXPORT_ROW_CAP,
  exportIdentity,
  myEntries,
} from "@/lib/db/my-entries";
import { csvDocument } from "@/lib/export/csv";
import type { Actor } from "@/lib/db/scoped";

export { myEntries, type ExportedEntry } from "@/lib/db/my-entries";

/**
 * Formats "all my entries" for download — section 9.10.
 *
 * Formatting only. The query lives in `@/lib/db/my-entries` because raw Prisma
 * access is confined to the db layer (section 17), and that separation is
 * worth more than the one import it costs: the scoping rule is then checkable
 * by reading one directory instead of grepping the whole tree.
 */

export type ExportEnvelope = {
  exportedAt: string;
  user: { id: string; name: string; email: string };
  company: { id: string; name: string };
  entryCount: number;
  truncated: boolean;
  entries: ExportedEntry[];
};

export async function entriesJson(actor: Actor): Promise<ExportEnvelope> {
  const [identity, entries] = await Promise.all([
    exportIdentity(actor),
    myEntries(actor),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user: identity.user,
    company: identity.company,
    entryCount: entries.length,
    // Stated in the file itself. An export that quietly stops at the cap is
    // indistinguishable from one that is genuinely complete, and the person
    // reading it months later has no way to tell.
    truncated: entries.length === EXPORT_ROW_CAP,
    entries,
  };
}

export function entriesCsv(entries: readonly ExportedEntry[]): string {
  return csvDocument(
    [
      "Occurred at",
      "Site",
      "Type",
      "Text",
      "Incident code",
      "Severity",
      "Incident status",
      "Area",
      "Photos",
      "Edited at",
      "Deleted at",
      "Deleted reason",
      "Shift ID",
      "Entry ID",
    ],
    entries.map((entry) => [
      entry.occurredAt,
      entry.siteName,
      entry.type,
      entry.text ?? "",
      entry.incidentCode ?? "",
      entry.severity ?? "",
      entry.incidentStatus ?? "",
      entry.areaName ?? "",
      entry.photoCount,
      entry.editedAt ?? "",
      entry.deletedAt ?? "",
      entry.deletedReason ?? "",
      entry.shiftId,
      entry.id,
    ]),
  );
}
