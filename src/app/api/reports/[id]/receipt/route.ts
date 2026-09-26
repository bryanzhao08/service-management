import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth/guards";
import { receiptData } from "@/lib/db/receipt";
import { db } from "@/lib/db/scoped";
import { renderReceipt } from "@/lib/reports/receipt-document";

/**
 * `GET /api/reports/[id]/receipt` — the one-page delivery receipt as a PDF.
 *
 * Rendered on demand rather than stored. The receipt is a view of live
 * delivery state, so caching it would mean handing someone a file that says
 * "delivered" about an address that bounced twenty minutes later. It is one
 * page of text, so rendering it per request costs nothing worth saving.
 *
 * Unlike the report PDF this streams the bytes instead of redirecting to a
 * signed URL, because there is no stored object to sign.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in to view receipts." } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  // The scoped read is the tenancy gate. `receiptData` below is unscoped so
  // the public link can share it, which makes this check load-bearing.
  const scoped = await db(actor).report.findById(id);
  if (!scoped) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such report." } },
      { status: 404 },
    );
  }

  const data = await receiptData(id);
  if (!data) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such report." } },
      { status: 404 },
    );
  }

  const pdf = await renderReceipt(data);
  const filename = `receipt-${data.siteName.replace(/[^A-Za-z0-9]+/g, "-")}-v${
    data.version
  }.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.byteLength),
      "content-disposition": `inline; filename="${filename}"`,
      // Live delivery state. A cached copy is a stale claim about whether a
      // client received something.
      "cache-control": "no-store",
    },
  });
}
