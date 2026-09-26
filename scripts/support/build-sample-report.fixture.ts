/**
 * Seeds one realistic shift, builds its report through the real job queue, and
 * writes the resulting PDF to a directory so `check-report.mjs` can read it
 * back with an unrelated toolchain.
 *
 * Lives under `scripts/` rather than `tests/` because it is a fixture for a
 * gate, not an assertion. It prints one line of JSON on stdout; anything else
 * it says is noise the gate ignores.
 *
 * It runs against the *test* database and refuses to run anywhere else — this
 * writes rows and truncates tables, and pointing it at dev data would be a
 * quiet way to lose a day's work.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { LoggingMode, Role, EntryType, Severity } from "@/generated/prisma/enums";
import { enqueue } from "@/lib/db/jobs";
import { createReportDraft } from "@/lib/db/reports";
import { runJobs } from "@/lib/jobs/runner";
import { storage } from "@/lib/storage/driver";
import { mediaKey } from "@/lib/storage/keys";

const url = process.env["DATABASE_URL"];
if (!url || !/transient_test/.test(url)) {
  throw new Error("build-sample-report: refusing to run outside transient_test");
}

const outDir = (() => {
  const dir = process.env["REPORT_OUT_DIR"];
  if (!dir) throw new Error("build-sample-report: REPORT_OUT_DIR is not set");
  return dir;
})();

const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const SITE_NAME = "Westside Hotel";
const GUARD_NAME = "A. Nwosu";
const INCIDENT_CODE = "WH-0201-01";

async function main() {
  const tables = await raw.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  await raw.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
  );

  const company = await raw.company.create({
    data: { name: "Meridian Protective", slug: "meridian" },
  });
  const site = await raw.site.create({
    data: {
      companyId: company.id,
      name: SITE_NAME,
      code: "WH",
      address: "410 Ocean Avenue",
      // UTC on purpose: the gate asserts the shift's 06:00 start renders as
      // 06:00. On a local-timezone site that assertion could pass or fail
      // depending on which machine ran it, which proves nothing.
      timezone: "UTC",
      loggingMode: LoggingMode.FULL,
    },
  });
  const owner = await raw.user.create({
    data: {
      companyId: company.id,
      email: "ops@meridian.test",
      name: "R. Calder",
      role: Role.OWNER,
    },
  });
  const guard = await raw.user.create({
    data: {
      companyId: company.id,
      email: "guard@meridian.test",
      name: GUARD_NAME,
      role: Role.GUARD,
      assignments: { create: { siteId: site.id } },
    },
  });

  const shift = await raw.shift.create({
    data: {
      siteId: site.id,
      guardId: guard.id,
      clientId: "sample-shift",
      scheduledStart: new Date("2026-02-01T06:00:00.000Z"),
      scheduledEnd: new Date("2026-02-01T16:00:00.000Z"),
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
    data: {
      shiftId: shift.id,
      blindSpotId: spot.id,
      method: "PATROL",
      // Explicit, not defaulted to now(): a gate that renders "checked at
      // 02:35" because the clock happened to say so proves nothing about
      // whether the report shows the time the guard actually walked it.
      at: new Date("2026-02-01T09:35:00.000Z"),
    },
  });

  await raw.entry.create({
    data: {
      shiftId: shift.id,
      type: EntryType.NOTE,
      text: "Gate latch sticking again, reported to maintenance.",
      occurredAt: new Date("2026-02-01T08:12:00.000Z"),
      clientId: "sample-note",
    },
  });

  const incidentEntry = await raw.entry.create({
    data: {
      shiftId: shift.id,
      type: EntryType.INCIDENT,
      text: "A delivery van reversed into the bollard at the east ramp.",
      occurredAt: new Date("2026-02-01T11:40:00.000Z"),
      clientId: "sample-incident",
    },
  });
  await raw.incident.create({
    data: {
      entryId: incidentEntry.id,
      code: INCIDENT_CODE,
      categoryKey: "vehicle",
      severity: Severity.HIGH,
      status: "RESOLVED",
      resolvedAt: new Date("2026-02-01T12:20:00.000Z"),
      resolutionNote: "Driver details taken, facilities notified.",
    },
  });

  const packageEntry = await raw.entry.create({
    data: {
      shiftId: shift.id,
      type: EntryType.PACKAGE,
      text: "Parcel for suite 400.",
      occurredAt: new Date("2026-02-01T13:05:00.000Z"),
      clientId: "sample-package",
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

  const bytes = await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 38, g: 92, b: 150 },
    },
  })
    .jpeg({ quality: 88 })
    .toBuffer();

  for (const [i, entryId] of [incidentEntry.id, incidentEntry.id].entries()) {
    const mediaId = `sample-media-${i}`;
    const parts = {
      companyId: company.id,
      siteId: site.id,
      shiftId: shift.id,
      mediaId,
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
        id: mediaId,
        shiftId: shift.id,
        entryId,
        kind: "PHOTO",
        status: "PROCESSED",
        storageKeyOriginal: keys.original,
        storageKeyPdf: keys.pdf,
        storageKeyThumb: keys.thumb,
        bytes: bytes.length,
        width: 1600,
        height: 1200,
        capturedAt: new Date("2026-02-01T11:41:00.000Z"),
        clientId: `${mediaId}-client`,
      },
    });
  }

  const draft = await createReportDraft({ shiftId: shift.id, generatedById: owner.id });
  await enqueue("GENERATE_REPORT", { reportId: draft.id });
  const summary = await runJobs({ limit: 5 });
  if (summary.failed > 0)
    throw new Error(`report job failed: ${JSON.stringify(summary)}`);

  const report = await raw.report.findUniqueOrThrow({ where: { id: draft.id } });
  if (!report.storageKey) throw new Error("report has no storage key");

  const pdf = await storage().get(report.storageKey);
  writeFileSync(path.join(outDir, "report.pdf"), pdf);

  writeFileSync(
    path.join(outDir, "meta.json"),
    JSON.stringify({
      reportId: report.id,
      bytes: report.bytes,
      storedBytes: pdf.length,
      pages: report.pages,
      sha256: report.sha256,
      contentHash: report.contentHash,
      siteName: SITE_NAME,
      guardName: GUARD_NAME,
      incidentCode: INCIDENT_CODE,
    }),
  );
}

it("builds a sample report for the milestone 6 gate", async () => {
  try {
    await main();
  } finally {
    await raw.$disconnect();
  }
  expect(true).toBe(true);
}, 120_000);
