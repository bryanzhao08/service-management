import { NextResponse } from "next/server";
import { z } from "zod";

import { currentActor } from "@/lib/auth/guards";
import { removeSubscription, upsertSubscription } from "@/lib/db/notifications";
import { pushIsConfigured } from "@/lib/push/send";

/**
 * `POST /api/push/subscribe` and `DELETE` (section 13).
 *
 * The browser owns the subscription: it produces the endpoint and the keys
 * when the user grants permission, and it can rotate them at any time without
 * telling us. So this route only records what the browser hands over, and the
 * one thing it refuses to do is trust the `userId` — that comes from the
 * session, never from the body, or any signed-in account could register a
 * device against someone else's id and receive their notifications.
 */

export const runtime = "nodejs";

const subscribeSchema = z.object({
  // The push service's URL. Bounded because it is stored and later used as a
  // request target; unbounded strings from a client do not go in a database.
  endpoint: z.string().url().max(1024),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(1024),
});

export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Answering 503 rather than storing the row keeps the failure honest. A
  // deployment with no VAPID keys can accept a subscription all day and never
  // send anything; the settings toggle would sit there saying notifications
  // are on while nothing ever arrives.
  if (!pushIsConfigured()) {
    return NextResponse.json(
      { error: "Push is not configured on this deployment." },
      { status: 503 },
    );
  }

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed subscription." }, { status: 400 });
  }

  await upsertSubscription({
    userId: actor.userId,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // `removed: 0` is not an error. Unsubscribing something already gone is the
  // ordinary result of the browser having rotated the endpoint, and a 404 here
  // would make the settings toggle fail at exactly the moment it is correct.
  const removed = await removeSubscription({
    userId: actor.userId,
    endpoint: parsed.data.endpoint,
  });
  return NextResponse.json({ ok: true, removed });
}
