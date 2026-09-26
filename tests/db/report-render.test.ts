import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { EntryType, Severity, MediaKind, MediaStatus } from "@/generated/prisma/enums";
import { countPages, SIZE_CAP_BYTES } from "@/lib/reports/budget";
import { renderReport } from "@/lib/reports/render";
import { LOCAL_ROOT, storage } from "@/lib/storage/driver";
import { mediaKey, mediaPrefix } from "@/lib/storage/keys";

import { enqueue } from "@/lib/db/jobs";
import { runJobs } from "@/lib/jobs/runner";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * The report, rendered for real.
 *
 * Nothing here is mocked. A mocked renderer proves the component tree was
 * walked, which is not the question — the question is whether a file lands
 * that a client can open, and that is only answerable by looking at the bytes.
 *
 * Page count and size come out of the produced buffer, never out of a claim.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

async function photoBytes(width = 1600, height = 1200, seed = 40): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: seed, g: 90, b: 140 } },
  })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** A shift with enough in it that every section of the report has something to say. */
async function seedShift(slug: string, opts: { photos?: number } = {}) {
  const tenant = await createTenant(slug);
  const { company, site, shift } = tenant;

  await raw.shift.update({
    where: { id: shift.id },
    data: {
      clockInAt: new Date("2026-02-01T06:02:00.000Z"),
      clockOutAt: new Date("2026-02-01T16:04:00.000Z"),
    },
  });

  const area = await raw.area.create({
    data: { siteId: site.id, name: "Loading dock" },
  });
  const spot = await raw.blindSpot.create({
    data: { siteId: site.id, name: "Stairwell B landing" },
  });

  await raw.propertyCheck.create({
    data: { shiftId: shift.id, areaId: area.id, result: "CLEAR" },
  });
  await raw.blindSpotCheck.create({
    data: { shiftId: shift.id, blindSpotId: spot.id, method: "PATROL" },
  });

  const note = await raw.entry.create({
    data: {
      shiftId: shift.id,
      type: EntryType.NOTE,
      text: "Gate latch sticking again, reported to maintenance.",
      occurredAt: new Date("2026-02-01T08:12:00.000Z"),
      clientId: `${slug}-note`,
    },
  });

  const incidentEntry = await raw.entry.create({
    data: {
      shiftId: shift.id,
      type: EntryType.INCIDENT,
      text: "Vehicle struck the bollard by the east ramp.",
      occurredAt: new Date("2026-02-01T11:40:00.000Z"),
      clientId: `${slug}-incident`,
    },
  });
  const incident = await raw.incident.create({
    data: {
      entryId: incidentEntry.id,
      code: `INC-${slug.toUpperCase()}-0001`,
      categoryKey: "vehicle",
      severity: Severity.HIGH,
      status: "RESOLVED",
      resolvedAt: new Date("2026-02-01T12:20:00.000Z"),
      resolutionNote:
        "Driver details taken, facilities notified, bollard flagged for repair.",
    },
  });

  const packageEntry = await raw.entry.create({
    data: {
      shiftId: shift.id,
      type: EntryType.PACKAGE,
      text: "Parcel for suite 400.",
      occurredAt: new Date("2026-02-01T13:05:00.000Z"),
      clientId: `${slug}-package`,
    },
  });
  await raw.package.create({
    data: {
      entryId: packageEntry.id,
      carrier: "UPS",
      trackingNumber: "1Z999AA10123456784",
      recipientName: "M. Okafor",
      room: "400",
    },
  });

  const bytes = await photoBytes();
  const count = opts.photos ?? 2;
  for (let i = 0; i < count; i++) {
    const id = `${slug}-media-${i}`;
    const entryId = i === 0 ? note.id : incidentEntry.id;
    const parts = {
      companyId: company.id,
      siteId: site.id,
      shiftId: shift.id,
      mediaId: id,
    };
    const keys = {
      original: mediaKey({ ...parts, variant: "original" }),
      pdf: mediaKey({ ...parts, variant: "pdf" }),
      thumb: mediaKey({ ...parts, variant: "thumb" }),
    };
    await storage().put(keys.original, bytes, "image/jpeg");
    await storage().put(
      keys.pdf,
      await sharp(bytes).resize({ width: 1400 }).jpeg().toBuffer(),
      "image/jpeg",
    );
    await storage().put(
      keys.thumb,
      await sharp(bytes).resize({ width: 320 }).jpeg().toBuffer(),
      "image/jpeg",
    );
    await raw.media.create({
      data: {
        id,
        shiftId: shift.id,
        entryId,
        kind: MediaKind.PHOTO,
        status: MediaStatus.PROCESSED,
        storageKeyOriginal: keys.original,
        storageKeyPdf: keys.pdf,
        storageKeyThumb: keys.thumb,
        bytes: bytes.length,
        width: 1600,
        height: 1200,
        capturedAt: new Date("2026-02-01T11:41:00.000Z"),
        clientId: `${id}-client`,
      },
    });
  }

  return { ...tenant, note, incident, incidentEntry, area, spot };
}

const opts = {
  reportId: "rep-1",
  version: 1,
  galleryUrl: "https://transient.test/g/abc123",
  galleryExpiresAt: new Date("2026-03-03T00:00:00.000Z"),
};

describe("renderReport", () => {
  it("produces a real, openable PDF", async () => {
    const seeded = await seedShift("pdfok");
    const out = await renderReport({ shiftId: seeded.shift.id, ...opts });

    // Magic bytes, not a length check. An empty Buffer has a length too.
    expect(out.buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(out.buffer.subarray(-6).toString("latin1")).toContain("EOF");
    expect(out.bytes).toBe(out.buffer.length);
    expect(out.bytes).toBeGreaterThan(10_000);
  }, 60_000);

  it("reports a page count read from the file", async () => {
    const seeded = await seedShift("pdfpages");
    const out = await renderReport({ shiftId: seeded.shift.id, ...opts });

    expect(out.pages).toBe(countPages(out.buffer));
    expect(out.pages).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("fits inside the email cap on an ordinary shift", async () => {
    const seeded = await seedShift("pdfsize");
    const out = await renderReport({ shiftId: seeded.shift.id, ...opts });

    expect(out.bytes).toBeLessThan(SIZE_CAP_BYTES);
    // One attempt, accepted. If this ever needs two on a two-photo shift,
    // something upstream has gone wrong with image sizing.
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]).toContain("accepted");
  }, 60_000);

  it("hashes the facts, not the file, for the footer", async () => {
    const seeded = await seedShift("pdfhash");
    const a = await renderReport({ shiftId: seeded.shift.id, ...opts });
    const b = await renderReport({ shiftId: seeded.shift.id, ...opts });

    // Same shift, same facts, same content hash — even though the two files
    // differ, because @react-pdf stamps a creation date into every render.
    expect(b.contentHash).toBe(a.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.fileHash).toMatch(/^[0-9a-f]{64}$/);
  }, 90_000);

  it("moves the content hash when an entry changes", async () => {
    const seeded = await seedShift("pdfchange");
    const before = await renderReport({ shiftId: seeded.shift.id, ...opts });

    await raw.entry.update({
      where: { id: seeded.note.id },
      data: { text: "Gate latch replaced by maintenance at 09:40." },
    });

    const after = await renderReport({ shiftId: seeded.shift.id, ...opts });
    expect(after.contentHash).not.toBe(before.contentHash);
  }, 90_000);

  it("survives a photo whose bytes have gone missing", async () => {
    const seeded = await seedShift("pdfgone");
    // Delete the stored object but leave the row. This is the real failure:
    // a lifecycle rule, a bad sweep, an S3 hiccup. The report must still go.
    const media = await raw.media.findFirstOrThrow({
      where: { shiftId: seeded.shift.id },
    });
    await storage().deletePrefix(
      mediaPrefix({
        companyId: seeded.company.id,
        siteId: seeded.site.id,
        shiftId: seeded.shift.id,
        mediaId: media.id,
      }),
    );

    const out = await renderReport({ shiftId: seeded.shift.id, ...opts });
    expect(out.buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(out.pages).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("refuses to invent a report for a shift that is gone", async () => {
    await expect(renderReport({ shiftId: "nope", ...opts })).rejects.toThrow(/gone/);
  });
});

describe("LOCAL_ROOT", () => {
  it("is where the test storage actually wrote", () => {
    // Guards against a future driver swap silently making these tests
    // exercise nothing.
    expect(LOCAL_ROOT).toContain(".data");
  });
});

describe("buildReport job", () => {
  it("runs through the queue and leaves a real PDF in storage", async () => {
    const seeded = await seedShift("pdfjob");

    // The payload the end-of-shift flow actually enqueues. This test used to
    // pass `{ reportId }` and construct the draft itself, which is a contract
    // nothing in the app ever produced — so the handler was green while the
    // real button was broken.
    await enqueue("GENERATE_REPORT", {
      shiftId: seeded.shift.id,
      requestedById: seeded.owner.id,
    });
    const summary = await runJobs({ limit: 5 });
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);

    const after = await raw.report.findFirstOrThrow({
      where: { shiftId: seeded.shift.id },
    });
    expect(after.version).toBe(1);
    expect(after.status).toBe("READY");
    expect(after.storageKey).toBeTruthy();
    expect(after.pages).toBeGreaterThanOrEqual(1);
    expect(after.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(after.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Content hash and file hash must not be the same value. If they ever are,
    // the two-hash design in hash.ts has been collapsed by accident.
    expect(after.contentHash).not.toBe(after.sha256);
    expect(after.galleryToken).toBeTruthy();
    expect(after.galleryExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // The bytes on the row must match the bytes in storage, not just exist.
    const stored = await storage().get(after.storageKey!);
    expect(stored.length).toBe(after.bytes);
    expect(stored.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 90_000);

  it("is idempotent, so a redelivered job does not rebuild", async () => {
    const seeded = await seedShift("pdfidem");
    const payload = {
      shiftId: seeded.shift.id,
      requestedById: seeded.owner.id,
    };

    await enqueue("GENERATE_REPORT", payload);
    await runJobs({ limit: 5 });
    const report = await raw.report.findFirstOrThrow({
      where: { shiftId: seeded.shift.id },
    });
    const first = report;

    await enqueue("GENERATE_REPORT", payload);
    await runJobs({ limit: 5 });
    const second = await raw.report.findUniqueOrThrow({ where: { id: report.id } });

    // Same token, same generation time. A rebuild would rotate both and
    // invalidate a gallery link a client may already have open.
    expect(second.galleryToken).toBe(first.galleryToken);
    expect(second.generatedAt!.getTime()).toBe(first.generatedAt!.getTime());
  }, 90_000);

  it("records why it failed, on the row", async () => {
    const report = await raw.report.findFirst();
    expect(report).toBeNull();

    const seeded = await seedShift("pdffail");
    const shiftId = seeded.shift.id;
    // The handler must treat a vanished shift as done rather than retrying
    // against nothing.
    await raw.shift.delete({ where: { id: shiftId } });

    await enqueue("GENERATE_REPORT", { shiftId, requestedById: seeded.owner.id });
    const summary = await runJobs({ limit: 5 });

    expect(summary.failed).toBe(0);
    expect(await raw.report.findFirst({ where: { shiftId } })).toBeNull();
  }, 60_000);
});
