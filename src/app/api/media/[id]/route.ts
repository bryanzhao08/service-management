import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";
import { storage } from "@/lib/storage/driver";
import { companyIdFromKey } from "@/lib/storage/keys";

/**
 * `GET /api/media/[id]` (section 16).
 *
 * Every object is private (section 17), so this is the only way to read one.
 * It answers with a 307 to a short-lived signed URL rather than proxying the
 * bytes: the redirect target is cacheable by the browser for the life of the
 * signature, and on S3 it means photo traffic never touches the app server.
 *
 * `?variant=thumb|pdf|original` picks the derived file. Before milestone 5's
 * worker has run, only `original` exists, so an unbuilt variant falls back to
 * it instead of 404-ing — a guard looking at a photo they just took should see
 * the photo, not an error about a background job.
 */

export const runtime = "nodejs";

const VARIANTS = ["original", "thumb", "pdf"] as const;
type Variant = (typeof VARIANTS)[number];

function isVariant(value: string | null): value is Variant {
  return value !== null && (VARIANTS as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in to view media." } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const media = await db(actor).media.findById(id);
  // Scoped read already applied tenancy, so this null is "not yours" and "not
  // there" collapsed into one answer on purpose: a 403 here would confirm the
  // id exists, which is an enumeration oracle over another company's media.
  if (!media) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Media not found." } },
      { status: 404 },
    );
  }

  const requested = new URL(request.url).searchParams.get("variant");
  const variant: Variant = isVariant(requested) ? requested : "original";
  const key =
    (variant === "thumb" ? media.storageKeyThumb : null) ??
    (variant === "pdf" ? media.storageKeyPdf : null) ??
    media.storageKeyOriginal;

  // Belt and braces: the row was reached through the scoped layer, so its key
  // should already be in this company's prefix. If it is not, something wrote
  // a row it should not have and serving it would launder that mistake.
  if (companyIdFromKey(key) !== actor.companyId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Media not found." } },
      { status: 404 },
    );
  }

  const url = await storage().presignDownload(key);
  return NextResponse.redirect(new URL(url, request.url), {
    status: 307,
    headers: { "cache-control": "private, no-store" },
  });
}
