/**
 * Milestone 3 gate: section 7 requires Lighthouse >= 95 on mobile for both
 * Performance and Accessibility. This runs the real audit and exits non-zero
 * below the floor, so the number is measured rather than asserted.
 *
 * Accessibility is included even though Lighthouse's a11y audit is shallow —
 * it catches contrast, labels, and landmark mistakes automatically, and
 * check-landing.mjs covers the structural things it cannot see (heading order,
 * tap targets measured through elementFromPoint, link resolution).
 *
 * Run against a PRODUCTION server. A dev build has unminified bundles and no
 * static prerender, so its performance number means nothing:
 *   BASE=http://localhost:3210 node scripts/check-lighthouse.mjs
 */
import { chromium } from "playwright";
import lighthouse from "lighthouse";

const BASE = process.env.BASE ?? "http://localhost:3210";

/** Every public route, because a broken CTA target is still a shipped page. */
const ROUTES = ["/", "/privacy", "/terms", "/sample-report"];

const FLOOR = Number(process.env.LH_FLOOR ?? 95);
const CATEGORIES = ["performance", "accessibility"];

async function main() {
  // Playwright's bundled Chromium rather than chrome-launcher: chrome-launcher
  // is only a transitive dep of lighthouse (pnpm's strict layout makes it
  // unresolvable) AND it needs a system Chrome install. This browser is the
  // same one check-landing.mjs uses, so the two gates agree on the engine.
  const PORT = 9222;
  const browser = await chromium.launch({
    args: [`--remote-debugging-port=${PORT}`],
  });

  const rows = [];
  const failures = [];

  try {
    for (const route of ROUTES) {
      const url = new URL(route, BASE).toString();
      const result = await lighthouse(
        url,
        {
          port: PORT,
          output: "json",
          logLevel: "error",
          onlyCategories: CATEGORIES,
          // Lighthouse's mobile preset: a throttled 4G connection on a
          // mid-tier phone. The desktop preset would pass far more easily and
          // would not be the thing section 7 asks for.
          formFactor: "mobile",
          screenEmulation: {
            mobile: true,
            width: 412,
            height: 823,
            deviceScaleFactor: 1.75,
            disabled: false,
          },
        },
        undefined,
      );

      const lhr = result?.lhr;
      if (!lhr) throw new Error(`Lighthouse returned no result for ${url}`);

      const scores = {};
      for (const category of CATEGORIES) {
        const score = Math.round((lhr.categories[category].score ?? 0) * 100);
        scores[category] = score;
        if (score < FLOOR) {
          failures.push(`${route} ${category} ${score} < ${FLOOR}`);
        }
      }
      rows.push({ route, ...scores });

      // Surface the specific audits that lost points, so a failure is
      // actionable instead of just a number.
      for (const category of CATEGORIES) {
        const failed = lhr.categories[category].auditRefs
          .map((ref) => lhr.audits[ref.id])
          .filter(
            (audit) =>
              audit &&
              audit.score !== null &&
              audit.score < 1 &&
              audit.scoreDisplayMode !== "informative",
          );
        if (failed.length > 0) {
          for (const audit of failed.slice(0, 6)) {
            console.log(
              `    ${route} ${category}: ${audit.id} — ${audit.title}${
                audit.displayValue ? ` (${audit.displayValue})` : ""
              }`,
            );
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log("");
  console.log("  route            perf   a11y");
  for (const row of rows) {
    console.log(
      `  ${row.route.padEnd(16)} ${String(row.performance).padStart(4)}   ${String(
        row.accessibility,
      ).padStart(4)}`,
    );
  }
  console.log("");

  if (failures.length > 0) {
    console.log(`FAILED — floor is ${FLOOR}`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `All ${rows.length} routes >= ${FLOOR} on mobile for ${CATEGORIES.join(" and ")}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
