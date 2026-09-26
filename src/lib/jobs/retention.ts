import { deleteMediaRows, expiredMedia } from "@/lib/db/retention";
import { storage } from "@/lib/storage/driver";
import { mediaPrefix } from "@/lib/storage/keys";

/**
 * Deletes the objects first, then the rows.
 *
 * In that order a crash in the middle leaves a row pointing at missing bytes,
 * which the next pass finishes. The other order leaves objects nothing
 * references — invisible, unbilled to anyone's attention, and kept past the
 * retention window the company set, which is the exact promise being broken.
 */
export async function applyRetention(limit = 500): Promise<{
  deleted: number;
  objectsFailed: number;
}> {
  const candidates = await expiredMedia(limit);
  if (candidates.length === 0) return { deleted: 0, objectsFailed: 0 };

  const removable: string[] = [];
  let objectsFailed = 0;

  for (const candidate of candidates) {
    try {
      await storage().deletePrefix(
        mediaPrefix({
          companyId: candidate.companyId,
          siteId: candidate.siteId,
          shiftId: candidate.shiftId,
          mediaId: candidate.mediaId,
        }),
      );
      removable.push(candidate.mediaId);
    } catch {
      // Leave the row. Deleting it now would strand the object forever, since
      // the row is the only thing that names it.
      objectsFailed += 1;
    }
  }

  return { deleted: await deleteMediaRows(removable), objectsFailed };
}
