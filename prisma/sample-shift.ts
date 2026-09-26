/**
 * The sample shift.
 *
 * `pnpm db:seed` has to leave behind something worth looking at: a finished
 * night with photos, an incident and a report that was actually generated,
 * plus one delivery that bounced. Otherwise the first thing a new developer
 * sees is an empty dashboard, and the first thing they have to do to see the
 * product is work a shift by hand.
 *
 * Two rules shape this file:
 *
 *   1. Nothing is fabricated. The photos are real image bytes written through
 *      the real storage driver, and the report is built by the real
 *      `build-report` job. A `Report` row carrying an invented `pages` and
 *      `bytes` would make the dashboard look right while proving nothing, and
 *      would hide a broken PDF pipeline behind a seeded number.
 *   2. Everything is idempotent. Every row keys off a fixed `seed-` client id,
 *      so running the seed twice leaves one shift, not two.
 */
import { Buffer } from "node:buffer";

import sharp from "sharp";

import {
  EntryType,
  JobStatus,
  JobType,
  MediaStatus,
  ShiftStatus,
  Severity,
} from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { mediaKey } from "@/lib/storage/keys";
import { storage } from "@/lib/storage/driver";

/** Yesterday's night shift, so the dashboard has a finished day behind it. */
function nightOf(daysAgo: number, hour: number, minute = 0) {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - daysAgo);
  at.setUTCHours(hour, minute, 0, 0);
  return at;
}

/**
 * A real JPEG, generated rather than committed.
 *
 * Checking binary fixtures into a repo to make a seed look good is how a
 * repository grows a megabyte a month. `sharp` is already a dependency of the
 * media pipeline, so the bytes here go through the same encoder the app uses.
 */
async function photoBytes(label: string, hue: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960">
    <rect width="1280" height="960" fill="hsl(${hue},18%,22%)"/>
    <rect x="0" y="820" width="1280" height="140" fill="hsl(${hue},18%,14%)"/>
    <text x="48" y="900" font-family="monospace" font-size="44" fill="#e8e6e1">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

type Ctx = {
  prisma: PrismaClient;
  siteId: string;
  companyId: string;
  guardId: string;
  supervisorId: string;
};

export async function seedSampleShift(ctx: Ctx): Promise<string | null> {
  const { prisma, siteId, guardId } = ctx;

  const clockIn = nightOf(1, 22);
  const clockOut = nightOf(0, 6);

  const shift = await prisma.shift.upsert({
    where: { clientId: "seed-sample-night" },
    update: {},
    create: {
      siteId,
      guardId,
      clientId: "seed-sample-night",
      scheduledStart: clockIn,
      scheduledEnd: clockOut,
      clockInAt: clockIn,
      clockOutAt: clockOut,
      status: ShiftStatus.ENDED,
    },
  });

  // Re-running the seed must not re-play the night.
  const already = await prisma.entry.count({ where: { shiftId: shift.id } });
  if (already === 0) {
    await writeTimeline(ctx, shift.id, clockIn);
  }

  // A shift scheduled for tonight, so a guard signing in to a fresh install
  // has something to clock into without creating one first.
  await prisma.shift.upsert({
    where: { clientId: "seed-tonight" },
    update: {},
    create: {
      siteId,
      guardId,
      clientId: "seed-tonight",
      scheduledStart: nightOf(0, 22),
      scheduledEnd: nightOf(-1, 6),
      status: ShiftStatus.SCHEDULED,
    },
  });

  return shift.id;
}

async function writeTimeline(ctx: Ctx, shiftId: string, clockIn: Date) {
  const { prisma, companyId, siteId } = ctx;
  const at = (minutes: number) => new Date(clockIn.getTime() + minutes * 60_000);

  const area = await prisma.area.findFirst({
    where: { siteId },
    select: { id: true, name: true },
  });

  const notes: Array<[number, string]> = [
    [2, "On site. Relieved day shift at the lobby desk, keys and radio handed over."],
    [46, "Perimeter walk complete. Pool gate secure, no issues."],
    [131, "Loading dock roll-up was unlatched. Secured it and noted for maintenance."],
    [284, "Quiet through the early hours. Nothing to report on the third floor."],
    [472, "Day shift arrived. Handed over radio, keys and the dock note."],
  ];

  for (const [minute, text] of notes) {
    await prisma.entry.create({
      data: {
        shiftId,
        type: EntryType.NOTE,
        text,
        occurredAt: at(minute),
        clientId: `seed-note-${minute}`,
        ...(area ? { areaId: area.id } : {}),
      },
    });
  }

  // ---- Two photographed entries -------------------------------------------
  const photos: Array<[number, string, string, number]> = [
    [48, "Pool gate secured", "pool-gate", 190],
    [133, "Loading dock, before securing", "loading-dock", 28],
  ];

  for (const [minute, caption, slug, hue] of photos) {
    const entry = await prisma.entry.create({
      data: {
        shiftId,
        type: EntryType.MEDIA,
        text: caption,
        occurredAt: at(minute),
        clientId: `seed-photo-${slug}`,
        ...(area ? { areaId: area.id } : {}),
      },
    });

    const bytes = await photoBytes(caption, hue);
    const key = mediaKey({
      companyId,
      siteId,
      shiftId,
      mediaId: `seed-${slug}`,
      variant: "original",
      ext: "jpg",
    });
    await storage().put(key, bytes, "image/jpeg");

    const media = await prisma.media.create({
      data: {
        shiftId,
        entryId: entry.id,
        clientId: `seed-media-${slug}`,
        storageKeyOriginal: key,
        bytes: bytes.length,
        width: 1280,
        height: 960,
        capturedAt: at(minute),
        // UPLOADED, not PROCESSED. The variants genuinely do not exist yet;
        // claiming PROCESSED would make the PDF look for a thumb that was
        // never encoded. The media job below is what promotes it.
        status: MediaStatus.UPLOADED,
      },
    });

    // Encode the variants through the real job, so the seeded photos are
    // exactly what an uploaded photo becomes. A report that embedded the
    // original 1280px JPEG would also be a report whose size budget was
    // never exercised.
    await prisma.job.create({
      data: { type: JobType.PROCESS_MEDIA, payload: { mediaId: media.id } },
    });
  }

  // ---- One incident --------------------------------------------------------
  const incidentEntry = await prisma.entry.create({
    data: {
      shiftId,
      type: EntryType.INCIDENT,
      text:
        "Unsecured loading dock roll-up door found partially open at 00:11. " +
        "No sign of entry, nothing disturbed inside. Door secured and " +
        "maintenance notified by note at the desk.",
      occurredAt: at(131),
      clientId: "seed-incident-dock",
      ...(area ? { areaId: area.id } : {}),
    },
  });

  await prisma.incident.create({
    data: {
      entryId: incidentEntry.id,
      code: "INC-0001",
      categoryKey: "access",
      // MEDIUM on purpose. A HIGH here would fire the push alert path on
      // every seed run, which is noise rather than a demonstration.
      severity: Severity.MEDIUM,
    },
  });
}

/**
 * Queue the report build. Do not run it here.
 *
 * The PDF builder resolves only inside Next: `@react-pdf/textkit` reaches for
 * `@react-pdf/hyphenate/en-us`, whose `exports` map declares no `require`
 * condition, so importing the job runner from `tsx` fails outright. That is
 * also why `pnpm jobs:sweep` now drives the sweep route over HTTP instead of
 * importing the handlers.
 *
 * Queueing rather than building is closer to the truth anyway: in production
 * nothing builds a report inline either. A cron hits the sweep route and the
 * job runs there, which is exactly what `pnpm jobs:sweep` reproduces.
 *
 * Nothing about the delivery is written here. The send path, the console
 * provider and the webhook confirmation all run for real once the queue is
 * drained, and a hand-written `ReportDelivery` row would be a fake of the one
 * thing this product exists to prove.
 */
export async function queueSampleReport(
  ctx: Ctx,
  shiftId: string,
): Promise<"queued" | "send-queued" | "already-built"> {
  const { prisma, supervisorId } = ctx;

  const existing = await prisma.report.findFirst({
    where: { shiftId },
    select: { id: true, status: true, storageKey: true },
  });

  if (existing) {
    // The sample night finished yesterday, so its report should have been
    // sent. Sending is a deliberate human action in the product — the
    // end-of-shift screen has the button, and `build-report` must never send
    // on its own — so the seed presses it on the guard's behalf, once, and
    // only for a report that actually finished building.
    const sent = await prisma.reportDelivery.count({
      where: { reportId: existing.id },
    });
    if (sent === 0 && existing.storageKey) {
      const queuedSend = await prisma.job.findFirst({
        where: { type: JobType.SEND_REPORT, status: JobStatus.QUEUED },
        select: { id: true },
      });
      if (!queuedSend) {
        await prisma.job.create({
          data: { type: JobType.SEND_REPORT, payload: { reportId: existing.id } },
        });
        return "send-queued";
      }
    }
    return "already-built";
  }

  const queued = await prisma.job.findFirst({
    where: { type: JobType.GENERATE_REPORT, status: JobStatus.QUEUED },
    select: { id: true },
  });
  if (queued) return "queued";

  await prisma.job.create({
    data: {
      type: JobType.GENERATE_REPORT,
      payload: { shiftId, requestedById: supervisorId },
    },
  });
  return "queued";
}
