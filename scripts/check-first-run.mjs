/**
 * The first-run journey: sign in, and get to work.
 *
 * Every other gate in this repo fabricates the state it needs. That is correct
 * for testing one screen, and it is exactly why none of them can answer the
 * only question that matters before a demo: if I log in right now, can I
 * actually start?
 *
 * So this script touches the database only to undo a previous run. Everything
 * else is done the way a guard would do it, through the interface, and each
 * step asserts the *next action is findable* rather than merely that the route
 * exists. A page that renders but offers no way forward is a dead end, and a
 * 200 will never tell you that.
 */
import { rm, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import "dotenv/config";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUTBOX = path.resolve(".data/outbox");
const GUARD_EMAIL = "guard.night@meridian.test";
const PIN = "4821";

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

async function latestMagicLink() {
  const files = await readdir(OUTBOX).catch(() => []);
  const json = files.filter((f) => f.endsWith(".json")).sort();
  if (json.length === 0) return null;
  const body = JSON.parse(await readFile(path.join(OUTBOX, json.at(-1)), "utf8"));
  const match = (body.text ?? body.html ?? "").match(
    /https?:\/\/[^\s"<]+api\/auth\/callback[^\s"<]*/,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

/**
 * Put the guard back to "has not worked tonight".
 *
 * The only database write in this file, and it exists so the run is repeatable
 * rather than passing once and then failing on "you already have a shift open".
 */
async function resetGuard() {
  const { rows } = await sql.query('SELECT id FROM "User" WHERE email = $1', [
    GUARD_EMAIL,
  ]);
  if (rows.length === 0) throw new Error(`seed missing: ${GUARD_EMAIL}`);
  const guardId = rows[0].id;
  // Including the `chk%` shifts other gates fabricate. This script exists to
  // answer "can a guard start tonight", and a leftover active shift from a
  // sibling gate answers a different question entirely.
  await sql.query('DELETE FROM "Shift" WHERE "guardId" = $1', [guardId]);
  return guardId;
}

async function main() {
  await sql.connect();
  await resetGuard();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  // Fail fast. A gate that hangs tells you nothing and blocks the run.
  page.setDefaultTimeout(12_000);

  const consoleErrors = [];
  // Next aborts its own RSC prefetches on navigation, and Playwright reports
  // an abort through the same event as a real failure. Counting those as
  // defects would make this gate permanently red for no reason, so only
  // genuine transport failures and >=400 responses count.
  const failedRequests = [];
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (why.includes("ERR_ABORTED")) return;
    failedRequests.push(`${why} ${r.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  // --- 1. sign in, exactly as a guard would --------------------------------
  await rm(OUTBOX, { recursive: true, force: true });
  await sql.query('UPDATE "User" SET "pinHash" = NULL WHERE email = $1', [GUARD_EMAIL]);

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  check("sign-in page reachable with no session", page.url().includes("/sign-in"));

  await page.fill('input[name="email"]', GUARD_EMAIL);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);
  const sentCopy = await page.locator("body").innerText();
  check(
    "sign-in says where to look for the link",
    /email|inbox|sent|check/i.test(sentCopy),
    sentCopy.slice(0, 80).replace(/\s+/g, " "),
  );

  const link = await latestMagicLink();
  check("a magic link was actually produced", Boolean(link));
  if (!link) throw new Error("cannot continue without a magic link");

  await page.goto(link, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });

  // --- 2. the PIN gate ------------------------------------------------------
  const atPin = page.url().includes("/pin");
  check("first sign-in asks the guard to set a PIN", atPin, page.url());
  if (atPin) {
    await page.fill('input[name="pin"]', PIN);
    await page.fill('input[name="confirm"]', PIN);
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ]);
  }
  check("PIN accepted and lands on the dashboard", page.url().includes("/dashboard"));

  // --- 3. the dashboard has to offer a way to begin -------------------------
  const dash = await page.locator("main").innerText();
  check(
    "dashboard greets the signed-in guard",
    dash.trim().length > 40,
    `${dash.trim().slice(0, 70).replace(/\s+/g, " ")}…`,
  );

  // The real question. Not "does a route exist" but "is there something to
  // press". A dashboard that renders a heading and no next step is exactly
  // the dead end a 200 cannot see.
  const startables = page.locator(
    'a[href*="/start"], a[href*="/shift"], button:has-text("Start"), a:has-text("Start")',
  );
  const startCount = await startables.count();
  check(
    "dashboard offers a way to start a shift",
    startCount > 0,
    `${startCount} found`,
  );

  if (startCount === 0) {
    console.log("\nSTOPPED: nothing on the dashboard leads to a shift.");
    console.log(`dashboard text was:\n${dash}`);
  } else {
    const href = await startables.first().getAttribute("href");
    await Promise.all([
      page.waitForURL((u) => !u.toString().endsWith("/dashboard"), { timeout: 20_000 }),
      startables.first().click(),
    ]).catch(() => {});
    check(
      "that control actually goes somewhere",
      !page.url().includes("/dashboard"),
      `${href} -> ${page.url().replace(BASE, "")}`,
    );

    // --- 4. clock in ---------------------------------------------------------
    const startBody = await page.locator("main").innerText();
    check(
      "the start screen says which site and shift",
      startBody.trim().length > 40,
      `${startBody.trim().slice(0, 70).replace(/\s+/g, " ")}…`,
    );

    const clockIn = page.locator(
      'button:has-text("Clock in"), button:has-text("Start shift"), button[type="submit"]',
    );
    const canClockIn = (await clockIn.count()) > 0;
    check("the start screen has a clock-in control", canClockIn);

    if (canClockIn) {
      await clockIn.first().click();
      await page.waitForLoadState("networkidle");

      // The clock-in flow is a wizard that finishes in place rather than
      // navigating, so the thing that matters is not the URL: it is whether
      // the screen hands the guard a next step or leaves them on a summary
      // with nowhere to go. Follow whatever it offers.
      const onward = page.locator(
        'button:has-text("Go to timeline"), a:has-text("Go to timeline")',
      );
      const hasOnward = (await onward.count()) > 0;
      check(
        "the finished clock-in hands off to the live shift",
        hasOnward,
        hasOnward
          ? "Go to timeline"
          : (await page.locator("main").innerText()).slice(0, 80),
      );
      if (hasOnward) {
        await Promise.all([
          page.waitForURL(/\/shift\/[^/]+$/, { timeout: 20_000 }).catch(() => {}),
          onward.first().click(),
        ]);
        await page.waitForLoadState("networkidle");
      }
      check(
        "that hand-off actually reaches the live shift",
        /\/shift\/[^/]+$/.test(page.url()),
        page.url().replace(BASE, ""),
      );

      // --- 5. log something ---------------------------------------------------
      // Read the real control, not the page text. The log bar is a fixed
      // element outside <main>, so an innerText check on <main> reports "no
      // way to log" while the buttons are sitting on screen.
      const logBar = page.locator('nav[aria-label="Log an entry"]');
      const logButtons = logBar.locator("button");
      const buttonCount = await logButtons.count();
      check(
        "the live shift screen offers somewhere to log",
        buttonCount > 0,
        `${buttonCount} controls`,
      );

      if (buttonCount > 0) {
        // Actually log one. A button existing is not evidence that logging
        // works; the entry landing on the timeline is.
        const words = `first run check ${Date.now()}`;
        try {
          await logBar.locator('button:has-text("Note")').first().click();
          const box = page.locator("textarea, [contenteditable='true']").first();
          await box.waitFor({ state: "visible", timeout: 10_000 });
          await box.fill(words);
          await page
            .locator('button:has-text("Save"), button:has-text("Add note")')
            .first()
            .click();
          await page.waitForTimeout(2500);
          const shown = await page.locator("main").innerText();
          check(
            "a note the guard types lands on the timeline",
            shown.includes(words),
            words,
          );

          // And survives a reload, which is what separates "rendered
          // optimistically" from "written down".
          // networkidle never settles here, so wait for the document, then the entry.
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.locator("main").first().waitFor({ state: "visible" });
          const afterReload = await page.locator("main").innerText();
          check("that note is still there after a reload", afterReload.includes(words));

          // Tapping an entry is the whole point of the timeline. This is how the
          // missing /shift/[id]/entry/[entryId] route was found.
          await page.locator(`a:has-text("${words}")`).first().click();
          await page.waitForURL(/\/entry\//, { timeout: 12_000 }).catch(() => {});
          // The guard owns this entry, so the detail view opens it for editing.
          // That means the text lives in a textarea's value, which innerText
          // does not see — read the control, not the page.
          const detailText = await page.locator("main").innerText();
          const fieldValues = await page
            .locator("textarea")
            .evaluateAll((els) => els.map((el) => el.value).join("\n"))
            .catch(() => "");
          check(
            "tapping that entry opens it rather than 404ing",
            /\/entry\//.test(page.url()) &&
              (detailText.includes(words) || fieldValues.includes(words)),
            page.url().replace(BASE, "").slice(0, 60),
          );
          check(
            "the entry detail can be edited and says where it came from",
            (await page.locator("textarea").count()) > 0 &&
              /back to timeline/i.test(detailText),
          );
        } catch (err) {
          check(
            "a note the guard types lands on the timeline",
            false,
            String(err).split("\n")[0].slice(0, 120),
          );
          await page.screenshot({ path: "/tmp/first-run-note.png", fullPage: true });
        }
      }
    }
  }

  check(
    "no console errors during the whole journey",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(" | "),
  );
  check(
    "nothing the app asked for 404s",
    failedRequests.length === 0,
    [...new Set(failedRequests)].slice(0, 4).join(" | "),
  );

  await ctx.close();
  await browser.close();
  await sql.end();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exitCode = 1;
});
