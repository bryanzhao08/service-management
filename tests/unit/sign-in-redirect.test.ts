import { describe, expect, it } from "vitest";

import { safeRedirect } from "@/lib/auth/safe-redirect";

/**
 * The `from` parameter on the sign-in form is attacker-controlled: it arrives in
 * the query string and is handed to `redirect()` after a successful sign-in. If
 * it can name another origin, the app becomes a credible-looking launchpad for
 * a phishing page, reached from a real link to a real domain.
 *
 * The rule is narrow on purpose: a same-site path, or nothing. These cases are
 * the shapes that have historically slipped past a `startsWith("/")` check.
 */
describe("safeRedirect", () => {
  const FALLBACK = "/dashboard";

  it("keeps an ordinary same-site path, which is the whole point", () => {
    expect(safeRedirect("/reports")).toBe("/reports");
    expect(safeRedirect("/shift/abc123/end")).toBe("/shift/abc123/end");
  });

  it("keeps a path that carries its own query and fragment", () => {
    expect(safeRedirect("/reports?site=abc#top")).toBe("/reports?site=abc#top");
  });

  it("refuses a protocol-relative URL, which looks like a path but is not", () => {
    expect(safeRedirect("//evil.test")).toBe(FALLBACK);
    expect(safeRedirect("//evil.test/dashboard")).toBe(FALLBACK);
  });

  it("refuses a backslash, because browsers disagree about normalising it", () => {
    // Some browsers read `/\evil.test` as `//evil.test` and leave the origin.
    expect(safeRedirect("/\\evil.test")).toBe(FALLBACK);
    expect(safeRedirect("/\\/evil.test")).toBe(FALLBACK);
    expect(safeRedirect("/reports\\@evil.test")).toBe(FALLBACK);
  });

  it("refuses an absolute URL in any scheme", () => {
    expect(safeRedirect("https://evil.test")).toBe(FALLBACK);
    expect(safeRedirect("http://evil.test")).toBe(FALLBACK);
    expect(safeRedirect("javascript:alert(1)")).toBe(FALLBACK);
    expect(safeRedirect("data:text/html,<script>alert(1)</script>")).toBe(FALLBACK);
  });

  it("refuses anything that is not a string, including a missing value", () => {
    expect(safeRedirect(null)).toBe(FALLBACK);
    expect(safeRedirect("")).toBe(FALLBACK);
    expect(safeRedirect(new File([], "x"))).toBe(FALLBACK);
  });
});
