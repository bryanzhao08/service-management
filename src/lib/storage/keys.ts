/**
 * Storage keys.
 *
 * Section 10.6 fixes the layout as
 * `{companyId}/{siteId}/{shiftId}/{mediaId}/{variant}.jpg`. That order is not
 * cosmetic: it makes every deletion this app needs a prefix delete. Dropping a
 * company, a site, a shift or one photo's whole variant set is a single prefix,
 * which is what makes the retention setting in section 17 implementable without
 * a database query per object.
 *
 * Keys are built here and nowhere else, so the prefix property cannot be
 * quietly broken by a caller that concatenates its own string.
 */

export const MEDIA_VARIANTS = ["original", "thumb", "pdf", "poster"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/**
 * Ids are cuids, but a key is a path, so anything that could escape the prefix
 * is rejected rather than escaped. A `..` segment here would let one shift's
 * upload land in another company's prefix, which is the same isolation failure
 * `lib/db/scoped.ts` exists to prevent on the database side.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function segment(name: string, value: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`Unsafe storage key segment for ${name}: ${JSON.stringify(value)}`);
  }
  return value;
}

export type MediaKeyParts = {
  companyId: string;
  siteId: string;
  shiftId: string;
  mediaId: string;
  variant: MediaVariant;
  /** Videos keep their own extension; everything sharp produces is jpg. */
  ext?: string;
};

export function mediaKey({
  companyId,
  siteId,
  shiftId,
  mediaId,
  variant,
  ext = "jpg",
}: MediaKeyParts): string {
  const prefix = mediaPrefix({ companyId, siteId, shiftId, mediaId });
  return `${prefix}/${segment("variant", variant)}.${segment("ext", ext)}`;
}

/** Everything belonging to one media row, for a single-prefix delete. */
export function mediaPrefix(parts: {
  companyId: string;
  siteId: string;
  shiftId: string;
  mediaId: string;
}): string {
  return [
    segment("companyId", parts.companyId),
    segment("siteId", parts.siteId),
    segment("shiftId", parts.shiftId),
    segment("mediaId", parts.mediaId),
  ].join("/");
}

export function reportKey(parts: {
  companyId: string;
  siteId: string;
  shiftId: string;
  reportId: string;
  version: number;
}): string {
  return [
    segment("companyId", parts.companyId),
    segment("siteId", parts.siteId),
    segment("shiftId", parts.shiftId),
    "reports",
    `${segment("reportId", parts.reportId)}-v${parts.version}.pdf`,
  ].join("/");
}

/**
 * The company a key belongs to, used by the download route to check that the
 * caller's company owns the object *before* signing a URL for it. Returns null
 * rather than throwing so a malformed key is a 404, not a 500.
 */
export function companyIdFromKey(key: string): string | null {
  const first = key.split("/")[0];
  if (!first || !SAFE_SEGMENT.test(first)) return null;
  return first;
}
