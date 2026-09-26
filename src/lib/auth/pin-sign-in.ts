import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { findPinHash, findSignInUserByEmail } from "@/lib/db/auth-adapter";
import { clearPinAttempts, pinAttemptStatus, pinSchema, recordPinFailure } from "./pin";

/**
 * Email + PIN as a *primary* credential, which is a deliberate departure from
 * the rule stated in `pin.ts`: normally the PIN is only ever a second factor on
 * an already-authenticated session. Here it is the whole credential, so read
 * the limitation below before enabling it.
 *
 * Off unless `PIN_SIGN_IN_ENABLED` is exactly "1". It is opt-in rather than
 * opt-out so that a missing or misspelled variable fails closed.
 *
 * The honest limitation, inherited from `pin.ts`: the attempt counter is an
 * in-memory Map, so it is per-process. On a serverless host each new instance
 * starts a fresh budget, and an attacker who spreads guesses across instances
 * gets far more than `MAX_PIN_ATTEMPTS` against a 4-6 digit secret. That is
 * tolerable for a second factor behind an email round trip. It is not a
 * defensible primary credential, which is why this path is flagged off by
 * default. Moving the counter to a shared store is the fix.
 */

export const PIN_SIGN_IN_ENABLED = process.env.PIN_SIGN_IN_ENABLED === "1";

export const pinSignInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  pin: pinSchema,
});

/**
 * argon2id hash of a sentinel no submitted PIN can equal, since `pinSchema`
 * admits only digits. Verifying against it when the address is unknown or has
 * no PIN set makes those cases cost the same as a real check, so the response
 * time does not say whether an account exists.
 */
const ABSENT_PIN_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$dA9NVv+Ko7acc/UP5FgGkQ$4uiVlo1GPWfEx62Ftc2kTkTPjiGtiFvbZ6Yl+cH7UMY";

/** Namespaced so it cannot collide with the device-unlock counter, which is keyed by user id. */
const attemptKey = (email: string) => `pin-sign-in:${email}`;

export type PinSignInUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Returns the user on success and null on every failure.
 *
 * Unknown address, known address with the wrong PIN, known address with no PIN
 * set, and a locked-out address are all the same `null`, and all do one argon2
 * verification. The sign-in form renders a single message for all of them. That
 * is the same enumeration resistance the magic-link path pays for in
 * `magic-link.ts` and the `signIn` callback, and it is why a locked account is
 * not told that it is locked.
 *
 * Failures are recorded only for addresses that resolve to a real user. An
 * unknown address can never succeed, so counting it would buy nothing and would
 * let anyone grow the in-memory Map without bound by posting random addresses.
 */
export async function authorizePinSignIn(raw: unknown): Promise<PinSignInUser | null> {
  if (!PIN_SIGN_IN_ENABLED) return null;

  const parsed = pinSignInSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, pin } = parsed.data;

  const user = await findSignInUserByEmail(email);

  // A user without a company cannot be tenant-scoped, so it is refused here for
  // the same reason the `signIn` callback refuses it.
  const eligible = user?.companyId ? user : null;

  if (eligible && pinAttemptStatus(attemptKey(email)).locked) {
    await verify(ABSENT_PIN_HASH, pin).catch(() => false);
    return null;
  }

  const stored = eligible ? await findPinHash(eligible.id) : null;

  let ok = false;
  try {
    ok = await verify(stored ?? ABSENT_PIN_HASH, pin);
  } catch {
    // A malformed hash in the column reads as a wrong PIN rather than a 500.
    ok = false;
  }

  if (!eligible || !stored || !ok) {
    if (eligible) recordPinFailure(attemptKey(email));
    return null;
  }

  clearPinAttempts(attemptKey(email));
  return { id: eligible.id, email: eligible.email, name: eligible.name };
}
