import { prisma } from "./client";

/**
 * Data retention (section 17: "optional auto-delete media after N days while
 * keeping the PDF").
 *
 * `Company.retentionDays` is null by default, which means keep everything. A
 * company that sets it is asking for the photos to go, not the record: the
 * `Entry` rows, the `Incident` rows and the generated report PDF all survive,
 * so a shift that happened is still a shift that happened. Only the media
 * objects and their rows are removed.
 *
 * This runs from the sweep rather than a separate schedule because it is the
 * same failure mode as a stuck job: if nothing runs it, nothing tells you.
 */

export type RetentionCandidate = {
  mediaId: string;
  companyId: string;
  siteId: string;
  shiftId: string;
};

/**
 * Media that is past its company's retention window.
 *
 * Dated from the shift, not from `Media.createdAt`: a photo uploaded late from
 * the offline outbox belongs to the night it was taken, and dating it from
 * upload would keep it around longer than the company asked.
 */
export async function expiredMedia(limit = 500): Promise<RetentionCandidate[]> {
  return prisma.$queryRaw<RetentionCandidate[]>`
    SELECT m.id AS "mediaId", c.id AS "companyId",
           s."siteId" AS "siteId", s.id AS "shiftId"
    FROM "Media" m
    JOIN "Shift" s ON s.id = m."shiftId"
    JOIN "Site" si ON si.id = s."siteId"
    JOIN "Company" c ON c.id = si."companyId"
    WHERE c."retentionDays" IS NOT NULL
      AND COALESCE(s."clockOutAt", s."scheduledEnd")
          < (now() AT TIME ZONE 'UTC') - make_interval(days => c."retentionDays")
    ORDER BY s."scheduledEnd"
    LIMIT ${Math.max(1, Math.min(2000, Math.trunc(limit)))}`;
}

export async function deleteMediaRows(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { count } = await prisma.media.deleteMany({ where: { id: { in: ids } } });
  return count;
}
