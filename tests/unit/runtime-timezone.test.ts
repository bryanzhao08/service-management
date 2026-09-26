import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { formatDateTimeArchival } from "@/lib/time";

/**
 * No wall-clock string is rendered in the runtime's timezone.
 *
 * `src/lib/time.ts` opens by saying every wall-clock string belongs to the
 * **site's** zone, "never the server's and never the browser's", because the
 * time a guard saw on their watch is the time quoted back in an insurance
 * claim. That was documented and then not enforced, so it broke exactly the
 * way the doc comment predicted.
 *
 * `reports-table.tsx` formatted with `toLocaleString(undefined, …)`. Passing
 * `undefined` as the locale means "use whatever this runtime defaults to", and
 * the two runtimes disagree: Vercel renders the page in UTC, the supervisor's
 * browser re-renders it in Pacific. Two symptoms, one cause.
 *
 * 1. The visible bug. A report from a New York site showed one time in the
 *    history list and a different time in the PDF generated from the same
 *    shift. Neither string carried a zone marker, so there was no way to tell
 *    from the screen which one was the site's.
 * 2. The silent one. The server HTML and the client render produced different
 *    text for the same node, so React threw hydration error #418 and threw
 *    that subtree away on every load of `/reports`.
 *
 * The pin below is deliberately not "the reports list now prints site time".
 * It is the invariant across the source tree, because this is a class and not
 * an instance: the next table that shows a date is one `toLocaleString` away
 * from doing it again, and the failure is invisible in review, invisible to
 * types, invisible to lint, and invisible to any test that runs in a single
 * timezone.
 */

const SRC = join(process.cwd(), "src");

/**
 * Call sites that may format without an explicit zone, and why.
 *
 * This is debt, not an exemption on principle. Both entries below render a
 * human-visible time in whatever zone the reader's machine is in, while the
 * `<time dateTime>` attribute wrapping them is a correct ISO instant — so the
 * machine-readable value is right and only the text a person reads is wrong.
 */
const ALLOWED = new Map<string, string>([
  [
    "app/settings/billing/page.tsx",
    "Formats a number, not a date. `amount.toLocaleString('en-US')` has no instant and no zone.",
  ],
  [
    "components/ui/checklist.tsx",
    "DEBT: prints `doneAt` in the reader's zone. Needs a `timeZone` prop threaded from the shift, the same way Timeline and StatusTracker already take one.",
  ],
  [
    "components/audit/audit-table.tsx",
    "DEBT: prints `row.at` in the reader's zone. Genuinely open design question — audit rows are org-wide and can span sites, so there is no single site zone to use.",
  ],
]);

/** `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`. */
const CALL = /\.toLocale(?:Date|Time)?String\s*\(/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The argument list of the call starting at `open`, by brace balance. */
function argsOf(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open);
}

type Offender = { file: string; snippet: string };

function offenders(): Offender[] {
  const found: Offender[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(SRC, file).replaceAll("\\", "/");
    for (const match of text.matchAll(CALL)) {
      const open = match.index + match[0].length - 1;
      const args = argsOf(text, open);
      if (args.includes("timeZone")) continue;
      found.push({ file: rel, snippet: args.replace(/\s+/g, " ").slice(0, 60) });
    }
  }
  return found;
}

describe("no date is formatted in the runtime's timezone", () => {
  it("every toLocale*String call passes an explicit timeZone, or is listed as debt", () => {
    const unexpected = offenders().filter((o) => !ALLOWED.has(o.file));
    expect(
      unexpected.map((o) => `${o.file}: ${o.snippet}`),
      "Format with the helpers in src/lib/time.ts and pass the site's IANA zone. " +
        "A bare `undefined` locale takes the runtime's zone, which differs between " +
        "the server and the browser — that is both a hydration mismatch and a wrong time.",
    ).toEqual([]);
  });

  it("the reports history list is fixed, not merely allowlisted", () => {
    const table = readFileSync(
      join(SRC, "components/reports/reports-table.tsx"),
      "utf8",
    );
    expect(table).not.toMatch(CALL);
    expect(table).toContain("formatDateTimeArchival(row.generatedAt, row.siteTimezone)");
  });

  it("the row carries the site's zone, so the list never has to guess", () => {
    const history = readFileSync(join(SRC, "lib/db/report-history.ts"), "utf8");
    expect(history).toContain("siteTimezone: string;");
    expect(history).toContain("select: { name: true, timezone: true }");
    expect(history).toContain("siteTimezone: report.shift.site.timezone");
  });

  it("the same instant prints a different wall clock per site zone", () => {
    // 04:52 UTC is the previous calendar day in Los Angeles and just past
    // midnight in New York. A formatter using one runtime default cannot
    // produce both of these, which is what makes this assertion load-bearing
    // rather than a restatement of date-fns.
    const instant = new Date("2026-09-26T04:52:00.000Z");
    const la = formatDateTimeArchival(instant, "America/Los_Angeles");
    const ny = formatDateTimeArchival(instant, "America/New_York");

    expect(la).toBe("Fri 25 Sep 2026, 21:52");
    expect(ny).toBe("Sat 26 Sep 2026, 00:52");
    expect(la).not.toBe(ny);
  });

  it("the scan actually reads files and can see a violation", () => {
    // Non-vacuity. If the walker silently returned nothing, every assertion
    // above would pass while enforcing nothing at all.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);

    const all = offenders();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((o) => ALLOWED.has(o.file))).toBe(true);
  });
});
