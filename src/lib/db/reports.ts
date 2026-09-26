import { MediaStatus, ReportStatus } from "@/generated/prisma/enums";
import { prisma } from "./client";

/**
 * Everything the PDF renderer needs, gathered in one place.
 *
 * This is deliberately **not** scoped by an actor. A report is built by the job
 * worker, which has no session and no viewer — see the note above `claimJobs`
 * in `jobs.ts` for why that is safe. Authorisation happens where a *human* asks
 * for the finished PDF (`GET /api/reports/[id]/pdf`), which goes through the
 * scoped layer like everything else.
 *
 * One query, deeply included, rather than a query per section. A shift is a
 * bounded thing — one night, one site, tens of entries — so the round trips
 * cost more than the rows do.
 */
export async function reportSource(shiftId: string) {
  return prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      site: {
        include: {
          company: true,
          reportTemplate: true,
          areas: { orderBy: { name: "asc" } },
        },
      },
      guard: true,
      template: true,
      handoffFrom: { include: { guard: true } },
      handoffTo: { include: { guard: true }, orderBy: { createdAt: "asc" } },
      propertyChecks: { orderBy: { at: "asc" }, include: { area: true, media: true } },
      blindSpotChecks: {
        orderBy: { at: "asc" },
        include: { blindSpot: true, media: true, verifiedBy: true },
      },
      entries: {
        orderBy: { occurredAt: "asc" },
        include: {
          area: true,
          incident: { include: { siteEntryType: true } },
          packageInfo: true,
          siteEntryType: true,
          media: { orderBy: { capturedAt: "asc" } },
          revisions: { orderBy: { editedAt: "asc" } },
        },
      },
    },
  });
}

export type ReportSource = NonNullable<Awaited<ReturnType<typeof reportSource>>>;

/**
 * The next version number for a shift's report.
 *
 * `max + 1`, never `count + 1`. A deleted version would make `count` collide
 * with a version that already exists, and `@@unique([shiftId, version])` would
 * then reject the write — the same class of bug the incident-code allocator
 * has, which is why that one takes an advisory lock.
 */
export async function nextReportVersion(shiftId: string): Promise<number> {
  const top = await prisma.report.findFirst({
    where: { shiftId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (top?.version ?? 0) + 1;
}

export async function createReportDraft(input: {
  shiftId: string;
  generatedById: string;
}) {
  const version = await nextReportVersion(input.shiftId);
  return prisma.report.create({
    data: {
      shiftId: input.shiftId,
      version,
      generatedById: input.generatedById,
      status: ReportStatus.DRAFT,
    },
  });
}

export async function markReportGenerating(reportId: string) {
  return prisma.report.update({
    where: { id: reportId },
    data: { status: ReportStatus.GENERATING },
  });
}

export async function markReportReady(
  reportId: string,
  input: {
    storageKey: string;
    bytes: number;
    pages: number;
    sha256: string;
    contentHash: string;
    sizeSteps: string[];
    galleryToken: string;
    galleryExpiresAt: Date;
  },
) {
  return prisma.report.update({
    where: { id: reportId },
    data: {
      status: ReportStatus.READY,
      storageKey: input.storageKey,
      bytes: input.bytes,
      pages: input.pages,
      sha256: input.sha256,
      contentHash: input.contentHash,
      sizeSteps: input.sizeSteps,
      galleryToken: input.galleryToken,
      galleryExpiresAt: input.galleryExpiresAt,
      generatedAt: new Date(),
    },
  });
}

/**
 * The reason is stored, not just logged. A supervisor at 06:30 asking where
 * their report is deserves an answer on the screen they are already looking at.
 * Swallows its own failure because it runs inside a catch: losing the original
 * error to a second database problem would be the worse outcome.
 */
export async function markReportFailed(reportId: string, reason?: string) {
  return prisma.report
    .update({
      where: { id: reportId },
      data: {
        status: ReportStatus.FAILED,
        sizeSteps: reason ? [`failed: ${reason}`] : undefined,
      },
    })
    .catch(() => null);
}

export async function reportForBuild(reportId: string) {
  return prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      shiftId: true,
      version: true,
      status: true,
      storageKey: true,
      galleryToken: true,
      shift: { select: { siteId: true, site: { select: { companyId: true } } } },
    },
  });
}

/**
 * The media rows a report may embed, keyed by the entry they hang off.
 *
 * Only `PROCESSED` photos are eligible: a `PENDING` one has no `pdf` variant
 * yet and a `FAILED` one never will. Embedding the original instead would put
 * a 3 MB photo into a document with an 8 MB cap, which is exactly what the
 * size-budget algorithm exists to avoid.
 */
export async function embeddableMedia(shiftId: string) {
  return prisma.media.findMany({
    where: { shiftId, status: MediaStatus.PROCESSED, kind: "PHOTO" },
    orderBy: { capturedAt: "asc" },
    select: {
      id: true,
      entryId: true,
      capturedAt: true,
      storageKeyOriginal: true,
      storageKeyThumb: true,
      storageKeyPdf: true,
      width: true,
      height: true,
      blindSpotChecks: { select: { id: true } },
    },
  });
}

/** Photos and videos that exist but are not embedded, for the gallery line. */
export async function galleryCounts(shiftId: string) {
  const rows = await prisma.media.groupBy({
    by: ["kind"],
    where: { shiftId, status: { not: MediaStatus.FAILED } },
    _count: { _all: true },
  });
  const photos = rows.find((r) => r.kind === "PHOTO")?._count._all ?? 0;
  const videos = rows.find((r) => r.kind === "VIDEO")?._count._all ?? 0;
  return { photos, videos };
}
