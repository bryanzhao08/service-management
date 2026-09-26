import sharp from "sharp";
import { z } from "zod";

import { markMediaProcessed, mediaForProcessing } from "@/lib/db/jobs";
import { storage } from "@/lib/storage/driver";
import { mediaKey } from "@/lib/storage/keys";

/**
 * `PROCESS_MEDIA` (section 10.4).
 *
 * Derives the two variants the rest of the app reads: `thumb` for the grid and
 * `pdf` for embedding in a report. The original is never touched — it is the
 * evidence, and a guard's photo of a broken lock should not be lossy-recoded a
 * second time because a report needed to be smaller.
 *
 * This runs in a worker rather than in the request that recorded the upload
 * because `sharp` on a 2048px JPEG is tens to hundreds of milliseconds, and a
 * guard standing in the rain should not wait for it before the photo appears in
 * their timeline.
 */

// Section 10.4: thumb 400px q70, pdf 1600px long edge q72 progressive.
export const THUMB_LONG_EDGE = 400;
export const THUMB_QUALITY = 70;
export const PDF_LONG_EDGE = 1600;
export const PDF_QUALITY = 72;

export const processMediaPayload = z.object({ mediaId: z.string().min(1) });

export type ProcessMediaResult = {
  mediaId: string;
  result: "processed" | "gone" | "video";
};

export async function processMedia(rawPayload: unknown): Promise<ProcessMediaResult> {
  const { mediaId } = processMediaPayload.parse(rawPayload);

  const media = await mediaForProcessing(mediaId);
  // A missing row is success, not failure. Retention or a deleted shift can
  // remove the media between enqueue and run; retrying five times against a row
  // that will never exist again only fills the queue and leaves a FAILED job
  // for a human to read.
  if (!media) return { mediaId, result: "gone" };

  // Videos are never re-encoded and never embedded in a PDF (section 10.3). A
  // poster frame needs ffmpeg, which section 10.4 marks optional; until that
  // exists the honest end state is PROCESSED with no variants, not FAILED.
  if (media.kind === "VIDEO") {
    await markMediaProcessed(media.id);
    return { mediaId, result: "video" };
  }

  const source = await storage().get(media.storageKeyOriginal);
  const base = {
    companyId: media.shift.site.companyId,
    siteId: media.shift.siteId,
    shiftId: media.shift.id,
    mediaId: media.id,
  };

  // `rotate()` with no argument applies the EXIF orientation tag. It matters
  // even though the client strips EXIF on compress: an image that arrives with
  // orientation set would otherwise be re-derived sideways.
  const pipeline = sharp(source, { failOn: "none" }).rotate();
  const meta = await pipeline.metadata();

  const [thumb, pdfVariant] = await Promise.all([
    pipeline
      .clone()
      .resize({
        width: THUMB_LONG_EDGE,
        height: THUMB_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer(),
    pipeline
      .clone()
      .resize({
        width: PDF_LONG_EDGE,
        height: PDF_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: PDF_QUALITY, progressive: true })
      .toBuffer(),
  ]);

  const thumbKey = mediaKey({ ...base, variant: "thumb", ext: "jpg" });
  const pdfKey = mediaKey({ ...base, variant: "pdf", ext: "jpg" });

  // Both objects land before the row points at either. A crash between the two
  // puts an orphan in storage, which the sweep reclaims. A crash between the
  // row write and the object write would leave the row naming a key that is not
  // there, and every reader downstream would 404 on a photo the UI says exists.
  await storage().put(thumbKey, thumb, "image/jpeg");
  await storage().put(pdfKey, pdfVariant, "image/jpeg");

  await markMediaProcessed(media.id, {
    storageKeyThumb: thumbKey,
    storageKeyPdf: pdfKey,
    width: meta.width ?? null,
    height: meta.height ?? null,
  });

  return { mediaId, result: "processed" };
}
