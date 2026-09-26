import { prisma } from "@/lib/db/client";
import { type InlineType, storage } from "@/lib/storage/driver";

/**
 * The read-only photo gallery the report's QR code and email footer point at.
 *
 * It exists because a 40-photo night does not fit in an 8 MB PDF. The report
 * embeds what it can and links the rest here, so nothing a guard captured is
 * lost just because the file had a ceiling.
 *
 * Access is the opaque `Report.galleryToken`, not a session. That is a
 * deliberate trade: the people who need these photos are insurers, property
 * managers and lawyers who will never have an account, and a link that expires
 * is a better answer than a PDF that silently dropped half the evidence.
 */

export type GalleryItem = {
  id: string;
  kind: "PHOTO" | "VIDEO";
  /** Signed, short-lived. Null if the object is not readable. */
  thumbUrl: string | null;
  fullUrl: string | null;
  capturedAt: Date;
  /** The entry the photo hangs off, so a viewer knows what they are looking at. */
  caption: string | null;
  incidentCode: string | null;
};

export type GalleryData = {
  reportId: string;
  siteName: string;
  companyName: string;
  timeZone: string;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  version: number;
  expiresAt: Date | null;
  items: GalleryItem[];
};

export async function galleryByToken(token: string): Promise<GalleryData | null> {
  const report = await prisma.report.findUnique({
    where: { galleryToken: token },
    select: {
      id: true,
      version: true,
      galleryExpiresAt: true,
      shiftId: true,
      shift: {
        select: {
          clockInAt: true,
          clockOutAt: true,
          site: {
            select: {
              name: true,
              timezone: true,
              company: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!report) return null;
  // Expiry is checked here rather than at the route so every caller gets it.
  // A link that has lapsed has to read as gone, not as empty.
  if (report.galleryExpiresAt && report.galleryExpiresAt <= new Date()) return null;

  const media = await prisma.media.findMany({
    where: { shiftId: report.shiftId, status: { not: "FAILED" } },
    orderBy: { capturedAt: "asc" },
    select: {
      id: true,
      kind: true,
      storageKeyOriginal: true,
      storageKeyThumb: true,
      capturedAt: true,
      entry: {
        select: {
          text: true,
          incident: { select: { code: true } },
        },
      },
    },
  });

  const items = await Promise.all(
    media.map(async (item): Promise<GalleryItem> => {
      // A thumbnail that has not been built yet falls back to the original, so
      // a gallery opened minutes after the shift shows photos rather than
      // holes. Slower, and correct.
      const thumbKey = item.storageKeyThumb ?? item.storageKeyOriginal;
      return {
        id: item.id,
        kind: item.kind,
        // Inline only when this is the worker's own JPEG. On the fallback
        // path the key is the uploaded original, so it downloads instead of
        // rendering -- the same rule the in-app media route follows, and the
        // reason an uploaded .svg can never execute on this page.
        thumbUrl: await safeUrl(
          thumbKey,
          item.storageKeyThumb ? "image/jpeg" : undefined,
        ),
        fullUrl: await safeUrl(item.storageKeyOriginal),
        capturedAt: item.capturedAt,
        caption: item.entry?.text ?? null,
        incidentCode: item.entry?.incident?.code ?? null,
      };
    }),
  );

  return {
    reportId: report.id,
    siteName: report.shift.site.name,
    companyName: report.shift.site.company.name,
    timeZone: report.shift.site.timezone,
    shiftStart: report.shift.clockInAt,
    shiftEnd: report.shift.clockOutAt,
    version: report.version,
    expiresAt: report.galleryExpiresAt,
    items,
  };
}

/**
 * One unreadable object must not take the whole gallery down with it. A
 * missing key is a gap in the grid; a thrown error is a 500 on a link a
 * manager was given as proof.
 */
async function safeUrl(key: string, inline?: InlineType): Promise<string | null> {
  try {
    return await storage().presignDownload(key, undefined, inline);
  } catch {
    return null;
  }
}
