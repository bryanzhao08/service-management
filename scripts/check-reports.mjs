/**
 * Milestone 11 gate: reports history, settings, the personal export and the
 * audit log, in a real browser against a real server.
 *
 * What only a browser can answer here:
 *
 *   - `/reports` filters are URL-driven and round-trip through the server.
 *     A unit test proves `buildWhere` composes; it cannot prove the select
 *     writes the right query string or that the server reads it back.
 *   - the CSV download is a real response with real headers. `csvDocument`
 *     is pure and well tested; whether the route sets `attachment` and
 *     whether the browser gets bytes is a different question.
 *   - `/audit` is admin-only. The permission check is one function, but the
 *     thing that matters is whether a guard hitting the URL is refused, and
 *     that is a routing fact.
 *   - the nav. `/settings` shipped in milestone 10 with no link to it
 *     anywhere in the app, reachable only by typing the URL. Nothing but a
 *     rendered page catches that.
 *   - the marketing pages still mount no app chrome. `AppChrome` became an
 *     async server component this milestone, and it is mounted by every
 *     signed-in layout.
 *
 * Positive assertions that could pass vacuously are paired with a control.
 * Run against a started production server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-reports.mjs
 */
import "dotenv/config";

import { chromium } from "playwright";
import pg from "pg";

import { requireMatchingAuthOrigin, signIn } from "./support/session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3210";
requireMatchingAuthOrigin(BASE);

const OWNER_EMAIL = "owner@meridian.test";
const GUARD_EMAIL = "guard.night@meridian.test";

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

/**
 * This gate owns its preconditions.
 *
 * It needs at least one report to exist and at least one audit event to have
 * been written, and it must not care whether an earlier gate happened to
 * leave either behind. Seeding through SQL rather than by driving the UI
 * keeps the gate about the screens under test.
 */
async function ensureReportAndAudit() {
  const { rows: existing } = await sql.query(`SELECT id FROM "Report" LIMIT 1`);
  let reportId = existing[0]?.id ?? null;

  if (!reportId) {
    const { rows: shifts } = await sql.query(
      `SELECT s.id, s."guardId" FROM "Shift" s
         JOIN "Site" si ON si.id = s."siteId"
        WHERE si."loggingMode" = 'FULL'
        ORDER BY s."scheduledStart" DESC LIMIT 1`,
    );
    const shift = shifts[0];
    if (!shift) return null;

    const { rows: made } = await sql.query(
      `INSERT INTO "Report" (id, "shiftId", version, status, "generatedById",
                             pages, bytes, "generatedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 99, 'SENT', $2, 3, 120000,
               (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'),
               (now() AT TIME ZONE 'UTC'))
       RETURNING id`,
      [shift.id, shift.guardId],
    );
    reportId = made[0].id;
  }

  const { rows: company } = await sql.query(
    `SELECT id FROM "Company" WHERE slug = 'meridian' LIMIT 1`,
  );
  const companyId = company[0]?.id;
  const { rows: owner } = await sql.query(`SELECT id FROM "User" WHERE email = $1`, [
    OWNER_EMAIL,
  ]);

  await sql.query(
    `INSERT INTO "AuditEvent" (id, "companyId", "actorId", action, "entityType",
                               "entityId", metadata, at)
     VALUES (gen_random_uuid()::text, $1, $2, 'entry.delete', 'Entry',
             'gate-entry', $3::jsonb, (now() AT TIME ZONE 'UTC'))`,
    [companyId, owner[0].id, JSON.stringify({ reason: "gate fixture" })],
  );

  return reportId;
}

async function main() {
  await sql.connect();
  const reportId = await ensureReportAndAudit();
  check("precondition: a report exists", reportId !== null);

  const browser = await chromium.launch();

  // ---------------------------------------------------------------- owner
  {
    const { ctx, page } = await signIn(browser, OWNER_EMAIL, { base: BASE, sql });

    // --- the nav, which is the reason /settings was unreachable ---------
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    const navHrefs = await page.$$eval("nav a", (links) =>
      links.map((a) => a.getAttribute("href")),
    );
    check("nav links to /reports", navHrefs.includes("/reports"), navHrefs.join(" "));
    check("nav links to /settings", navHrefs.includes("/settings"));
    check("nav links to /audit for an owner", navHrefs.includes("/audit"));

    // --- reports history -------------------------------------------------
    await page.goto(`${BASE}/reports`, { waitUntil: "domcontentloaded" });
    check("reports page renders", (await page.$("[data-reports-page]")) !== null);

    const totalAttr = await page.getAttribute(
      "[data-reports-total]",
      "data-reports-total",
    );
    const total = Number(totalAttr ?? "0");
    check("reports page shows at least one report", total > 0, `total=${total}`);

    const rowLinks = await page.$$("[data-report-link]");
    check("a report row links somewhere", rowLinks.length > 0);

    // A filter that must match nothing. If the filter were ignored, this
    // would return the same total as above and the positive assertion
    // beneath it would be meaningless.
    await page.goto(`${BASE}/reports?from=2099-01-01`, {
      waitUntil: "domcontentloaded",
    });
    const futureTotal = Number(
      (await page.getAttribute("[data-reports-total]", "data-reports-total")) ?? "-1",
    );
    check(
      "CONTROL: an impossible date range returns nothing",
      futureTotal === 0,
      `total=${futureTotal}`,
    );

    // And a filter that must match everything it did before.
    await page.goto(`${BASE}/reports?delivery=any`, { waitUntil: "domcontentloaded" });
    const anyTotal = Number(
      (await page.getAttribute("[data-reports-total]", "data-reports-total")) ?? "-1",
    );
    check(
      "delivery=any is not a filter",
      anyTotal === total,
      `any=${anyTotal} unfiltered=${total}`,
    );

    // --- the reports CSV -------------------------------------------------
    const csv = await ctx.request.get(`${BASE}/api/reports/export`);
    check("reports CSV responds 200", csv.status() === 200, String(csv.status()));
    check(
      "reports CSV is an attachment",
      (csv.headers()["content-disposition"] ?? "").includes("attachment"),
      csv.headers()["content-disposition"] ?? "(none)",
    );
    const csvBody = await csv.text();
    check(
      "reports CSV has a header row",
      csvBody.startsWith("Generated,Site,"),
      csvBody.slice(0, 40),
    );
    check("reports CSV has a body row", csvBody.trimEnd().split("\r\n").length > 1);

    // --- the audit log ---------------------------------------------------
    await page.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
    check(
      "audit page renders for an owner",
      (await page.$("[data-audit-page]")) !== null,
    );
    const auditTotal = Number(
      (await page.getAttribute("[data-audit-total]", "data-audit-total")) ?? "0",
    );
    check("audit log has events", auditTotal > 0, `total=${auditTotal}`);
    check(
      "the deletion we seeded is visible",
      (await page.$('[data-audit-action="entry.delete"]')) !== null,
    );

    await page.goto(`${BASE}/audit?action=report.generate&from=2099-01-01`, {
      waitUntil: "domcontentloaded",
    });
    const auditFuture = Number(
      (await page.getAttribute("[data-audit-total]", "data-audit-total")) ?? "-1",
    );
    check(
      "CONTROL: an impossible audit filter returns nothing",
      auditFuture === 0,
      `total=${auditFuture}`,
    );

    // --- settings --------------------------------------------------------
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    check("settings renders", (await page.$("[data-settings-page]")) !== null);
    check(
      "settings offers a theme control",
      (await page.$("[data-theme-option]")) !== null,
    );
    check("settings offers larger text", (await page.$("[data-large-text]")) !== null);
    check(
      "settings offers a dictation language",
      (await page.$("[data-dictation-language]")) !== null,
    );
    check("settings offers a PIN change", (await page.$("[data-change-pin]")) !== null);
    check(
      "settings offers a JSON export",
      (await page.$("[data-export-json]")) !== null,
    );
    check(
      "settings offers a CSV export",
      (await page.$("[data-export-my-csv]")) !== null,
    );
    check("settings offers sign out", (await page.$("[data-sign-out]")) !== null);

    // Theme actually applies to <html>, not just to the button state. The
    // preference is only worth anything if the document changes.
    await page.click('[data-theme-option="light"]');
    await page.waitForFunction(() =>
      document.documentElement.classList.contains("theme-light"),
    );
    check("choosing light theme changes the document", true);

    await page.reload({ waitUntil: "domcontentloaded" });
    const persisted = await page.evaluate(() =>
      document.documentElement.classList.contains("theme-light"),
    );
    check("the theme survives a reload", persisted);

    // Put it back so the next gate starts from the seeded default.
    await page.click('[data-theme-option="dark"]');
    await page.waitForFunction(() =>
      document.documentElement.classList.contains("theme-dark"),
    );

    // --- the personal export --------------------------------------------
    const json = await ctx.request.get(`${BASE}/api/me/export?format=json`);
    check("personal JSON export responds 200", json.status() === 200);
    const payload = JSON.parse(await json.text());
    check(
      "export names who it belongs to",
      payload.user?.email === OWNER_EMAIL,
      payload.user?.email ?? "(none)",
    );
    check(
      "export states whether it was truncated",
      typeof payload.truncated === "boolean",
    );
    check("export carries an entry array", Array.isArray(payload.entries));

    const mine = await ctx.request.get(`${BASE}/api/me/export?format=csv`);
    check("personal CSV export responds 200", mine.status() === 200);
    check(
      "personal CSV is an attachment",
      (mine.headers()["content-disposition"] ?? "").includes("attachment"),
    );

    const bad = await ctx.request.get(`${BASE}/api/me/export?format=xlsx`);
    check(
      "CONTROL: an unknown export format is refused",
      bad.status() === 400,
      String(bad.status()),
    );

    await ctx.close();
  }

  // ---------------------------------------------------------------- guard
  {
    const { ctx, page } = await signIn(browser, GUARD_EMAIL, { base: BASE, sql });

    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    const guardNav = await page.$$eval("nav a", (links) =>
      links.map((a) => a.getAttribute("href")),
    );
    check(
      "a guard sees no audit link",
      !guardNav.includes("/audit"),
      guardNav.join(" "),
    );
    check("a guard still sees settings", guardNav.includes("/settings"));

    const audit = await ctx.request.get(`${BASE}/audit`);
    check(
      "a guard typing /audit is refused",
      audit.status() === 404,
      String(audit.status()),
    );

    // The export is the guard's own data, so it must work for them. A
    // permission check that refused everyone would pass the line above.
    const own = await ctx.request.get(`${BASE}/api/me/export?format=json`);
    check("a guard can export their own entries", own.status() === 200);
    const ownPayload = JSON.parse(await own.text());
    check(
      "and the export is theirs, not the owner's",
      ownPayload.user?.email === GUARD_EMAIL,
      ownPayload.user?.email ?? "(none)",
    );

    // The reports CSV is supervisor-and-up. A guard must be refused there,
    // which is the counterpart to being allowed their own export above.
    const guardCsv = await ctx.request.get(`${BASE}/api/reports/export`);
    check(
      "a guard cannot export the company's reports",
      guardCsv.status() === 403,
      String(guardCsv.status()),
    );

    await ctx.close();
  }

  // ------------------------------------------------------------ marketing
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded" });
    check(
      "CONTROL: /pricing mounts no app nav",
      (await page.$("nav a[href='/settings']")) === null,
    );
    check(
      "and /pricing still renders its plans",
      (await page.$("[data-plan]")) !== null,
    );
    await ctx.close();
  }

  await browser.close();
  await sql.end();

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
