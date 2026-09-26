import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";
import { storage } from "@/lib/storage/driver";
import { companyIdFromKey } from "@/lib/storage/keys";

/**
 * `GET /api/reports/[id]/pdf` (section 16).
 *
 * The signed-in path to a report. The client-facing paths are the emailed
 * attachment and the gallery link, neither of which comes through here — this
 * is a supervisor pulling last Tuesday's report out of history.
 *
 * Same 307-to-signed-URL shape as `/api/media/[id]`, for the same reason: the
 * app server should not be a file proxy for something that may be 8 MB.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in to view reports." } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const report = await db(actor).report.findById(id);

  // A report belonging to another company is a 404, not a 403. A 403 confirms
  // the id exists, and that is itself a leak across a tenant boundary.
  if (!report) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such report." } },
      { status: 404 },
    );
  }

  if (report.status !== "READY" || !report.storageKey) {
    // 409, not 404: the report exists and is on its way. The end-of-shift
    // screen polls on exactly this, and a 404 would tell it to give up.
    return NextResponse.json(
      {
        error: {
          code: "NOT_READY",
          message:
            report.status === "FAILED"
              ? "This report failed to generate."
              : "This report is still being generated.",
        },
        status: report.status,
      },
      { status: 409 },
    );
  }

  // Belt and braces. The scoped client already filtered by company, but the
  // key is what actually gets signed, so the key is what gets checked.
  if (companyIdFromKey(report.storageKey) !== actor.companyId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such report." } },
      { status: 404 },
    );
  }

  const url = await storage().presignDownload(report.storageKey, 300);
  return NextResponse.redirect(url, 307);
}
