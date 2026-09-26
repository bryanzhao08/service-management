import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setPin } from "@/lib/auth/pin";
import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Email + PIN sign-in is the one place a PIN is a primary credential rather
 * than a second factor on an already-authenticated session, which is the exact
 * rule `lib/auth/pin.ts` otherwise states. Two properties are what make that
 * tolerable at all, so both are pinned here:
 *
 *   1. Every rejection is indistinguishable, so the form cannot be used to
 *      find out who has an account.
 *   2. The attempt counter actually engages, because a 4-6 digit secret is not
 *      protected by its hash.
 *
 * Written against the real database rather than a mock: the thing under test
 * is whether a real argon2 hash in a real column is accepted, and a mock would
 * only prove it returns what it was told to.
 *
 * Each case reloads the module so the in-memory attempt counter starts empty;
 * otherwise an earlier failure would leak into a later case and a passing test
 * could be measuring the wrong reason.
 */

const GOOD_PIN = "135790";
const WRONG_PIN = "246801";

let tenant: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  await resetDatabase();
  tenant = await createTenant("pinco");
  await setPin(tenant.guard.id, GOOD_PIN);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await raw.$disconnect();
});

async function loadAuthorize(enabled = true) {
  vi.resetModules();
  vi.stubEnv("PIN_SIGN_IN_ENABLED", enabled ? "1" : "0");
  const mod = await import("@/lib/auth/pin-sign-in");
  return mod.authorizePinSignIn;
}

describe("email + PIN sign-in", () => {
  it("accepts the right email and PIN", async () => {
    // The control. Every rejection below would pass just as happily against a
    // path that can never accept anything, which would prove nothing.
    const authorize = await loadAuthorize();
    const user = await authorize({ email: tenant.guard.email, pin: GOOD_PIN });
    expect(user).not.toBeNull();
    expect(user?.id).toBe(tenant.guard.id);
  });

  it("is case and whitespace insensitive on the address", async () => {
    const authorize = await loadAuthorize();
    const user = await authorize({
      email: `  ${tenant.guard.email.toUpperCase()}  `,
      pin: GOOD_PIN,
    });
    expect(user?.id).toBe(tenant.guard.id);
  });

  it("refuses the wrong PIN", async () => {
    const authorize = await loadAuthorize();
    expect(await authorize({ email: tenant.guard.email, pin: WRONG_PIN })).toBeNull();
  });

  it("refuses an address with no account", async () => {
    const authorize = await loadAuthorize();
    expect(await authorize({ email: "nobody@nowhere.test", pin: GOOD_PIN })).toBeNull();
  });

  it("refuses a real account that has not set a PIN", async () => {
    // Indistinguishable from the two cases above by design: the unlock screen
    // and this form must not reveal account state.
    const authorize = await loadAuthorize();
    expect(await authorize({ email: tenant.owner.email, pin: GOOD_PIN })).toBeNull();
    const owner = await raw.user.findUnique({ where: { id: tenant.owner.id } });
    expect(owner?.pinHash).toBeNull();
  });

  it("refuses a PIN that is not 4 to 6 digits", async () => {
    const authorize = await loadAuthorize();
    expect(await authorize({ email: tenant.guard.email, pin: "12" })).toBeNull();
    expect(await authorize({ email: tenant.guard.email, pin: "1234567" })).toBeNull();
    expect(await authorize({ email: tenant.guard.email, pin: "abcd" })).toBeNull();
  });

  it("refuses everything when the flag is off", async () => {
    // Fails closed: the provider is not registered either, so this is the
    // second of two gates rather than the only one.
    const authorize = await loadAuthorize(false);
    expect(await authorize({ email: tenant.guard.email, pin: GOOD_PIN })).toBeNull();
  });

  it("stops guessing after the attempt limit, even for the right PIN", async () => {
    const authorize = await loadAuthorize();
    const { MAX_PIN_ATTEMPTS } = await import("@/lib/auth/pin");

    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      expect(await authorize({ email: tenant.guard.email, pin: WRONG_PIN })).toBeNull();
    }

    // The discriminator. Without a working counter this returns the user,
    // because the PIN is correct.
    expect(await authorize({ email: tenant.guard.email, pin: GOOD_PIN })).toBeNull();
  });

  it("does not count failures against an address with no account", async () => {
    // Otherwise anyone could grow the in-memory counter without bound by
    // posting random addresses, and locking a nonexistent account buys nothing
    // since it can never succeed anyway.
    const authorize = await loadAuthorize();
    const { MAX_PIN_ATTEMPTS, pinAttemptStatus } = await import("@/lib/auth/pin");

    for (let i = 0; i < MAX_PIN_ATTEMPTS + 2; i++) {
      await authorize({ email: "ghost@nowhere.test", pin: WRONG_PIN });
    }

    expect(pinAttemptStatus("pin-sign-in:ghost@nowhere.test").locked).toBe(false);
  });

  it("clears the counter on a success, so one fumble is not permanent", async () => {
    const authorize = await loadAuthorize();
    const { pinAttemptStatus } = await import("@/lib/auth/pin");

    expect(await authorize({ email: tenant.guard.email, pin: WRONG_PIN })).toBeNull();
    expect(
      await authorize({ email: tenant.guard.email, pin: GOOD_PIN }),
    ).not.toBeNull();
    expect(pinAttemptStatus(`pin-sign-in:${tenant.guard.email}`).remaining).toBe(
      (await import("@/lib/auth/pin")).MAX_PIN_ATTEMPTS,
    );
  });
});
