import { NextResponse } from "next/server";
import { z } from "zod";

import { createEntry, createIncident, createPackage } from "@/lib/actions/entries";
import { currentActor } from "@/lib/auth/guards";

/**
 * The replay endpoint the offline outbox posts to (section 14).
 *
 * Timeline writes are Server Actions, and a Server Action cannot be replayed
 * from a queue: it is a POST to the page carrying an opaque action id that
 * changes on every deploy. A note written in a basement on Tuesday and flushed
 * on Wednesday would hit an id that no longer resolves. So the offline path
 * needs a stable URL, and this is it.
 *
 * It deliberately does not reimplement anything. The three actions stay the
 * single definition of what a valid write is — scoping, validation,
 * idempotency and revalidation all still happen inside them. This is a
 * transport, and the body is `{ action, input }` rather than a REST shape for
 * exactly that reason: the outbox stores one URL and the dispatch table is the
 * only thing that has to stay in sync.
 */

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createEntry"), input: z.unknown() }),
  z.object({ action: z.literal("createIncident"), input: z.unknown() }),
  z.object({ action: z.literal("createPackage"), input: z.unknown() }),
]);

export type ReplayAction = z.infer<typeof bodySchema>["action"];

/**
 * Only creates. An update or a delete replayed out of order can undo a later
 * edit that already landed, and the timeline's edit path is online-only for
 * that reason — a guard editing a note is looking at the note, which means
 * they loaded it, which means they had signal.
 */
const handlers: Record<
  ReplayAction,
  (
    input: never,
  ) => Promise<
    { ok: true; data: unknown } | { ok: false; code: string; message: string }
  >
> = {
  createEntry,
  createIncident,
  createPackage,
};

export async function POST(request: Request) {
  const actor = await currentActor();
  // 401 rather than a redirect: the caller is a background flush, not a
  // navigation, and `isPermanent` drops a 401 so the record does not sit in
  // the queue retrying against a session that has already expired.
  if (!actor) {
    return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "UNKNOWN_ACTION" }, { status: 400 });
  }

  const handler = handlers[parsed.data.action] as (
    input: unknown,
  ) => Promise<
    { ok: true; data: unknown } | { ok: false; code: string; message: string }
  >;
  const result = await handler(parsed.data.input);

  if (!result.ok) {
    // A rejected write is wrong, not unlucky, so it answers 4xx and the
    // outbox drops it instead of retrying a malformed record forever behind
    // every good write queued after it.
    const status = result.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json(result, { status });
  }

  // Note there is no 409 case. Every one of these actions is idempotent on the
  // caller's `clientId` — `createEntry` upserts, and `Incident.clientId` /
  // `Package.clientId` are unique — so a write that landed before the phone
  // lost the response replays to the same row and answers 200 with the same
  // ids. That is a better ending than a conflict the client has to interpret.
  return NextResponse.json(result, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
