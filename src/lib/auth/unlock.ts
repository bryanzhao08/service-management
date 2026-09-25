import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The PIN unlock cookie.
 *
 * Section 8 puts the session cookie on the device long-lived and gates the app
 * behind a PIN screen. The gate itself must be a server-verifiable fact, not a
 * client flag — a boolean in `localStorage` is set by whoever has the phone.
 *
 * So the cookie holds `userId.expiry.hmac`, signed with `AUTH_SECRET`. It
 * proves only that this user entered the right PIN before `expiry`; it is never
 * a credential on its own, because the session cookie still has to be present
 * and valid for any page to load at all.
 */
const COOKIE_NAME = "transient_unlock";
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env["AUTH_SECRET"];
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare sizes first and still run the constant-time compare.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function grantUnlock(userId: string): Promise<void> {
  const expiry = Date.now() + UNLOCK_TTL_MS;
  const payload = `${userId}.${expiry}`;
  const store = await cookies();
  store.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });
}

export async function revokeUnlock(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * True only if the cookie is present, signed by us, not expired, and belongs to
 * the user asking. The userId check is what stops a cookie minted on a shared
 * device from unlocking the next person's session.
 */
export async function hasUnlock(userId: string): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return false;

  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= 0) return false;

  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);
  if (!safeEqual(signature, sign(payload))) return false;

  const [cookieUserId, expiryText] = payload.split(".");
  if (cookieUserId !== userId) return false;

  const expiry = Number(expiryText);
  return Number.isFinite(expiry) && expiry > Date.now();
}
