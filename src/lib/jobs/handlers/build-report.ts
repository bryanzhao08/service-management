import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  markReportFailed,
  markReportGenerating,
  markReportReady,
  reportForBuild,
} from "@/lib/db/reports";
import { renderReport } from "@/lib/reports/render";
import { storage } from "@/lib/storage/driver";
import { reportKey } from "@/lib/storage/keys";

/**
 * `BUILD_REPORT` (section 11).
 *
 * Rendering happens here rather than in the request that ends the shift for one
 * reason that matters more than speed: a guard finishing at 06:00 in a car park
 * on one bar of signal must not be the thing holding a 40-photo render open. The
 * clock-out is already recorded by the time this runs. If the render fails, the
 * shift is still closed and the report retries — the opposite arrangement loses
 * the clock-out to a PDF bug.
 */

export const buildReportPayload = z.object({ reportId: z.string().min(1) });

export type BuildReportResult = {
  reportId: string;
  result: "built" | "gone" | "already-ready";
  bytes?: number;
  pages?: number;
};

/**
 * How long a gallery link stays alive.
 *
 * 30 days is long enough for a client to get back from leave and short enough
 * that a forwarded email does not become a permanent public window into a site.
 * The report itself never expires — only the convenience link does.
 */
export const GALLERY_TTL_DAYS = 30;

export async function buildReport(rawPayload: unknown): Promise<BuildReportResult> {
  const { reportId } = buildReportPayload.parse(rawPayload);

  const report = await reportForBuild(reportId);
  // Same reasoning as the media worker: a row that is gone is not a failure to
  // retry against. A deleted shift takes its reports with it.
  if (!report) return { reportId, result: "gone" };
  if (report.status === "READY" && report.storageKey) {
    return { reportId, result: "already-ready" };
  }

  await markReportGenerating(reportId);

  try {
    // The gallery token is minted here, not at request time, so a retry after a
    // failed render does not leave a live token pointing at a report that was
    // never produced.
    const token = report.galleryToken ?? randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + GALLERY_TTL_DAYS * 86_400_000);

    const rendered = await renderReport({
      shiftId: report.shiftId,
      reportId: report.id,
      version: report.version,
      galleryUrl: galleryUrl(token),
      galleryExpiresAt: expiresAt,
    });

    const key = reportKey({
      companyId: report.shift.site.companyId,
      siteId: report.shift.siteId,
      shiftId: report.shiftId,
      reportId: report.id,
      version: report.version,
    });
    await storage().put(key, rendered.buffer, "application/pdf");

    await markReportReady(reportId, {
      storageKey: key,
      bytes: rendered.bytes,
      pages: rendered.pages,
      sha256: rendered.fileHash,
      contentHash: rendered.contentHash,
      sizeSteps: rendered.steps,
      galleryToken: token,
      galleryExpiresAt: expiresAt,
    });

    return { reportId, result: "built", bytes: rendered.bytes, pages: rendered.pages };
  } catch (err) {
    // Recorded on the row as well as rethrown. The runner owns retry and
    // backoff; the row owns telling a supervisor why their report is not here
    // yet, which "check the logs" does not do at 06:30.
    await markReportFailed(reportId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function galleryUrl(token: string): string {
  const base = process.env["APP_URL"] ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/g/${token}`;
}
