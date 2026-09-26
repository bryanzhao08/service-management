/**
 * End-to-end proof that the auth chain works against a running server:
 * unauthenticated gate -> magic link -> session -> PIN -> scoped dashboard.
 *
 * Run against a started server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-auth.mjs
 *
 * Every check here exists because the alternative is asserting that a file
 * compiles. A `NextAuthConfig` that typechecks can still fail to mint a
 * session, and a scoped query can still return another company's rows; neither
 * is visible to `tsc`.
 */
import "dotenv/config";
import { chromium } from "playwright";
import pg from "pg";
import { readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUTBOX = path.resolve(".data/outbox");
const GUARD_EMAIL = "guard.night@meridian.test";
const UNKNOWN_EMAIL = "nobody@nowhere.test";
const PIN = "4821";

const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/**
 * True only for the real /verify page. `/api/auth/verify-request` contains the
 * substring "/verify", so a naive includes() passes for the built-in Auth.js
 * URL as well — it did, and hid a real bug.
 */
function onVerifyPage(url) {
  return new URL(url).pathname === "/verify";
}

async function outboxFiles() {
  if (!existsSync(OUTBOX)) return [];
  return (await readdir(OUTBOX)).filter((f) => f.endsWith(".json"));
}

/** The newest magic-link URL the console provider wrote, or null. */
async function latestMagicLink() {
  const files = await outboxFiles();
  if (files.length === 0) return null;
  const withTimes = await Promise.all(
    files.map(async (f) => {
      const raw = JSON.parse(await readFile(path.join(OUTBOX, f), "utf8"));
      return { file: f, raw };
    }),
  );
  const last = withTimes.at(-1);
  if (!last) return null;
  const match = /https?:\/\/[^\s"'<>]*callback[^\s"'<>]*/.exec(
    `${last.raw.html ?? ""} ${last.raw.text ?? ""}`,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

async function requestLink(page, email) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);
}

/**
 * Clears the guard's PIN so the run always exercises set-then-enter, in that
 * order. Without this the second run finds the PIN left by the first and the
 * "offered to set one" check fails for a reason that has nothing to do with
 * the code — which is exactly what happened.
 */
async function resetPin() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(
    'UPDATE "User" SET "pinHash" = NULL WHERE email = $1',
    [GUARD_EMAIL],
  );

  // The site-scoping assertions below read the idle dashboard, which lists the
  // guard's assigned sites. An open shift replaces that list with the "On
  // shift" card, so a previous gate that clocked in would make a correct
  // dashboard look like a scoping failure. Owning the precondition is the fix;
  // depending on gate order is not.
  await client.query(
    `UPDATE "Shift"
        SET "clockOutAt" = (now() AT TIME ZONE 'UTC'), status = 'ENDED',
            "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "clockOutAt" IS NULL
        AND "clockInAt" IS NOT NULL
        AND "guardId" = (SELECT id FROM "User" WHERE email = $1)`,
    [GUARD_EMAIL],
  );

  await client.end();
  return res.rowCount ?? 0;
}

/**
 * The guard's assigned site names, and the names of sites they must not see.
 *
 * A cross-tenant site is created here rather than assumed, because the check
 * it feeds is a negative: if the list of foreign names is empty, "none of them
 * appear" is true for free. The gate asserts the list is non-empty for that
 * reason.
 */
async function siteNames() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(
    `INSERT INTO "Company" (id, name, slug, "createdAt", "updatedAt")
     VALUES ('auth-foreign-co', 'Rival Patrol Group', 'rival-patrol-group', now(), now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO "Site" (id, "companyId", code, name, address, timezone, "loggingMode", "createdAt", "updatedAt")
     VALUES ('auth-foreign-site', 'auth-foreign-co', 'RIV', 'Rival Distribution Center',
             '9 Rival Road', 'America/Los_Angeles', 'FULL', now(), now())
     ON CONFLICT (id) DO NOTHING`,
  );

  const { rows: mine } = await client.query(
    `SELECT s.name FROM "Site" s
       JOIN "SiteAssignment" a ON a."siteId" = s.id
       JOIN "User" u ON u.id = a."userId"
      WHERE u.email = $1`,
    [GUARD_EMAIL],
  );
  const assigned = mine.map((r) => r.name);

  const { rows: all } = await client.query(`SELECT name FROM "Site"`);
  const foreign = all.map((r) => r.name).filter((name) => !assigned.includes(name));

  await client.end();
  return { assigned, foreign };
}

/** Remove the cross-tenant row `siteNames` created. */
async function dropForeignSite() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DELETE FROM "Site" WHERE id = 'auth-foreign-site'`);
  await client.query(`DELETE FROM "Company" WHERE id = 'auth-foreign-co'`);
  await client.end();
}

const browser = await chromium.launch();

try {
  await rm(OUTBOX, { recursive: true, force: true });

  // Control: if this updates 0 rows the fixture is missing and every check
  // below would be measuring the wrong user.
  const cleared = await resetPin();
  check(
    "the seeded guard exists and their PIN was cleared",
    cleared === 1,
    `${cleared} row(s)`,
  );

  // ---- 1. The gate ---------------------------------------------------------
  {
    const res = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    check(
      "unauthenticated /dashboard redirects to sign-in",
      res.status === 307 && location.includes("/sign-in"),
      `${res.status} -> ${location}`,
    );
    check(
      "the redirect carries the destination as a relative path",
      location.includes("from=%2Fdashboard"),
      location,
    );
  }

  // Control: a public route must NOT be gated, or the check above proves only
  // that the proxy redirects everything.
  {
    const res = await fetch(`${BASE}/sign-in`, { redirect: "manual" });
    check("public /sign-in is not gated", res.status === 200, String(res.status));
  }

  // ---- 2. Non-enumerable sign-in ------------------------------------------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await requestLink(page, UNKNOWN_EMAIL);
    const url = page.url();
    const sent = await outboxFiles();
    check("an unknown address lands on the same verify page", onVerifyPage(url), url);
    check(
      "and no email is sent for it",
      sent.length === 0,
      `${sent.length} file(s) in outbox`,
    );
    await ctx.close();
  }

  // ---- 3. Magic link -> session -------------------------------------------
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await requestLink(page, GUARD_EMAIL);
  check("a known address lands on verify", onVerifyPage(page.url()), page.url());

  const files = await outboxFiles();
  check(
    "exactly one email was written to the outbox",
    files.length === 1,
    files.join(","),
  );

  const link = await latestMagicLink();
  check("the email contains a callback link", Boolean(link), link ?? "none");
  if (!link) throw new Error("no magic link to follow");

  await page.goto(link, { waitUntil: "domcontentloaded" });
  const afterLink = page.url();
  check(
    "following the link leaves the signed-out pages",
    !afterLink.includes("/sign-in") && !afterLink.includes("/verify"),
    afterLink,
  );

  const cookies = await ctx.cookies();
  check(
    "a session cookie is set",
    cookies.some((c) => /authjs\.session-token/.test(c.name)),
    cookies.map((c) => c.name).join(", "),
  );

  // ---- 4. PIN gate ---------------------------------------------------------
  {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    check(
      "a signed-in but locked device is sent to /pin",
      page.url().includes("/pin"),
      page.url(),
    );

    const heading = (await page.locator("h1").first().textContent()) ?? "";
    check(
      "a user with no PIN is offered to set one",
      /set a pin/i.test(heading),
      heading,
    );

    await page.fill('input[name="pin"]', PIN);
    await page.fill('input[name="confirm"]', PIN);
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 15_000 }),
      page.click('button[type="submit"]'),
    ]);
    check(
      "setting the PIN unlocks and lands on the dashboard",
      page.url().includes("/dashboard"),
      page.url(),
    );

    const unlock = (await ctx.cookies()).find((c) => c.name === "transient_unlock");
    check(
      "the unlock cookie is httpOnly",
      unlock?.httpOnly === true,
      JSON.stringify(unlock ?? null),
    );
  }

  // ---- 5. Scoped data actually rendered ------------------------------------
  {
    const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    check(
      "the dashboard renders the seeded guard's name",
      /Terrence Boyd/.test(body),
      body.slice(0, 160),
    );

    // Both halves of this used to be wrong in the same way: they hardcoded
    // names.
    //
    // "both of their assigned sites" only holds in one branch of the
    // dashboard. `StartUnscheduled` lists every assignment, but it renders
    // only when there is no next scheduled shift; with one scheduled, the
    // screen correctly shows that shift instead. The assertion passed for a
    // while purely because re-seeding kept moving which shifts were in the
    // future, so it was measuring the fixture, not the product.
    //
    // "no site they are not assigned to" was worse: it looked for "alpha
    // site"/"bravo site", and no such rows have ever existed. It could not
    // fail. A vacuous negative is indistinguishable from a passing one.
    //
    // Both are now derived from the database, and the negative is given a
    // real row to find.
    const { assigned, foreign } = await siteNames();
    check(
      "at least one assigned site is named on the dashboard",
      assigned.some((name) => body.includes(name)),
      `assigned=${JSON.stringify(assigned)} body=${body.slice(0, 200)}`,
    );
    check(
      "and no site outside their assignments, including a live one",
      foreign.length > 0 && !foreign.some((name) => body.includes(name)),
      `foreign=${JSON.stringify(foreign)} body=${body.slice(0, 200)}`,
    );
  }

  // ---- 6. Lock survives a fresh context ------------------------------------
  {
    const fresh = await browser.newContext();
    // Carry the session cookie but not the unlock cookie, which is what a new
    // browser session on the same phone looks like.
    const sessionCookie = (await ctx.cookies()).filter((c) =>
      /authjs\.session-token/.test(c.name),
    );
    await fresh.addCookies(sessionCookie);
    const p2 = await fresh.newPage();
    await p2.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    check(
      "a session without the unlock cookie is re-locked",
      p2.url().includes("/pin"),
      p2.url(),
    );

    const h = (await p2.locator("h1").first().textContent()) ?? "";
    check(
      "and is now asked to enter the PIN, not set one",
      /enter your pin/i.test(h),
      h,
    );

    await p2.fill('input[name="pin"]', "9999");
    await p2.click('button[type="submit"]');
    await p2.waitForTimeout(1500);
    const err =
      (await p2.locator('[role="alert"], [id$="-error"]').first().textContent()) ?? "";
    check(
      "a wrong PIN is refused with a remaining-tries message",
      /incorrect pin/i.test(err),
      err.trim(),
    );
    check("and does not reach the dashboard", p2.url().includes("/pin"), p2.url());

    // Finish with the correct PIN. Two reasons, and the second is the reason
    // this gate used to fail on its fifth run inside fifteen minutes.
    //
    // 1. It is the assertion the wrong-PIN checks above imply but never make:
    //    that the counter is forgiving. A regression that locked a guard out
    //    after a single mistyped digit would pass every other check in here.
    // 2. The attempt counter lives in a per-process Map (src/lib/auth/pin.ts),
    //    so no SQL reset can reach it, and only a SUCCESSFUL entry clears it
    //    (actions.ts calls clearPinAttempts there and in "Forgot PIN" — the
    //    set-PIN path does not). Ending on a failure therefore left count+1
    //    behind every run until MAX_PIN_ATTEMPTS locked the seeded guard out
    //    and this gate started reading "Too many attempts" instead of
    //    "Incorrect PIN". Same rule as the shift fixture in check-billing: a
    //    gate that fabricates state clears it up after itself.
    await p2.fill('input[name="pin"]', PIN);
    await Promise.all([
      p2.waitForURL(/\/dashboard/, { timeout: 15_000 }),
      p2.click('button[type="submit"]'),
    ]);
    check(
      "the correct PIN still unlocks after a failed try",
      p2.url().includes("/dashboard"),
      p2.url(),
    );

    await fresh.close();
  }

  await ctx.close();
} finally {
  await dropForeignSite();
  await browser.close();
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
