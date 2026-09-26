import { NextResponse } from "next/server";
import { Webhook } from "svix";

import { handleResendEvent, type ResendEvent } from "@/lib/email/webhook";

/**
 * `POST /api/webhooks/resend` (section 12).
 *
 * The only unauthenticated write endpoint in the app, which is why the
 * signature check is the first thing that happens and why an unset secret
 * returns 503 rather than trusting the body. Without verification this is a
 * public endpoint for marking any report delivered, which would make the one
 * claim the product is sold on forgeable by anyone who can guess a message id.
 *
 * Answers 200 to anything it recognises as legitimate-but-unactionable (an
 * unknown message id, a replayed webhook, a row already in a terminal state).
 * A provider that receives a 4xx retries with backoff for hours against a
 * message we will never recognise, so a 4xx here is a self-inflicted outage
 * rather than a defence.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env["RESEND_WEBHOOK_SECRET"];
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: "RESEND_WEBHOOK_SECRET is not set.",
        },
      },
      { status: 503 },
    );
  }

  // Raw body, before any parsing. The signature covers the exact bytes, so
  // round-tripping through JSON.parse/stringify first would reorder keys and
  // fail verification on a perfectly good webhook.
  const raw = await request.text();

  let event: ResendEvent;
  try {
    event = new Webhook(secret).verify(raw, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }) as unknown as ResendEvent;
  } catch {
    // The one case that must be a 4xx. An unverified body is not a webhook.
    return NextResponse.json(
      { error: { code: "BAD_SIGNATURE", message: "Signature did not verify." } },
      { status: 401 },
    );
  }

  return NextResponse.json(await handleResendEvent(event), {
    headers: { "cache-control": "no-store" },
  });
}
