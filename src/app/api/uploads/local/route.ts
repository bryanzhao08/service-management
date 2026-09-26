import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { NextResponse } from "next/server";

import { localStream, storage } from "@/lib/storage/driver";
import { verifyDownloadToken, verifyUploadToken } from "@/lib/storage/tokens";

/**
 * The local storage driver's equivalent of an S3 presigned URL.
 *
 * There is deliberately no session check here, and that is not an oversight.
 * A presigned URL *is* the credential — that is what "presigned" means, and it
 * is what lets the browser PUT bytes straight past the app server the same way
 * it would to S3. The authorisation happened when `POST /api/uploads/presign`
 * checked the session and decided to mint the token.
 *
 * So everything this route enforces comes out of the signed payload, never out
 * of the request: the key, the content type, and the byte ceiling. A caller who
 * edits any of them invalidates the signature.
 */

export const runtime = "nodejs";

/** Mirrors `InlineType`. A set, because this is a runtime check on a value
 *  that arrived from outside the type system, inside a token. */
const INLINE_TYPES = new Set(["image/jpeg", "application/pdf"]);

function unauthorized() {
  return NextResponse.json(
    { error: { code: "INVALID_TOKEN", message: "Link expired or invalid." } },
    { status: 401 },
  );
}

export async function PUT(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();

  const claims = verifyUploadToken(token);
  if (!claims) return unauthorized();

  const contentType = request.headers.get("content-type");
  if (contentType !== claims.contentType) {
    return NextResponse.json(
      {
        error: {
          code: "CONTENT_TYPE_MISMATCH",
          message: `This upload was authorised for ${claims.contentType}.`,
        },
      },
      { status: 400 },
    );
  }

  // Read into memory before writing. The cap is 200 MB for video (section 10.3)
  // which is large but bounded, and buffering is what lets the size be checked
  // against the *signed* ceiling rather than a client-supplied Content-Length
  // header that may lie.
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > claims.maxBytes) {
    return NextResponse.json(
      {
        error: {
          code: "TOO_LARGE",
          message: `Upload exceeds the ${claims.maxBytes} byte limit for this link.`,
        },
      },
      { status: 413 },
    );
  }

  await storage().put(claims.key, body, claims.contentType);
  return NextResponse.json({ key: claims.key, bytes: body.byteLength });
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return unauthorized();

  const claims = verifyDownloadToken(token);
  if (!claims) return unauthorized();

  const bytes = await storage().size(claims.key);
  if (bytes === null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Object not found." } },
      { status: 404 },
    );
  }

  const stream = Readable.toWeb(
    localStream(claims.key) as Readable,
  ) as WebReadableStream<Uint8Array>;

  return new Response(stream as unknown as BodyInit, {
    headers: {
      "content-length": String(bytes),
      // The token already bounds the lifetime, so the cache may hold it for
      // exactly as long as the token is valid and no longer.
      "cache-control": `private, max-age=${Math.max(
        0,
        claims.exp - Math.floor(Date.now() / 1000),
      )}`,
      // Default: these objects are user-supplied bytes. Serving them inline
      // would make an uploaded .html or .svg same-origin script.
      //
      // `claims.inline` is the narrow exception, and it is safe for two
      // reasons that both have to hold: it is inside the signed token, so the
      // caller cannot add it to a URL, and the server only signs it for bytes
      // it produced itself. The allowlist here is a third check, so a future
      // caller that passes something odd gets a download rather than a
      // rendered document.
      ...(claims.inline && INLINE_TYPES.has(claims.inline)
        ? { "content-disposition": "inline", "content-type": claims.inline }
        : {
            "content-disposition": "attachment",
            "content-type": "application/octet-stream",
          }),
      "x-content-type-options": "nosniff",
    },
  });
}
