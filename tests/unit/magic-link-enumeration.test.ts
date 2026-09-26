import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

/**
 * Sign-in must answer identically whether or not the address has an account.
 *
 * Transient has no self-registration, so the real addresses are exactly the
 * customer's staff list. `index.ts` already returned quietly for an unknown
 * address, but a *failed send* for a known one propagated, and Auth.js renders
 * a throw as `?error=Configuration` while the quiet path redirects to
 * `verify-request`. Those two outcomes are distinguishable, so the failure mode
 * of the email provider became an enumeration oracle.
 *
 * It is worst under attack. An unknown address never reaches the provider, so
 * a send-rate limit, a suppression, or a hard bounce can only ever raise an
 * error for an address that really exists.
 *
 * Observed on production before this fix, with a sandbox sender that refuses
 * every recipient except the account owner:
 *
 *   nobody-26758@example.com    unknown  -> /api/auth/verify-request
 *   owner@meridian.test         KNOWN    -> /sign-in?error=Configuration
 *   guard.night@meridian.test   KNOWN    -> /sign-in?error=Configuration
 *   another-17629@example.com   unknown  -> /api/auth/verify-request
 *   tobiadesanya103@gmail.com   KNOWN    -> /api/auth/verify-request
 */

const findSignInUserByEmail = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/auth-adapter", () => ({ findSignInUserByEmail }));
vi.mock("@/lib/email/provider", () => ({ getEmailProvider: () => ({ send }) }));

const KNOWN = "owner@meridian.test";
const UNKNOWN = "nobody@example.com";
const URL_ = "https://transient.example/api/auth/callback/magic-link?token=abc";

async function deliver(identifier: string) {
  const { deliverMagicLink } = await import("@/lib/auth/magic-link");
  return deliverMagicLink({ identifier, url: URL_ });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("magic-link delivery cannot reveal whether an account exists", () => {
  it("resolves for an unknown address without contacting the provider", async () => {
    findSignInUserByEmail.mockResolvedValue(null);

    await expect(deliver(UNKNOWN)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("resolves for a known address even when the send is rejected", async () => {
    findSignInUserByEmail.mockResolvedValue({ id: "u1", email: KNOWN });
    send.mockRejectedValue(
      new Error(
        "resend: validation_error: You can only send testing emails to your own address",
      ),
    );

    // Throwing here is the whole bug: it is what Auth.js turns into
    // `?error=Configuration`, which an unknown address never produces.
    await expect(deliver(KNOWN)).resolves.toBeUndefined();
  });

  it("is indistinguishable from the unknown-address path when the send fails", async () => {
    findSignInUserByEmail.mockResolvedValue(null);
    const unknown = await deliver(UNKNOWN).then(
      (v) => ({ ok: true, v }),
      (e) => ({ ok: false, v: e }),
    );

    vi.clearAllMocks();
    findSignInUserByEmail.mockResolvedValue({ id: "u1", email: KNOWN });
    send.mockRejectedValue(new Error("resend: rate_limit_exceeded"));
    const known = await deliver(KNOWN).then(
      (v) => ({ ok: true, v }),
      (e) => ({ ok: false, v: e }),
    );

    // Same settlement, same value. Anything an Auth.js caller can branch on.
    expect(known).toEqual(unknown);
  });

  it("still tells the operator why nothing was delivered", async () => {
    findSignInUserByEmail.mockResolvedValue({ id: "u1", email: KNOWN });
    send.mockRejectedValue(new Error("resend: rate_limit_exceeded"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await deliver(KNOWN);

    // Silence would trade one bug for a worse one: undeliverable mail that
    // nobody ever finds out about.
    const logged = String(error.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("rate_limit_exceeded");
    expect(logged).toContain("delivery failed");
  });

  it("actually sends to a known address when the provider accepts", async () => {
    findSignInUserByEmail.mockResolvedValue({ id: "u1", email: KNOWN });
    send.mockResolvedValue({ messageId: "m1", provider: "resend" });

    await deliver(KNOWN);

    // Guards the happy path: without this, swallowing the send entirely, or
    // never calling it at all, would pass every test above.
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]?.[0];
    expect(message.to).toBe(KNOWN);
    expect(`${message.html}${message.text}`).toContain(URL_);
  });
});
