import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth/guards";
import { deliveryInCompany } from "@/lib/db/deliveries";
import { isConsoleEmail } from "@/lib/email/provider";
import { handleResendEvent } from "@/lib/email/webhook";

/**
 * `POST /api/dev/deliveries/simulate` — drive the delivery lifecycle without a
 * Resend account.
 *
 * This exists because "the client got it" is the claim the whole product rests
 * on, and until now the only way to watch that path run was to own a verified
 * sending domain. A demo that stops at SENT shows the half of the story that
 * was never in doubt.
 *
 * Three gates, all of which must hold: a signed-in actor, the delivery being
 * inside that actor's own company, and the console provider actually being in
 * use. The last is the load-bearing one -- it makes this route inert the moment
 * a real `RESEND_API_KEY` is configured, so a production deploy cannot forge a
 * delivery confirmation even though the route ships with it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTS = new Set([
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
]);

export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in first." } },
      { status: 401 },
    );
  }

  if (!isConsoleEmail()) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_AVAILABLE",
          message: "Simulation is only available while email is in console mode.",
        },
      },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    deliveryId?: string;
    type?: string;
    reason?: string;
  };

  const type = body.type ?? "email.delivered";
  if (!EVENTS.has(type)) {
    return NextResponse.json(
      { error: { code: "BAD_EVENT", message: `Unknown event ${type}.` } },
      { status: 400 },
    );
  }

  if (!body.deliveryId) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "deliveryId is required." } },
      { status: 400 },
    );
  }

  // Scoped by company, not just by id. Taking a raw message id from the body
  // would let any signed-in user anywhere mark another company's report
  // delivered, which is exactly the forgery the signature check prevents on
  // the real webhook.
  const delivery = await deliveryInCompany(body.deliveryId, actor.companyId);

  if (!delivery) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No such delivery." } },
      { status: 404 },
    );
  }

  if (!delivery.providerMessageId) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_SENT",
          message: "That delivery has not been sent yet, so it has no message id.",
        },
      },
      { status: 409 },
    );
  }

  const outcome = await handleResendEvent({
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: delivery.providerMessageId,
      ...(body.reason ? { reason: body.reason } : {}),
    },
  });

  return NextResponse.json(outcome, { headers: { "cache-control": "no-store" } });
}
