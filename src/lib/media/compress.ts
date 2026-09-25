/**
 * Client-side image compression (section 10.2).
 *
 * The browser sends a *transfer* variant, not the camera original. A modern
 * phone photo is 4-8 MB; on the LTE a guard actually has in a parking
 * structure that is a minute of upload per picture, and the outbox fills
 * faster than it drains. 2048 px at quality 0.82 is roughly 300-600 KB and is
 * still more resolution than a Letter-width PDF embed can show.
 *
 * Re-encoding through a canvas also strips EXIF as a side effect, which is
 * what section 10.2 asks for: GPS must not ride along into a report by
 * default. The two facts worth keeping — capture time and pixel dimensions —
 * are read off the original here and sent as explicit fields instead, so
 * nothing depends on metadata surviving the round trip.
 */

export const MAX_LONG_EDGE = 2048;
export const JPEG_QUALITY = 0.82;

export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
  /** EXIF DateTimeOriginal when the file carries one, else the file's mtime. */
  capturedAt: Date;
};

/**
 * Reads EXIF DateTimeOriginal (0x9003) out of a JPEG without a dependency.
 *
 * Only the one tag is parsed. A full EXIF library would be ~40 KB shipped to a
 * phone to answer a single question, and every other tag is deliberately being
 * discarded two lines later anyway.
 */
export function readExifCapturedAt(buffer: ArrayBuffer): Date | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    // APP1 is where EXIF lives.
    if (marker === 0xe1) {
      const exifStart = offset + 4;
      if (exifStart + 8 > view.byteLength) return null;
      if (view.getUint32(exifStart) !== 0x45786966) return null; // "Exif"
      const tiff = exifStart + 6;
      if (tiff + 8 > view.byteLength) return null;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd0 = tiff + view.getUint32(tiff + 4, little);
      const found = findTag(view, tiff, ifd0, little, 0x9003, 0);
      return found ? parseExifDate(found) : null;
    }
    if (marker === 0xda) return null; // start of scan, no EXIF
    offset += 2 + size;
  }
  return null;
}

/** Walks one IFD, following the EXIF sub-IFD pointer (0x8769) once. */
function findTag(
  view: DataView,
  tiff: number,
  ifd: number,
  little: boolean,
  wanted: number,
  depth: number,
): string | null {
  if (depth > 1 || ifd + 2 > view.byteLength) return null;
  const count = view.getUint16(ifd, little);
  let subIfd: number | null = null;

  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = view.getUint16(entry, little);
    if (tag === 0x8769) {
      subIfd = tiff + view.getUint32(entry + 8, little);
      continue;
    }
    if (tag !== wanted) continue;

    const length = view.getUint32(entry + 4, little);
    const valueOffset = tiff + view.getUint32(entry + 8, little);
    if (length < 1 || valueOffset + length > view.byteLength) return null;
    let out = "";
    for (let c = 0; c < length - 1; c += 1) {
      out += String.fromCharCode(view.getUint8(valueOffset + c));
    }
    return out;
  }

  return subIfd === null
    ? null
    : findTag(view, tiff, subIfd, little, wanted, depth + 1);
}

/** EXIF dates are "YYYY:MM:DD HH:MM:SS" in local time with no zone. */
export function parseExifDate(raw: string): Date | null {
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function scaleToFit(
  width: number,
  height: number,
  longEdge = MAX_LONG_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longEdge) return { width, height };
  const ratio = longEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const buffer = await file.arrayBuffer();
  const exifDate = readExifCapturedAt(buffer);

  const bitmap = await createImageBitmap(new Blob([buffer], { type: file.type }));
  const target = scaleToFit(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process the photo.");
  context.drawImage(bitmap, 0, 0, target.width, target.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) throw new Error("This browser could not encode the photo.");

  return {
    blob,
    width: target.width,
    height: target.height,
    capturedAt: exifDate ?? new Date(file.lastModified || Date.now()),
  };
}
