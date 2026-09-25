import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { findPinHash, setPinHash } from "@/lib/db/auth-adapter";

/**
 * Device PIN. Section 8: after the first magic-link sign-in on a device, the
 * user may set a 4-6 digit PIN; later opens on that device ask for the PIN
 * rather than another email round trip.
 *
 * A 4-digit PIN has 10,000 possibilities, so the hash is not what protects it —
 * rate limiting is. argon2id is still used rather than a plain digest because
 * it makes an offline attack on a leaked `pinHash` column expensive, and
 * because the cost of getting this wrong is someone else's shift log.
 *
 * The PIN is a second factor on an already-authenticated session, never a
 * credential on its own: `verifyPin` is only ever called for the signed-in
 * user's own id.
 */

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits");

/** OWASP's argon2id baseline; ~19 MiB and a few ms on a modern server. */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

export async function setPin(userId: string, pin: string): Promise<void> {
  const parsed = pinSchema.parse(pin);
  await setPinHash(userId, await hash(parsed, ARGON2_OPTIONS));
}

export async function clearPin(userId: string): Promise<void> {
  await setPinHash(userId, null);
}

/**
 * Returns false for a wrong PIN and for a user who has not set one. The two
 * cases are deliberately indistinguishable to the caller so the unlock screen
 * cannot be used to probe account state.
 */
export async function verifyPin(
  userId: string,
  pin: string,
): Promise<boolean> {
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) return false;

  const stored = await findPinHash(userId);
  if (!stored) return false;

  try {
    return await verify(stored, parsed.data);
  } catch {
    // A malformed hash in the column should read as "wrong PIN", not crash the
    // unlock screen and lock the user out of their own shift.
    return false;
  }
}

/**
 * In-memory attempt counter, keyed by user. Section 17 asks for rate limiting
 * on sign-in with "simple in-memory or @upstash/ratelimit if configured"; this
 * is the simple one.
 *
 * Honest limitation: it is per-process, so it does not hold across serverless
 * instances. It raises the cost of guessing a 4-digit PIN from instant to
 * impractical on any single instance, and the swap to a shared store is one
 * module.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();

export function pinAttemptStatus(userId: string): {
  locked: boolean;
  remaining: number;
  retryAfterMs: number;
} {
  const record = attempts.get(userId);
  if (!record) {
    return { locked: false, remaining: MAX_PIN_ATTEMPTS, retryAfterMs: 0 };
  }

  const elapsed = Date.now() - record.firstAt;
  if (elapsed >= PIN_LOCKOUT_MS) {
    attempts.delete(userId);
    return { locked: false, remaining: MAX_PIN_ATTEMPTS, retryAfterMs: 0 };
  }

  const remaining = Math.max(0, MAX_PIN_ATTEMPTS - record.count);
  return {
    locked: remaining === 0,
    remaining,
    retryAfterMs: remaining === 0 ? PIN_LOCKOUT_MS - elapsed : 0,
  };
}

export function recordPinFailure(userId: string): void {
  const record = attempts.get(userId);
  if (!record || Date.now() - record.firstAt >= PIN_LOCKOUT_MS) {
    attempts.set(userId, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count += 1;
}

export function clearPinAttempts(userId: string): void {
  attempts.delete(userId);
}
