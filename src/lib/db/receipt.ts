import type { DeliveryStatus, ReportStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/client";

/**
 * Section 9.5's receipt: the guard's proof that the report left and landed.
 *
 * This is deliberately its own loader rather than a scoped query, because the
 * same shape has to render in three places with three different authorities:
 * the guard's own receipt page, a signed link a manager opens with no account,
 * and a one-page PDF. Scoping is the caller's job; assembling the facts is
 * this function's, and having one assembler is what stops the public link and
 * the private page from ever disagreeing about what happened.
 */

export type ReceiptDelivery = {
  id: string;
  email: string;
  name: string | null;
  roleLabel: string | null;
  required: boolean;
  status: DeliveryStatus;
  statusAt: Date;
  providerMessageId: string | null;
  bounceReason: string | null;
  attempts: number;
  lastError: string | null;
};

export type ReceiptData = {
  reportId: string;
  shiftId: string;
  siteName: string;
  siteTimezone: string;
  companyName: string;
  version: number;
  status: ReportStatus;
  bytes: number | null;
  pages: number | null;
  sha256: string | null;
  contentHash: string | null;
  sizeSteps: unknown;
  generatedAt: Date | null;
  sentAt: Date | null;
  generatedByName: string;
  guardName: string;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  hasGallery: boolean;
  galleryExpiresAt: Date | null;
  deliveries: ReceiptDelivery[];
  /** Every version of this shift's report, newest first, for the version list. */
  versions: {
    id: string;
    version: number;
    generatedAt: Date | null;
    sentAt: Date | null;
  }[];
};

export async function receiptData(reportId: string): Promise<ReceiptData | null> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      generatedBy: { select: { name: true, email: true } },
      shift: {
        select: {
          id: true,
          clockInAt: true,
          clockOutAt: true,
          guard: { select: { name: true, email: true } },
          site: {
            select: {
              name: true,
              timezone: true,
              company: { select: { name: true } },
            },
          },
        },
      },
      deliveries: {
        orderBy: [{ status: "asc" }, { email: "asc" }],
        include: {
          recipient: { select: { name: true, roleLabel: true, required: true } },
        },
      },
    },
  });
  if (!report) return null;

  const versions = await prisma.report.findMany({
    where: { shiftId: report.shiftId },
    select: { id: true, version: true, generatedAt: true, sentAt: true },
    orderBy: { version: "desc" },
  });

  return {
    reportId: report.id,
    shiftId: report.shiftId,
    siteName: report.shift.site.name,
    siteTimezone: report.shift.site.timezone,
    companyName: report.shift.site.company.name,
    version: report.version,
    status: report.status,
    bytes: report.bytes,
    pages: report.pages,
    sha256: report.sha256,
    contentHash: report.contentHash,
    sizeSteps: report.sizeSteps,
    generatedAt: report.generatedAt,
    sentAt: report.sentAt,
    generatedByName: report.generatedBy.name ?? report.generatedBy.email ?? "Unknown",
    guardName: report.shift.guard.name ?? report.shift.guard.email ?? "Unknown",
    shiftStart: report.shift.clockInAt,
    shiftEnd: report.shift.clockOutAt,
    // A gallery that has expired is not a gallery. Saying "link available" and
    // then handing someone a dead URL is worse than saying nothing.
    hasGallery:
      report.galleryToken !== null &&
      (report.galleryExpiresAt === null || report.galleryExpiresAt > new Date()),
    galleryExpiresAt: report.galleryExpiresAt,
    deliveries: report.deliveries.map((delivery) => ({
      id: delivery.id,
      email: delivery.email,
      name: delivery.recipient?.name ?? null,
      roleLabel: delivery.recipient?.roleLabel ?? null,
      required: delivery.recipient?.required ?? false,
      status: delivery.status,
      statusAt: delivery.statusAt,
      providerMessageId: delivery.providerMessageId,
      bounceReason: delivery.bounceReason,
      attempts: delivery.attempts,
      lastError: delivery.lastError,
    })),
    versions,
  };
}

/** The newest report for a shift, which is what `/shift/[id]/report` shows. */
export async function latestReportId(shiftId: string): Promise<string | null> {
  const report = await prisma.report.findFirst({
    where: { shiftId },
    select: { id: true },
    orderBy: { version: "desc" },
  });
  return report?.id ?? null;
}
