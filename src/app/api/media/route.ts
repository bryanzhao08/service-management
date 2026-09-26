import { NextResponse } from "next/server";
import { z } from "zod";

import { currentActor } from "@/lib/auth/guards";
import { db, NotVisibleError } from "@/lib/db/scoped";
import { storage } from "@/lib/storage/driver";
import { enqueueAndKick } from "@/lib/jobs/enqueue";
import { companyIdFromKey, mediaKey } from "@/lib/storage/keys";

import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from "../uploads/presign/route";

/**
 * `POST /api/media` (section 10.4).
 *
 * Called after the browser's PUT to the presigned URL succeeds. It records the
 * row that makes the object findable; until this runs, the bytes exist in
 * storage and nothing references them (the sweep in section 21 is what
 * reclaims that case).
 *
 * The client supplies the key, so the key is re-derived here from the server's
 * own view of the shift and the two are compared. A caller who edited the key
 * between presign and record would otherwise get a database row pointing at
 * some other company's object, and every later signed GET would honour it.
 * `companyIdFromKey` is a second, cheaper check of the same property.
 *
 * Recording the row enqueues `PROCESS_MEDIA` and nudges the worker, so the
 * thumbnail is usually ready by the time the grid re-renders. The nudge is an
 * optimisation; the sweep is what guarantees delivery.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  shiftId: z.string().min(1),
  entryId: z.string().min(1).nullish(),
  mediaId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  key: z.string().min(1).max(512),
  kind: z.enum(["PHOTO", "VIDEO"]),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  capturedAt: z.coerce.date(),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in to upload.", 401);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("INVALID_BODY", "Expected a JSON body.", 400);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail("INVALID_BODY", "Missing or malformed media record.", 400);
  }
  const body = parsed.data;

  if (companyIdFromKey(body.key) !== actor.companyId) {
    return fail("NOT_FOUND", "Media not found.", 404);
  }

  const maxBytes = body.kind === "VIDEO" ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (body.bytes > maxBytes) {
    return fail("TOO_LARGE", "That file is over the size limit.", 413);
  }

  const shift = await db(actor).shift.findByIdWithSite(body.shiftId);
  if (!shift) return fail("NOT_FOUND", "Shift not found.", 404);

  const expectedKey = mediaKey({
    companyId: actor.companyId,
    siteId: shift.siteId,
    shiftId: shift.id,
    mediaId: body.mediaId,
    variant: "original",
    ext: body.kind === "VIDEO" ? "bin" : "jpg",
  });
  if (expectedKey !== body.key) {
    return fail("NOT_FOUND", "Media not found.", 404);
  }

  // The object has to actually be there. Without this a client could record
  // rows for uploads that never happened, and every report built from them
  // would fail at render time instead of here.
  const size = await storage().size(body.key);
  if (size === null) {
    return fail("NOT_UPLOADED", "Upload the file before recording it.", 409);
  }

  try {
    const media = await db(actor).media.record({
      shiftId: shift.id,
      entryId: body.entryId ?? null,
      clientId: body.mediaId,
      kind: body.kind,
      storageKeyOriginal: body.key,
      bytes: size,
      width: body.width ?? null,
      height: body.height ?? null,
      capturedAt: body.capturedAt,
    });

    // After the row exists, never before: a job naming a media id that has
    // not committed yet would run, find nothing and burn an attempt.
    if (media.status === "PENDING") {
      await enqueueAndKick("PROCESS_MEDIA", { mediaId: media.id });
    }

    return NextResponse.json({
      id: media.id,
      status: media.status,
      url: `/api/media/${media.id}`,
    });
  } catch (error) {
    if (error instanceof NotVisibleError) {
      return fail("NOT_FOUND", "Shift not found.", 404);
    }
    throw error;
  }
}
