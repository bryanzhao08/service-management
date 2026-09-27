import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sign-up pages have to be reachable with no session, and that is a
 * property of `proxy.ts`, not of the pages.
 *
 * Read as source rather than exercised, because the alternative is booting the
 * edge runtime with a NextAuth instance to assert a string is in an array. The
 * failure this guards against is deletion during an unrelated edit, and a
 * source read catches that: the default in `proxy.ts` is that a path requires
 * a session, so forgetting one fails closed and silently. It already happened
 * once — every one of these routes 307'd to `/sign-in?from=/sign-up` on the
 * first run, which is the sign-in page that tells people to ask a supervisor
 * for the account they are trying to create.
 */

const PROXY = readFileSync(
  join(process.cwd(), "src", "proxy.ts"),
  "utf8",
);

describe("proxy", () => {
  it("lets someone with no account reach sign-up", () => {
    expect(PROXY).toContain('pathname === "/sign-up"');
    expect(PROXY).toContain('pathname.startsWith("/sign-up/")');
  });

  it("does not bounce a signed-in user out of the verify POST", () => {
    // `completeSignUp` posts to /sign-up/verify. Adding that exact path to the
    // signed-in redirect would swallow the submit, so only the form itself is
    // listed there.
    const redirectBlock = PROXY.slice(
      PROXY.indexOf("A signed-in user has no reason"),
    );
    expect(redirectBlock).toContain('pathname === "/sign-up"');
    expect(redirectBlock).not.toContain('"/sign-up/verify"');
  });
});
