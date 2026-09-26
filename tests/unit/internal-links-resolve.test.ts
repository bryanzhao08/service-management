import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every internal `<Link href="/...">` must resolve to a route that exists.
 *
 * The dashboard's "Recent reports" card linked each row to
 * `/reports/${report.id}`. There is a `src/app/reports/page.tsx`, so the path
 * looked plausible, but there has never been a `[id]` segment under it, so
 * every one of those rows was a 404 for every role including the owner.
 *
 * It was invisible for two reasons. Next prefetches `Link` targets, so it
 * failed on hover rather than on click -- the only symptom was an anonymous
 * `Failed to load resource: 404` in the console, on a page that renders fine.
 * And nothing else can see it: a dead internal link is valid TSX, valid types,
 * valid lint, and builds cleanly, because the href is just a string until the
 * router is asked for it.
 *
 * So the route table is rebuilt from disk here and every static href is
 * checked against it.
 */

const APP = join(process.cwd(), "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Turn the App Router tree into matchable patterns. Route groups `(auth)` and
 * private folders `_lib` contribute no URL segment; `[id]` matches one segment
 * and `[...slug]` matches the rest.
 */
function routePatterns(): string[] {
  const pages = walk(APP).filter((f) => /[/\\](page|route)\.tsx?$/.test(f));
  return pages.map((f) => {
    const segments = relative(APP, f)
      .split(/[/\\]/)
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("_"));
    return "/" + segments.join("/");
  });
}

function matches(href: string, pattern: string): boolean {
  const h = href.split("/").filter(Boolean);
  const p = pattern.split("/").filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    if (/^\[\.\.\..+\]$/.test(p[i])) return h.length >= i;
    if (i >= h.length) return false;
    if (/^\[.+\]$/.test(p[i])) continue;
    if (p[i] !== h[i]) return false;
  }
  return h.length === p.length;
}

/**
 * Static prefix of a Link href. A template literal's interpolations become a
 * placeholder segment, which is exactly what a dynamic route matches, so
 * `/reports/${id}` is checked as `/reports/:x` and correctly fails against a
 * tree with no `[id]`.
 */
function hrefsIn(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    // `[^>]` already spans newlines, so no dotAll flag is needed.
    /<Link\b[^>]*?\bhref=\{`([^`]*)`\}/g,
    /<Link\b[^>]*?\bhref="(\/[^"]*)"/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const raw = m[1];
      if (!raw.startsWith("/")) continue;
      found.push(
        raw
          .split("?")[0]
          .split("#")[0]
          .replace(/\$\{[^}]*\}/g, "x"),
      );
    }
  }
  return found;
}

const sources = walk(join(process.cwd(), "src"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ file: relative(process.cwd(), f), text: readFileSync(f, "utf8") }));

const PATTERNS = routePatterns();

describe("internal links resolve to real routes", () => {
  it("found the route tree and some links to check", () => {
    // Without this, an empty scan would pass silently and prove nothing.
    expect(PATTERNS.length).toBeGreaterThan(5);
    expect(sources.flatMap((s) => hrefsIn(s.text)).length).toBeGreaterThan(5);
  });

  it("has no Link pointing at a route that does not exist", () => {
    const dead: string[] = [];
    for (const { file, text } of sources) {
      for (const href of hrefsIn(text)) {
        if (!PATTERNS.some((p) => matches(href, p))) dead.push(`${file} -> ${href}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("the matcher rejects a path the tree cannot serve", () => {
    // Self-guard: proves the check above is capable of failing.
    expect(PATTERNS.some((p) => matches("/reports/x", p))).toBe(false);
    expect(PATTERNS.some((p) => matches("/dashboard", p))).toBe(true);
  });
});
