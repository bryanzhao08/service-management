import { rm } from "node:fs/promises";

import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { claimJobs, enqueue, jobCounts } from "@/lib/db/jobs";
import {
  PDF_LONG_EDGE,
  processMedia,
  THUMB_LONG_EDGE,
} from "@/lib/jobs/handlers/process-media";
import { runJobs } from "@/lib/jobs/runner";
import { LOCAL_ROOT, storage } from "@/lib/storage/driver";
import { mediaKey } from "@/lib/storage/keys";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * The media worker, end to end, on real bytes.
 *
 * `sharp` is mocked nowhere here. A mocked encoder proves the function was
 * called, which is not the question — the question is whether what lands in
 * storage is a readable JPEG at the size section 10.4 asks for. That is only
 * answerable by decoding the output.
 */

beforeEach(async () => {
  await resetDatabase();
  // The local driver's root is a module constant, so the honest move is to
  // clear it rather than pretend it is configurable. `.data/` is gitignored.
  await rm(LOCAL_ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(LOCAL_ROOT, { recursive: true, force: true });
});

afterAll(async () => {
  await raw.$disconnect();
});

/** A deterministic photo, landscape and bigger than both targets. */
async function samplePhoto(width = 2048, height = 1536): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 32, g: 84, b: 160 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function seedPhoto(kind: "PHOTO" | "VIDEO" = "PHOTO") {
  const tenant = await createTenant("media");
  const mediaId = `media-${kind.toLowerCase()}-1`;
  const base = {
    companyId: tenant.company.id,
    siteId: tenant.site.id,
    shiftId: tenant.shift.id,
    mediaId,
  };
  const originalKey = mediaKey({
    ...base,
    variant: "original",
    ext: kind === "PHOTO" ? "jpg" : "mp4",
  });

  await storage().put(
    originalKey,
    kind === "PHOTO" ? await samplePhoto() : Buffer.from("not really a video"),
    kind === "PHOTO" ? "image/jpeg" : "video/mp4",
  );

  const media = await raw.media.create({
    data: {
      id: mediaId,
      shiftId: tenant.shift.id,
      kind,
      storageKeyOriginal: originalKey,
      bytes: 1,
      capturedAt: new Date("2026-02-01T08:00:00.000Z"),
      clientId: `client-${mediaId}`,
      status: "PENDING",
    },
  });

  return { tenant, media, base };
}

describe("processMedia", () => {
  it("writes a thumb and a pdf variant at the documented long edges", async () => {
    const { media } = await seedPhoto();

    const result = await processMedia({ mediaId: media.id });
    expect(result.result).toBe("processed");

    const row = await raw.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.status).toBe("PROCESSED");
    expect(row.storageKeyThumb).toBeTruthy();
    expect(row.storageKeyPdf).toBeTruthy();
    // Dimensions come from the original, not from a variant.
    expect(row.width).toBe(2048);
    expect(row.height).toBe(1536);

    const thumb = await sharp(await storage().get(row.storageKeyThumb!)).metadata();
    expect(thumb.format).toBe("jpeg");
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBe(THUMB_LONG_EDGE);

    const pdf = await sharp(await storage().get(row.storageKeyPdf!)).metadata();
    expect(pdf.format).toBe("jpeg");
    expect(Math.max(pdf.width ?? 0, pdf.height ?? 0)).toBe(PDF_LONG_EDGE);
    expect(pdf.isProgressive).toBe(true);

    // Aspect ratio preserved, so nothing is stretched in the report.
    expect((pdf.width ?? 0) / (pdf.height ?? 1)).toBeCloseTo(2048 / 1536, 2);
  });

  it("leaves the original untouched", async () => {
    const { media } = await seedPhoto();
    const before = await storage().get(media.storageKeyOriginal);

    await processMedia({ mediaId: media.id });

    const after = await storage().get(media.storageKeyOriginal);
    // The original is the evidence. Re-encoding it to save space would quietly
    // degrade the one artifact a dispute turns on.
    expect(after.equals(before)).toBe(true);
  });

  it("never enlarges a photo smaller than the targets", async () => {
    const { media } = await seedPhoto();
    await storage().put(
      media.storageKeyOriginal,
      await samplePhoto(320, 240),
      "image/jpeg",
    );

    await processMedia({ mediaId: media.id });

    const row = await raw.media.findUniqueOrThrow({ where: { id: media.id } });
    const pdf = await sharp(await storage().get(row.storageKeyPdf!)).metadata();
    expect(pdf.width).toBe(320);
    expect(pdf.height).toBe(240);
  });

  it("marks a video processed without variants rather than failing it", async () => {
    const { media } = await seedPhoto("VIDEO");

    const result = await processMedia({ mediaId: media.id });

    expect(result.result).toBe("video");
    const row = await raw.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.status).toBe("PROCESSED");
    expect(row.storageKeyThumb).toBeNull();
    expect(row.storageKeyPdf).toBeNull();
  });

  it("treats a deleted media row as done, not as a failure", async () => {
    // Retention can remove the row between enqueue and run. Retrying five times
    // against something that will never exist again only leaves a FAILED job
    // for a human to read.
    const result = await processMedia({ mediaId: "does-not-exist" });
    expect(result.result).toBe("gone");
  });

  it("rejects a payload that is not a media id", async () => {
    await expect(processMedia({})).rejects.toThrow();
    await expect(processMedia({ mediaId: "" })).rejects.toThrow();
  });
});

describe("runJobs", () => {
  it("drains a queued PROCESS_MEDIA job and records success", async () => {
    const { media } = await seedPhoto();
    await enqueue("PROCESS_MEDIA", { mediaId: media.id });

    const summary = await runJobs({ limit: 5 });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect((await jobCounts())["SUCCEEDED"]).toBe(1);
    const row = await raw.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.status).toBe("PROCESSED");
  });

  it("retries a broken job and finally fails both the job and the media", async () => {
    const { media } = await seedPhoto();
    // Point the row at bytes that are not an image. sharp throws, which is the
    // realistic shape of the failure: a truncated upload, not a missing file.
    await storage().put(media.storageKeyOriginal, Buffer.from("garbage"), "image/jpeg");
    const job = await enqueue("PROCESS_MEDIA", { mediaId: media.id });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const summary = await runJobs({ limit: 5 });
      expect(summary.failed).toBe(1);
      // Clear the backoff so the loop does not have to wait it out.
      await raw.job.updateMany({
        where: { id: job.id },
        data: { runAfter: new Date(Date.now() - 1000) },
      });
    }

    const row = await raw.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(5);
    expect(row.lastError).toBeTruthy();

    // The photo must say FAILED, not sit on "processing" forever with nothing
    // in the UI explaining why it never appeared.
    const failed = await raw.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(failed.status).toBe("FAILED");
  });

  it("refuses an unknown job type instead of silently dropping it", async () => {
    await enqueue("SEND_PUSH", { note: "no handler yet" });

    const summary = await runJobs({ limit: 5 });

    expect(summary.failed).toBe(1);
    const row = await raw.job.findFirstOrThrow({ where: { type: "SEND_PUSH" } });
    expect(row.lastError).toMatch(/SEND_PUSH/);
  });

  it("only touches the types it was asked for", async () => {
    const { media } = await seedPhoto();
    await enqueue("PROCESS_MEDIA", { mediaId: media.id });
    await enqueue("SEND_PUSH", {});

    await runJobs({ limit: 5, types: ["PROCESS_MEDIA"] });

    const push = await raw.job.findFirstOrThrow({ where: { type: "SEND_PUSH" } });
    expect(push.status).toBe("QUEUED");
    expect(push.attempts).toBe(0);
  });

  it("reclaims a stuck job before claiming new work", async () => {
    const { media } = await seedPhoto();
    const job = await enqueue("PROCESS_MEDIA", { mediaId: media.id });
    await claimJobs(1);
    await raw.job.update({
      where: { id: job.id },
      data: { lockedAt: new Date(Date.now() - 10 * 60_000) },
    });

    const summary = await runJobs({ limit: 5 });

    expect(summary.reclaimed).toBe(1);
    expect(summary.succeeded).toBe(1);
  });
});
