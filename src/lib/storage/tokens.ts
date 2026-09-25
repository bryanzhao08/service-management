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

function encode(claims: UploadToken | DownloadToken): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${VERSION}.${payload}.${sign(`${VERSION}.${payload}`)}`;
}

function decode<T extends UploadToken | DownloadToken>(token: string): T | null {
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
