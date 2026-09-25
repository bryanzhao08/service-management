"use client";

import { compressImage } from "@/lib/media/compress";

/**
 * The browser half of the upload path (section 10.3-10.4).
 *
 * Three hops, in this order, and the order is the whole point:
 *
 *   1. `POST /api/uploads/presign` — the only authorisation check. It decides
 *      the key from the server's view of the shift, so nothing the client
 *      sends can redirect the bytes into another company's prefix.
 *   2. `PUT` the compressed blob straight at the returned URL.
 *   3. `POST /api/media` — records the row and verifies the object landed.
 *
 * Steps 2 and 3 are separate because on S3 the bytes never touch the app
 * server; the record call is the app finding out the upload succeeded. That
 * also means a failure between 2 and 3 leaves an orphan object, which is what
 * the sweep route in section 21 exists to reclaim.
 */

export type UploadResult = {
  mediaId: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
};

class UploadError extends Error {}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function uploadPhoto({
  file,
  shiftId,
  entryId,
  clientId,
  signal,
}: {
  file: File;
  shiftId: string;
  entryId?: string | null;
  /** Stable across retries so a replay reuses the key and the Media row. */
  clientId: string;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const compressed = await compressImage(file);

  const presignResponse = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shiftId,
      mediaId: clientId,
      contentType: "image/jpeg",
      bytes: compressed.blob.size,
    }),
    signal: signal ?? null,
  });
  if (!presignResponse.ok) {
    throw new UploadError(
      await readError(presignResponse, "Could not start the upload."),
    );
  }
  const presigned = (await presignResponse.json()) as {
    url: string;
    key: string;
    headers: Record<string, string>;
  };

  const put = await fetch(presigned.url, {
    method: "PUT",
    headers: presigned.headers,
    body: compressed.blob,
    signal: signal ?? null,
  });
  if (!put.ok) {
    throw new UploadError(await readError(put, "The photo failed to upload."));
  }

  const record = await fetch("/api/media", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shiftId,
      entryId: entryId ?? null,
      mediaId: clientId,
      key: presigned.key,
      kind: "PHOTO",
      bytes: compressed.blob.size,
      width: compressed.width,
      height: compressed.height,
      capturedAt: compressed.capturedAt.toISOString(),
    }),
    signal: signal ?? null,
  });
  if (!record.ok) {
    throw new UploadError(
      await readError(record, "The photo uploaded but was not saved."),
    );
  }
  const saved = (await record.json()) as { id: string; url: string };

  return {
    mediaId: saved.id,
    url: saved.url,
    width: compressed.width,
    height: compressed.height,
    bytes: compressed.blob.size,
  };
}
