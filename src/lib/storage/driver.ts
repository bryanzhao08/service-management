import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { signDownloadToken, signUploadToken } from "./tokens";

/**
 * Object storage.
 *
 * Section 17 requires every object to be private and reached only through a
 * short-lived signed URL, and section 23 requires the whole app to run locally
 * with no paid service. Those two together are what force this interface: the
 * local driver has to be able to mint a URL the browser can PUT to and GET
 * from, exactly like S3 does, or the client would need two code paths and the
 * local one would rot.
 *
 * `STORAGE_DRIVER` picks the implementation. Nothing above this module knows
 * which one it got.
 */

export type PresignedUpload = {
  /** Absolute or app-relative URL the browser PUTs the bytes to. */
  url: string;
  key: string;
  method: "PUT";
  /** Headers the browser must send for the signature to validate. */
  headers: Record<string, string>;
  expiresAt: string;
};

/**
 * The only content types an object may ever be served inline as.
 *
 * A closed union rather than a string, because the whole safety of inline
 * rendering rests on the type being one this server chose. `image/svg+xml` is
 * deliberately absent: an SVG is a script container, and it is also never
 * something the media worker emits -- every derived image is a `sharp` JPEG.
 */
export type InlineType = "image/jpeg" | "application/pdf";

export interface StorageDriver {
  readonly name: "local" | "s3";

  /**
   * A URL the *browser* may upload one object to, bounded by type and size.
   *
   * `contentLength` is the EXACT byte count the browser will send, not a
   * ceiling. The S3 driver signs it into the URL, and SigV4 puts
   * `content-length` in `X-Amz-SignedHeaders`, so a PUT whose body is any
   * other length fails with `SignatureDoesNotMatch` rather than with a size
   * error. Adding slack here does not loosen a limit, it breaks every upload.
   * That is not hypothetical: a `bytes + 4096` "allowance for overhead" made
   * the PUT 403 on every photo in production while presign itself answered
   * 200, so the app reported "the photo failed to upload" with nothing in its
   * own logs.
   */
  presignUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
    ttlSeconds?: number;
  }): Promise<PresignedUpload>;

  /**
   * A short-lived read URL. Section 17: 15 minutes for in-app use.
   *
   * `inline` names the content type to serve the object as, rendered in the
   * page rather than downloaded. Pass it ONLY for bytes this server produced
   * (a `sharp` thumbnail, a generated PDF). Never pass it for an uploaded
   * original: user-supplied bytes served inline are a same-origin script.
   */
  presignDownload(
    key: string,
    ttlSeconds?: number,
    inline?: InlineType,
  ): Promise<string>;

  /** Server-side write, used by the media worker writing derived variants. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Server-side read, used by `sharp` and the PDF generator. */
  get(key: string): Promise<Buffer>;

  /** True if the object exists, used to verify an upload actually landed. */
  size(key: string): Promise<number | null>;

  /** Prefix delete, for retention and for cleaning up a failed upload. */
  deletePrefix(prefix: string): Promise<void>;
}

export const DEFAULT_DOWNLOAD_TTL_SECONDS = 15 * 60;
const DEFAULT_UPLOAD_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Local driver
// ---------------------------------------------------------------------------

export const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

/**
 * Resolves a key under LOCAL_ROOT and refuses to leave it. `lib/storage/keys.ts`
 * already rejects unsafe segments, but this is the last line before the
 * filesystem and a second check here costs nothing. Defence in depth is cheap
 * when the failure mode is writing outside the data directory.
 */
function localPath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  const root = path.resolve(LOCAL_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Storage key escapes the local root: ${key}`);
  }
  return resolved;
}

class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;

  async presignUpload({
    key,
    contentType,
    contentLength,
    ttlSeconds = DEFAULT_UPLOAD_TTL_SECONDS,
  }: {
    key: string;
    contentType: string;
    contentLength: number;
    ttlSeconds?: number;
  }): Promise<PresignedUpload> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    // The local route checks `byteLength > maxBytes`, so the exact length is
    // simply the tightest ceiling it can be handed, and the two drivers stay
    // interchangeable.
    const token = signUploadToken({ key, contentType, maxBytes: contentLength, exp });
    return {
      // App-relative on purpose. An absolute URL built from an env var is how
      // uploads start failing on a preview deployment whose host differs from
      // NEXT_PUBLIC_APP_URL.
      url: `/api/uploads/local?token=${encodeURIComponent(token)}`,
      key,
      method: "PUT",
      headers: { "content-type": contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async presignDownload(
    key: string,
    ttlSeconds = DEFAULT_DOWNLOAD_TTL_SECONDS,
    inline?: InlineType,
  ): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = signDownloadToken({ key, exp, ...(inline ? { inline } : {}) });
    return `/api/uploads/local?token=${encodeURIComponent(token)}`;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(localPath(key));
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(localPath(key))).size;
    } catch {
      return null;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(localPath(prefix), { recursive: true, force: true });
  }

  /** Local-driver-only: the route handler streams the file back from here. */
  stream(key: string): NodeJS.ReadableStream {
    return createReadStream(localPath(key));
  }
}

// ---------------------------------------------------------------------------
// S3 driver
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`STORAGE_DRIVER=s3 requires ${name} to be set.`);
  }
  return value;
}

class S3StorageDriver implements StorageDriver {
  readonly name = "s3" as const;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    this.bucket = requireEnv("S3_BUCKET");
    const endpoint = process.env["S3_ENDPOINT"];
    const sessionToken = process.env["S3_SESSION_TOKEN"];
    this.client = new S3Client({
      region: process.env["S3_REGION"] ?? "us-east-1",
      ...(endpoint
        ? // MinIO and R2 both need path style; a bucket-as-subdomain request
          // against a bare endpoint resolves to nothing.
          { endpoint, forcePathStyle: true }
        : {}),
      credentials: {
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
        // Temporary credentials sign with a third field: STS and assumed IAM
        // roles issue them, and a provider that expects one rejects the
        // key/secret pair on its own with InvalidAccessKeyId, so omitting it
        // is not a degraded mode, it is a hard failure on every request. R2
        // and MinIO use long-lived keys and leave this unset.
        ...(sessionToken ? { sessionToken } : {}),
      },
    });
  }

  async presignUpload({
    key,
    contentType,
    contentLength,
    ttlSeconds = DEFAULT_UPLOAD_TTL_SECONDS,
  }: {
    key: string;
    contentType: string;
    contentLength: number;
    ttlSeconds?: number;
  }): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        // Exact, never a ceiling. This lands in `X-Amz-SignedHeaders` as
        // `content-length`, so the browser has to send this many bytes and no
        // other number: too few and too many both fail identically, as
        // `SignatureDoesNotMatch`. That makes it the tightest size control
        // available here, and also the easiest one to break by "allowing
        // overhead".
        ContentLength: contentLength,
      }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      key,
      method: "PUT",
      headers: { "content-type": contentType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  async presignDownload(
    key: string,
    ttlSeconds = DEFAULT_DOWNLOAD_TTL_SECONDS,
    inline?: InlineType,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // S3 stores whatever type `put` was given; these response overrides
        // are what make the browser render it rather than save it. They are
        // part of the signature, so a caller cannot add them to a URL.
        ...(inline
          ? { ResponseContentType: inline, ResponseContentDisposition: "inline" }
          : {
              ResponseContentType: "application/octet-stream",
              ResponseContentDisposition: "attachment",
            }),
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object at ${key}`);
    return Buffer.from(bytes);
  }

  async size(key: string): Promise<number | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return result.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
      }
      token = listed.NextContinuationToken;
    } while (token);
  }
}

// ---------------------------------------------------------------------------

let cached: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (cached) return cached;
  cached =
    process.env["STORAGE_DRIVER"] === "s3"
      ? new S3StorageDriver()
      : new LocalStorageDriver();
  return cached;
}

/** The local driver's file stream, for the local upload route only. */
export function localStream(key: string): NodeJS.ReadableStream {
  const driver = storage();
  if (!(driver instanceof LocalStorageDriver)) {
    throw new Error("localStream is only valid for STORAGE_DRIVER=local");
  }
  return driver.stream(key);
}

/** Test seam: forces the next `storage()` call to re-read the environment. */
export function resetStorageForTests(): void {
  cached = null;
}
