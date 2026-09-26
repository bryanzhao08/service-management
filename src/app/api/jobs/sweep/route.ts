import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { jobCounts, runJobs } from "@/lib/jobs/runner";
import { applyRetention } from "@/lib/jobs/retention";
import { confirmConsoleDeliveries } from "@/lib/jobs/confirm-console";
import { expireUnconfirmed } from "@/lib/db/deliveries";

/**
 * `GET /api/jobs/sweep` (section 16), run every minute by the Vercel cron in
 * `vercel.json`.
 *
 * This is the backstop that makes the queue durable. `after()` on the enqueuing
 * request handles the happy path; everything else — a process killed
 * mid-encode, a retry waiting out its backoff, a job written while the app was
 * being redeployed — only ever runs because this does.
 */

export const runtime = "nodejs";
// Cron hits a real instance every minute; a cached response would report a
// sweep that never happened.
export const dynamic = "force-dynamic";

/**
 * Constant-time compare that does not leak length.
 *
 * `timingSafeEqual` throws on a length mismatch, which is itself a signal, so
 * both sides are hashed to a fixed width first. A plain `===` here would leak
 * the secret a byte at a time to anyone who can measure the response.
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided.padEnd(128, "\0").slice(0, 128));
  const b = Buffer.from(expected.padEnd(128, "\0").slice(0, 128));
  return timingSafeEqual(a, b) && provided.length === expected.length;
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env["CRON_SECRET"];
  if (!expected) {
    // Fail closed. An unset secret must not mean "open to everyone" — this
    // endpoint does real work and reports queue internals.
    return NextResponse.json(
      { error: { code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." } },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const provided = bearer ?? request.headers.get("x-cron-secret");
  if (!secretMatches(provided, expected)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not found." } },
      { status: 401 },
    );
  }

  const ran = await runJobs({ limit: 10 });
  const retention = await applyRetention();
  // Console mode has no provider to send us a webhook, so the sweep plays the
  // provider's part. Without this a local demo stops at SENT and the delivery
  // half of the product is invisible on every machine that has no Resend key.
  const confirmed = await confirmConsoleDeliveries();
  // Runs *after* confirmation so a row that was about to be confirmed this
  // same tick is not first declared unconfirmed and then contradicted.
  const unconfirmed = await expireUnconfirmed();

  return NextResponse.json(
    {
      ok: true,
      ...ran,
      retention,
      deliveries: { confirmed, unconfirmed },
      queue: await jobCounts(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
