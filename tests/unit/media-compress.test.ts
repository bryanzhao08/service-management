import { describe, expect, it } from "vitest";

import {
  MAX_LONG_EDGE,
  parseExifDate,
  readExifCapturedAt,
  scaleToFit,
} from "@/lib/media/compress";

/**
 * The pure half of the compression path. `compressImage` itself needs a canvas
 * and a real decoder, so it is proven in the browser gate instead; everything
 * testable without one is tested here.
 */

describe("scaleToFit", () => {
  it("leaves an image that already fits alone", () => {
    expect(scaleToFit(1024, 768)).toEqual({ width: 1024, height: 768 });
  });

  it("caps the long edge and keeps the aspect ratio", () => {
    const result = scaleToFit(4032, 3024);
    expect(Math.max(result.width, result.height)).toBe(MAX_LONG_EDGE);
    expect(result.width / result.height).toBeCloseTo(4032 / 3024, 2);
  });

  it("caps the long edge when the image is portrait", () => {
    const result = scaleToFit(3024, 4032);
    expect(result).toEqual({ width: 1536, height: 2048 });
  });

  it("never rounds a thin image down to zero pixels", () => {
    const result = scaleToFit(8000, 3);
    expect(result.width).toBe(MAX_LONG_EDGE);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe("parseExifDate", () => {
  it("reads the colon-separated EXIF format", () => {
    const date = parseExifDate("2026:09:24 22:41:07");
    expect(date?.getFullYear()).toBe(2026);
    // EXIF months are 1-based, JS months are 0-based. Getting this wrong puts
    // every photo one month out, which nothing else in the app would catch.
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(24);
    expect(date?.getHours()).toBe(22);
    expect(date?.getMinutes()).toBe(41);
    expect(date?.getSeconds()).toBe(7);
  });

  it("rejects an ISO string, which EXIF never uses", () => {
    expect(parseExifDate("2026-09-24T22:41:07Z")).toBeNull();
  });

  it("rejects a blank tag", () => {
    expect(parseExifDate("")).toBeNull();
  });
});

/** Builds a minimal but structurally real JPEG carrying one EXIF date tag. */
function jpegWithCaptureDate(value: string): ArrayBuffer {
  const ascii = `${value}\0`;
  // TIFF header (8) + IFD0 count (2) + 1 entry (12) + next-IFD (4)
  //   + EXIF IFD count (2) + 1 entry (12) + next (4) + the string
  const tiffLength = 8 + 2 + 12 + 4 + 2 + 12 + 4 + ascii.length;
  const tiff = new DataView(new ArrayBuffer(tiffLength));
  const LE = true;

  tiff.setUint16(0, 0x4949, LE); // "II", little endian
  tiff.setUint16(2, 0x002a, LE);
  tiff.setUint32(4, 8, LE); // IFD0 at offset 8

  // IFD0: one entry, the pointer to the EXIF sub-IFD.
  tiff.setUint16(8, 1, LE);
  tiff.setUint16(10, 0x8769, LE);
  tiff.setUint16(12, 4, LE); // LONG
  tiff.setUint32(14, 1, LE);
  const exifIfd = 26;
  tiff.setUint32(18, exifIfd, LE);
  tiff.setUint32(22, 0, LE); // no IFD1

  // EXIF sub-IFD: one entry, DateTimeOriginal.
  tiff.setUint16(exifIfd, 1, LE);
  tiff.setUint16(exifIfd + 2, 0x9003, LE);
  tiff.setUint16(exifIfd + 4, 2, LE); // ASCII
  tiff.setUint32(exifIfd + 6, ascii.length, LE);
  const stringAt = exifIfd + 2 + 12 + 4;
  tiff.setUint32(exifIfd + 10, stringAt, LE);
  tiff.setUint32(exifIfd + 2 + 12, 0, LE);
  for (let i = 0; i < ascii.length; i += 1) {
    tiff.setUint8(stringAt + i, ascii.charCodeAt(i));
  }

  const payload = new Uint8Array(tiff.buffer);
  const app1Length = 2 + 6 + payload.length;
  const out = new Uint8Array(2 + 2 + app1Length);
  out[0] = 0xff;
  out[1] = 0xd8; // SOI
  out[2] = 0xff;
  out[3] = 0xe1; // APP1
  new DataView(out.buffer).setUint16(4, app1Length);
  out.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"
  out.set(payload, 12);
  return out.buffer;
}

describe("readExifCapturedAt", () => {
  it("finds DateTimeOriginal through the EXIF sub-IFD pointer", () => {
    const date = readExifCapturedAt(jpegWithCaptureDate("2026:09:24 22:41:07"));
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(24);
  });

  it("returns null for bytes that are not a JPEG", () => {
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer;
    expect(readExifCapturedAt(notJpeg)).toBeNull();
  });

  it("returns null for a JPEG with no APP1 segment", () => {
    // SOI then straight to start-of-scan: a valid JPEG with no metadata.
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer;
    expect(readExifCapturedAt(bare)).toBeNull();
  });

  it("returns null rather than reading past the end of a truncated file", () => {
    const full = new Uint8Array(jpegWithCaptureDate("2026:09:24 22:41:07"));
    const truncated = full.slice(0, 20).buffer;
    expect(() => readExifCapturedAt(truncated)).not.toThrow();
    expect(readExifCapturedAt(truncated)).toBeNull();
  });
});
