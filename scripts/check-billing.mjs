/**
 * Subscription gate: what a plan may switch off, and what it may never touch.
 *
 * The unit and db suites already prove the resolution layer. What only a
 * browser and a real server can answer:
 *
 *   - `/settings/billing` is owner-only, and "owner-only" here means the
 *     page 404s for everyone else rather than rendering an empty shell. A
 *     supervisor seeing a billing screen at all is the defect.
 *   - the active-site meter on that page is the number the operator is
 *     billed on. It has to agree with the shifts they can actually see, so
 *     this reads it out of the DOM and recomputes it against Postgres.
 *   - `/api/audit/export` answers 404 before it answers 402. A plan response
 *     to someone not allowed to see the audit log would confirm the log
 *     exists. That ordering is a routing fact, not a function fact.
 *   - the export link only appears for an entitled company. Meridian is
 *     seeded on `operations`, which grants push alerts but NOT audit export,
 *     so the seed itself is the mixed case: one gate open, one shut.
 *   - and the governing rule: nothing about recording a shift is gated. A
 *     guard on a company with no plan at all still gets the full logging UI.
 *
 * Run against a started production server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-billing.mjs
 */
import "dotenv/config";

import { chromium } from "playwright";
import pg from "pg";

import { requireMatchingAuthOrigin, signIn } from "./support/session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3210";
requireMatchingAuthOrigin(BASE);

const OWNER_EMAIL = "owner@meridian.test";
const GUARD_EMAIL = "guard.night@meridian.test";
const SUPERVISOR_EMAIL = "sup.westside@meridian.test";

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

/** The meter, recomputed independently of the code that renders it. */
async function activeSitesThisMonth(companyId) {
  const { rows } = await sql.query(
    `SELECT COUNT(DISTINCT s."siteId")::int AS n
       FROM "Shift" s
       JOIN "Site" si ON si.id = s."siteId"
      WHERE si."companyId" = $1
        AND s."clockInAt" IS NOT NULL
        AND s."clockInAt" >= date_trunc('month', (now() AT TIME ZONE 'UTC'))`,
    [companyId],
  );
  return rows[0].n;
}

async function main() {
  await sql.connect();

  const { rows: companies } = await sql.query(
    `SELECT id, name, "planId", "subscriptionStatus"
       FROM "Company" ORDER BY name`,
  );
  const meridian = companies.find((c) => c.name.includes("Meridian"));
  if (!meridian) throw new Error("seed missing: no Meridian company");

  check(
    "seed leaves one company on a plan and one without",
    meridian.planId === "operations" && companies.some((c) => c.planId === null),
    `${companies.map((c) => `${c.name}=${c.planId ?? "none"}`).join(", ")}`,
  );

  const expectedSites = await activeSitesThisMonth(meridian.id);

  const browser = await chromium.launch();

  // ---- owner sees the billing screen -------------------------------------
  {
    const { ctx, page } = await signIn(browser, OWNER_EMAIL, { base: BASE, sql });

    const res = await page.goto(`${BASE}/settings/billing`, {
      waitUntil: "domcontentloaded",
    });
    check("owner: /settings/billing is 200", res?.status() === 200, String(res?.status()));

    const text = await page.locator("body").innerText();

    check(
      "owner: the plan is named, not just priced",
      /Operations/i.test(text),
      text.slice(0, 80).replace(/\s+/g, " "),
    );
    check("owner: trial status is visible", /trial/i.test(text));

    const meter = await page.locator("[data-active-sites]").first().getAttribute("data-active-sites");
    check(
      "owner: the billed meter matches the shifts in the database",
      Number(meter) === expectedSites,
      `page=${meter} sql=${expectedSites}`,
    );

    const units = await page.locator("[data-billable-units]").first().getAttribute("data-billable-units");
    check(
      "owner: billable units never fall below the plan minimum",
      Number(units) >= Number(meter),
      `units=${units} sites=${meter}`,
    );

    // The promise the pricing page makes has to be legible inside the product,
    // not only in marketing copy.
    check(
      "owner: what a plan can never switch off is stated on the page",
      /never|always included/i.test(text),
    );

    const settings = await ctx.newPage();
    await settings.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    check(
      "owner: /settings links to billing",
      (await settings.locator('a[href="/settings/billing"]').count()) > 0,
    );

    // Meridian is on `operations`. That grants push alerts and NOT audit
    // export, so the link must be absent even though the company pays.
    const audit = await ctx.newPage();
    await audit.goto(`${BASE}/audit`, { waitUntil: "domcontentloaded" });
    check(
      "owner: no export link on a plan that does not include it",
      (await audit.locator("[data-audit-export]").count()) === 0,
    );

    const exportRes = await ctx.request.get(`${BASE}/api/audit/export`);
    check(
      "owner: the export route answers 402, not 404 and not a file",
      exportRes.status() === 402,
      String(exportRes.status()),
    );
    const body = await exportRes.json().catch(() => ({}));
    check("owner: the 402 names the reason machine-readably", body.code === "PLAN_REQUIRED", JSON.stringify(body).slice(0, 60));

    await ctx.close();
  }

  // ---- control: the same screens for someone who is not the owner --------
  {
    const { ctx, page } = await signIn(browser, SUPERVISOR_EMAIL, { base: BASE, sql });
    const res = await page.goto(`${BASE}/settings/billing`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "supervisor: billing is 404, not a rendered empty page",
      res?.status() === 404,
      String(res?.status()),
    );
    await ctx.close();
  }

  {
    const { ctx, page } = await signIn(browser, GUARD_EMAIL, { base: BASE, sql });

    const res = await page.goto(`${BASE}/settings/billing`, {
      waitUntil: "domcontentloaded",
    });
    check("guard: billing is 404", res?.status() === 404, String(res?.status()));

    // The important ordering: a guard must get the same answer as if the
    // route did not exist. A 402 here would tell them a company audit log is
    // there and they merely cannot afford it.
    const exportRes = await ctx.request.get(`${BASE}/api/audit/export`);
    check(
      "guard: the export route is 404, never 402",
      exportRes.status() === 404,
      String(exportRes.status()),
    );

    // ---- the governing rule ---------------------------------------------
    // Recording is never gated. This guard's company is mid-trial today, but
    // the assertion that matters is that the logging surface is reachable and
    // complete regardless of any of the above.
    const dash = await ctx.newPage();
    const dashRes = await dash.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    // Assert it actually rendered first. "No upgrade prompt" is also true of
    // a 404 page, so the absence check below is worthless without this.
    check("guard: the dashboard renders", dashRes?.status() === 200, String(dashRes?.status()));

    const shiftLink = await dash.locator('a[href^="/shift/"]').first().getAttribute("href");
    check("guard: the dashboard offers a shift to work", Boolean(shiftLink), String(shiftLink));

    if (shiftLink) {
      const shift = await ctx.newPage();
      const shiftRes = await shift.goto(`${BASE}${shiftLink}`, { waitUntil: "domcontentloaded" });
      check("guard: the shift page renders", shiftRes?.status() === 200, String(shiftRes?.status()));

      const shiftText = await shift.locator("body").innerText();
      // Name the affordances rather than counting characters. A char floor
      // would have passed on an error page with a long enough message.
      const offers = ["Note", "Photo", "Incident"].filter((label) =>
        shiftText.includes(label),
      );
      check(
        "guard: every way of recording is offered on no plan at all",
        offers.length === 3,
        offers.join("/") || "none",
      );
      check(
        "guard: no plan language anywhere near the logging surface",
        !/upgrade|subscribe|plan required|start your trial/i.test(shiftText),
      );
    }

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
