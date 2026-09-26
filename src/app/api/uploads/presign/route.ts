import { NextResponse } from "next/server";
import { z } from "zod";

import { currentActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";
import { storage } from "@/lib/storage/driver";
import { mediaKey } from "@/lib/storage/keys";

/**
 * `POST /api/uploads/presign` (section 16).
 *
 * This is the authorisation point for every upload. The presigned URL it
 * returns is a bearer credential, so everything that decides whether the
 * upload is allowed has to be decided here:
 *
 *   - the caller has a session,
 *   - the shift they named is one their company owns and they can see,
 *   - the content type is on the allowlist,
 *   - the size is within the per-kind cap.
 *
 * The key is built from the *server's* idea of the company and site, read back
 * off the shift row. A client-supplied key would let a guard write into another
 * company's prefix, which is the storage-layer version of the cross-tenant read
 * that `lib/db/scoped.ts` prevents.
 */

export const runtime = "nodejs";

/** Section 10: photos are compressed client-side; video uploads as-is. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const bodySchema = z.object({
  shiftId: z.string().min(1),
  /** Client-generated so a replayed offline upload reuses the same key. */
  mediaId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  contentType: z.string().min(1),
  bytes: z.number().int().positive(),
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
    return fail("INVALID_BODY", "Missing or malformed upload request.", 400);
  }
  const { shiftId, mediaId, contentType, bytes } = parsed.data;

  const isPhoto = PHOTO_TYPES.includes(contentType);
  const isVideo = VIDEO_TYPES.includes(contentType);
  if (!isPhoto && !isVideo) {
    return fail("UNSUPPORTED_TYPE", `${contentType} cannot be uploaded.`, 415);
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (bytes > maxBytes) {
    return fail(
      "TOO_LARGE",
      `That file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
      413,
    );
  }

  // Scoped read: returns null for a shift in another company, or at a site this
  // actor is not assigned to. That null is the tenancy check.
  const shift = await db(actor).shift.findByIdWithSite(shiftId);
  if (!shift) return fail("NOT_FOUND", "Shift not found.", 404);

  const key = mediaKey({
    companyId: actor.companyId,
    siteId: shift.siteId,
    shiftId: shift.id,
    mediaId,
    variant: "original",
    ext: isVideo ? "bin" : "jpg",
  });

  const presigned = await storage().presignUpload({
    key,
    contentType,
    // The caller's declared size, exactly. It is signed as `Content-Length`,
    // so the browser must send precisely this many bytes: a token minted for
    // a 400 KB photo cannot be used to push 12 MB, and it cannot be used to
    // push 399 KB either. Do NOT add slack for "encoding overhead" -- a raw
    // PUT of a Blob has none, and any mismatch fails the SigV4 signature
    // rather than a size check, so the upload 403s while this route still
    // answers 200.
    contentLength: bytes,
  });

  return NextResponse.json({
    ...presigned,
    kind: isVideo ? "VIDEO" : "PHOTO",
    maxBytes,
  });
}
