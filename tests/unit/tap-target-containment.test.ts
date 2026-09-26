import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `.tap-target` grows an invisible 48px hit area with an absolutely positioned
 * `::after`. `position: absolute` resolves against the nearest *positioned*
 * ancestor, so on an element left `static` it resolves against the initial
 * containing block instead, and `width/height: max(100%, 48px)` then means
 * 100% of the **viewport**.
 *
 * That shipped. `src/app/(auth)/layout.tsx` put `tap-target` on the wordmark
 * link with no positioning class, so a 94x32 link grew a 390x844 transparent
 * overlay across the entire sign-in page. Measured on production before the
 * fix, at two viewports:
 *
 *   linkPosition  "static"
 *   linkBox       [94, 32]      <- the visible link
 *   afterWidth    "390px"       <- the hit area
 *   afterHeight   "844px"
 *   elementFromPoint(centre of input[name=email]) -> <a href="/">
 *
 * Clicking the email field navigated home, so nobody could sign in at all.
 *
 * Nothing caught it: types, lint, unit tests and the production build were all
 * clean, because a CSS containing block is not visible to any of them. The
 * invariant is cheap to assert statically, so it is asserted here rather than
 * relying on someone re-reading the comment in `globals.css`.
 */

const SRC = join(process.cwd(), "src");
const POSITIONED = /\b(relative|absolute|fixed|sticky)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(entry) ? [path] : [];
  });
}

/**
 * Every quoted string that mentions the utility. Co-location in one literal is
 * the part that can actually be checked: a positioning class contributed by a
 * different `cn()` argument would work at runtime but cannot be verified here,
 * so the rule is that they travel together.
 */
function tapTargetClassStrings(source: string): string[] {
  return [...source.matchAll(/["'`]([^"'`\n]*\btap-target\b[^"'`\n]*)["'`]/g)].map(
    (m) => m[1],
  );
}

describe("tap-target callers establish their own containing block", () => {
  const files = sourceFiles(SRC);

  it("finds the utility in use, so the scan is not vacuously passing", () => {
    const total = files.reduce(
      (n, f) => n + tapTargetClassStrings(readFileSync(f, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("never applies tap-target to a statically positioned element", () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const classes of tapTargetClassStrings(readFileSync(file, "utf8"))) {
        if (!POSITIONED.test(classes)) {
          offenders.push(`${file.replace(`${process.cwd()}/`, "")}: "${classes}"`);
        }
      }
    }

    // A failure here means that element's 48px hit area escapes to the whole
    // viewport and starts stealing clicks from every control on the page.
    expect(offenders).toEqual([]);
  });

  it("still rejects a statically positioned caller", () => {
    // Guards the matcher itself: without this, loosening POSITIONED or the
    // extraction regex would make the test above pass unconditionally.
    const bad = tapTargetClassStrings('className="tap-target rounded-lg text-text"');
    expect(bad).toHaveLength(1);
    expect(POSITIONED.test(bad[0])).toBe(false);

    const good = tapTargetClassStrings('className="tap-target relative rounded-lg"');
    expect(POSITIONED.test(good[0])).toBe(true);
  });
});
