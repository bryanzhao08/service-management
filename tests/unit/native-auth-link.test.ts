import { describe, expect, it } from "vitest";

import { nativeAuthTarget, nativeSignInLink } from "@/lib/native/auth-link";
import { magicLinkEmail } from "@/lib/email/templates";

const origin = "https://transient.example";
const callback = `${origin}/api/auth/callback/magic-link?token=one-time-token&email=guard%40example.com`;

describe("native magic links", () => {
  it("round-trips the callback without changing its token or email", () => {
    expect(nativeAuthTarget(nativeSignInLink(callback), origin)).toBe(callback);
  });
  it.each([
    "https://evil.example/api/auth/callback/magic-link?token=x&email=x",
    `${origin}/api/jobs/sweep?token=x&email=x`,
    `${origin}/api/auth/callback/magic-link?email=x`,
    "javascript:alert(1)",
    "https://user:password@transient.example/api/auth/callback/magic-link?token=x&email=x",
  ])("refuses an untrusted callback: %s", (target) => {
    expect(nativeAuthTarget(nativeSignInLink(target), origin)).toBeNull();
  });
  it("refuses other incoming schemes and malformed URLs", () => {
    expect(nativeAuthTarget("https://transient.example", origin)).toBeNull();
    expect(nativeAuthTarget("invalid", origin)).toBeNull();
  });
  it("keeps web login and adds the optional native login link", () => {
    const nativeUrl = nativeSignInLink(callback);
    const email = magicLinkEmail({
      to: "guard@example.com",
      url: callback,
      expiresInMinutes: 10,
      nativeUrl,
    });
    // The href is HTML-escaped, so the `&` separator arrives as `&amp;`.
    // nativeUrl needs no escaping because nativeSignInLink percent-encodes it.
    expect(email.html).toContain(`href="${callback.replace(/&/g, "&amp;")}"`);
    expect(email.html).toContain(`href="${nativeUrl}"`);
    expect(email.text).toContain(nativeUrl);
  });
});
