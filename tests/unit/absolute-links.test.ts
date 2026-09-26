import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { appUrl, baseUrl } from "@/lib/url";

/**
 * Every absolute link this app emits comes out of one function.
 *
 * `src/lib/url.ts` says so in its own doc comment, and the reason is specific:
 * a link we put in an email or print into a PDF is opened days later by someone
 * who is not signed in, on a device that has never touched this app. A wrong
 * origin is a dead link in a manager's inbox during the argument it exists to
 * settle. There is no relative-path fallback and no second chance.
 *
 * That was documented and then not enforced, so it broke exactly the way the
 * doc comment predicted. `build-report.ts` grew its own
 * `process.env["APP_URL"]` read for the gallery link it prints -- and `APP_URL`
 * is set nowhere in this repo, so it always fell through to
 * `http://localhost:3000`. The renderer then encoded that into the QR code on
 * page one of every report. The same report disagreed with itself: the gallery
 * link in the covering email was right, the one on the PDF a client actually
 * scans pointed at their own phone.
 *
 * It survived 329 tests because `report-render.test.ts` passes `galleryUrl` in
 * as a fixture literal. That tests the renderer, which was never wrong -- it
 * faithfully renders whatever URL it is handed -- and never the caller that
 * computes it. A test that supplies the value the bug corrupts cannot see the
 * bug.
 *
 * So the pin below is deliberately not "build-report now returns the right
 * string". It is the invariant itself, across the whole source tree, because
 * the failure is a class rather than an instance: the next handler that needs
 * an absolute link is one `process.env` read away from doing this again.
 */

const SRC = join(process.cwd(), "src");

/** Env vars that name this deployment's own origin. */
const ORIGIN_VARS = ["APP_URL", "NEXT_PUBLIC_APP_URL", "NEXTAUTH_URL", "AUTH_URL"];

/** The one module allowed to read them, plus config that must read them early. */
const ALLOWED = ["lib/url.ts", "app/layout.tsx", "lib/auth/config.ts"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("absolute links", () => {
  it("resolves against the configured origin, not a baked-in host", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    const prevAuth = process.env.NEXTAUTH_URL;
    try {
      delete process.env.NEXTAUTH_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://reports.example.com";
      expect(baseUrl()).toBe("https://reports.example.com");
      // The shape that goes into the PDF's QR code.
      expect(appUrl("/g/abc123")).toBe("https://reports.example.com/g/abc123");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
      if (prevAuth !== undefined) process.env.NEXTAUTH_URL = prevAuth;
    }
  });

  it("is never re-derived from env at an individual call site", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.some((a) => rel === a)) continue;

      const text = readFileSync(file, "utf8");
      for (const v of ORIGIN_VARS) {
        // Both spellings: process.env.APP_URL and process.env["APP_URL"].
        const pattern = new RegExp(
          `process\\.env(\\.${v}\\b|\\["${v}"\\]|\\['${v}'\\])`,
        );
        if (pattern.test(text)) offenders.push(`${rel} reads ${v}`);
      }
    }

    // Named rather than counted, so a failure says which file to open.
    expect(offenders).toEqual([]);
  });
});
