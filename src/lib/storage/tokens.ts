import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Upload and download tokens for the local storage driver.
 *
 * The S3 driver gets presigned URLs from AWS. The local driver has to produce
 * something with the same shape and the same guarantees, or the client code
 * would have to branch on the driver — and then the local path would be the
 * one nobody tests. So the local driver signs its own URLs here.
 *
 * What the signature has to cover is the whole point. A token that only signed
 * the key would let a guard who legitimately obtained one upload URL replace
 * any object by changing the path, or upload a 200 MB file where a 12 MB photo
 * was authorised. Everything the route handler will enforce is therefore inside
 * the signed payload: the key, the content type, the byte ceiling, and the
 * expiry.
 */

const VERSION = "v1";

export type UploadToken = {
  key: string;
  contentType: string;
  maxBytes: number;
  /** Unix seconds. */
  exp: number;
};

export type DownloadToken = {
  key: string;
  /** Unix seconds. */
  exp: number;
  /**
   * The exact content type to serve this object as, inline.
   *
   * Absent means the default: `application/octet-stream` as an attachment,
   * which is the only safe way to hand back bytes a user uploaded. An
   * uploaded `.svg` or `.html` served inline would run as same-origin script.
   *
   * It is set only for objects the server itself produced -- a `sharp`
   * re-encode or a generated PDF -- where the bytes are ours and the type is
   * known rather than claimed. Because it lives inside the signed token, the
   * caller asking for the object cannot choose it.
   */
  inline?: string;
};

/**
 * The receipt link from section 9.5: a manager with no account opens it and
 * sees who the report went to and what happened to it.
 *
 * It lives in this module rather than in its own because the HMAC machinery
 * below is the part that has to be right, and a second copy is how one of them
 * ends up without the constant-time compare. What differs is only the claim
 * shape, so only the claim shape is separate.
 */
export type ReceiptToken = {
  reportId: string;
  /** Unix seconds. Milliseconds here would read as the year 58000, i.e. a
   *  bearer link that never expires. */
  exp: number;
};

function secret(): string {
  const value = process.env["LINK_SIGNING_SECRET"];
  if (!value || value.length < 16) {
    // Failing loudly beats signing with an empty string, which would make every
    // token forgeable while the app looked like it was working.
    throw new Error(
      "LINK_SIGNING_SECRET is missing or too short; storage URLs cannot be signed.",
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

type AnyToken = UploadToken | DownloadToken | ReceiptToken;

function encode(claims: AnyToken): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${sign(`${VERSION}.${payload}`)}`;
}

function decode<T extends AnyToken>(token: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts as [string, string, string];
  if (version !== VERSION) return null;

  const expected = sign(`${version}.${payload}`);
  // Length check first: timingSafeEqual throws on a length mismatch, and a
  // thrown exception is itself an oracle for "wrong length".
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"))) {
    return null;
  }

  let claims: T;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) {
    return null;
  }
  return claims;
}

export function signUploadToken(claims: UploadToken): string {
  return encode(claims);
}

export function verifyUploadToken(token: string): UploadToken | null {
  const claims = decode<UploadToken>(token);
  if (!claims) return null;
  if (
    typeof claims.key !== "string" ||
    typeof claims.contentType !== "string" ||
    typeof claims.maxBytes !== "number"
  ) {
    return null;
  }
  return claims;
}

export function signDownloadToken(claims: DownloadToken): string {
  return encode(claims);
}

export function verifyDownloadToken(token: string): DownloadToken | null {
  const claims = decode<DownloadToken>(token);
  if (!claims) return null;
  return typeof claims.key === "string" ? claims : null;
}

/** How long a shared receipt link stays live (section 9.5). */
export const RECEIPT_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Builds the claims for a receipt link.
 *
 * Separate from the server action that mints it so the expiry arithmetic is
 * reachable from a test. `exp` is the one field in this module with a unit
 * that the type cannot carry, and getting it wrong does not fail -- it
 * produces a bearer link that outlives the company.
 */
export function receiptClaims(reportId: string, now = new Date()): ReceiptToken {
  return {
    reportId,
    exp: Math.floor(now.getTime() / 1000) + RECEIPT_TTL_SECONDS,
  };
}

export function signReceiptToken(claims: ReceiptToken): string {
  return encode(claims);
}

export function verifyReceiptToken(token: string): ReceiptToken | null {
  const claims = decode<ReceiptToken>(token);
  if (!claims) return null;
  return typeof claims.reportId === "string" ? claims : null;
}
