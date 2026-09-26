/**
 * Gate: the site recipients screen.
 *
 * Run against a started server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-recipients.mjs
 *
 * The dashboard tells a supervisor an address bounced and links to
 * `/sites/<id>/recipients`. That link 404'd from milestone 7 to 12 because the
 * page was never built, and nothing caught it: every test asserted the
 * dashboard *rendered*, not that its links resolved.
 *
 * So the first check reads the href out of the live dashboard and follows it.
 * Three controls sit beside it, each isolating one claim the page makes about
 * who may open it.
 */
import "dotenv/config";
import { chromium } from "playwright";
import pg from "pg";

import { requireMatchingAuthOrigin, signIn } from "./support/session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3210";
const SUPERVISOR = "sup.westside@meridian.test";
const GUARD = "guard.night@meridian.test";

requireMatchingAuthOrigin(BASE);

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ->  ${actual} (want ${expected})`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
await sql.connect();

// A throwaway company and site, so "another company's site is a 404" is tested
// against a row that really exists. A made-up id would 404 for the wrong
// reason and prove nothing about scoping.
await sql.query(
  `INSERT INTO "Company" (id, name, slug, "createdAt", "updatedAt")
   VALUES ('gate-foreign-co', 'Gate Control Security', 'gate-control-security', now(), now())
   ON CONFLICT (id) DO NOTHING`,
);
await sql.query(
  `INSERT INTO "Site" (id, "companyId", code, name, address, timezone, "loggingMode", "createdAt", "updatedAt")
   VALUES ('gate-foreign-site', 'gate-foreign-co', 'GATE', 'Gate Control Tower',
           '1 Control Way', 'America/Los_Angeles', 'FULL', now(), now())
   ON CONFLICT (id) DO NOTHING`,
);

const browser = await chromium.launch();

try {
  const { ctx: supCtx, page: sup } = await signIn(browser, SUPERVISOR, {
    base: BASE,
    sql,
  });

  // The href the dashboard actually renders. This is the assertion that would
  // have caught the original dead link.
  const href = await sup.evaluate(() => {
    const a = [...document.querySelectorAll("a[href]")].find((el) =>
      /^\/sites\/[^/]+\/recipients$/.test(el.getAttribute("href") ?? ""),
    );
    return a?.getAttribute("href") ?? null;
  });

  const { rows: assigned } = await sql.query(
    `SELECT s.id FROM "Site" s
       JOIN "SiteAssignment" a ON a."siteId" = s.id
       JOIN "User" u ON u.id = a."userId"
      WHERE u.email = $1
      ORDER BY s.code LIMIT 1`,
    [SUPERVISOR],
  );
  // The dashboard only surfaces that link when a recipient needs attention, so
  // a clean data state legitimately has none. Fall back to an assigned site
  // and print which path is being exercised, rather than passing silently on
  // a weaker check than the one advertised.
  const target = href ?? `/sites/${assigned[0]?.id}/recipients`;
  console.log(
    `target: ${target} ${href ? "(from the dashboard link)" : "(assigned site; dashboard showed no link)"}`,
  );

  check(
    "supervisor opens their own site's recipients",
    (await sup.request.get(`${BASE}${target}`)).status(),
    200,
  );

  await sup.goto(`${BASE}${target}`, { waitUntil: "domcontentloaded" });
  check(
    "the page identifies the site",
    (await sup.locator("[data-recipients-page] h1").count()) > 0,
    true,
  );
  check(
    "the recipients are listed",
    (await sup.locator("[data-recipient-list] [data-recipient]").count()) > 0,
    true,
  );
  check(
    "and a recipient can be added from here",
    await sup.locator("[data-add-recipient]").count(),
    1,
  );

  check(
    "control: another company's site is not found",
    (await sup.request.get(`${BASE}/sites/gate-foreign-site/recipients`)).status(),
    404,
  );
  check(
    "control: a site id that does not exist is not found",
    (await sup.request.get(`${BASE}/sites/nosuchsiteatall/recipients`)).status(),
    404,
  );
  await supCtx.close();

  const { ctx: guardCtx, page: guard } = await signIn(browser, GUARD, {
    base: BASE,
    sql,
  });
  check(
    "control: a guard cannot configure recipients",
    (await guard.request.get(`${BASE}${target}`)).status(),
    404,
  );
  await guardCtx.close();
} finally {
  await sql.query(`DELETE FROM "Site" WHERE id = 'gate-foreign-site'`);
  await sql.query(`DELETE FROM "Company" WHERE id = 'gate-foreign-co'`);
  await browser.close();
  await sql.end();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
