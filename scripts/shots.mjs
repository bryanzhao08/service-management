import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { chromium, devices } from "playwright";
import pg from "pg";

/**
 * Take the screenshots the README shows.
 *
 * These are captures of the running app against real seeded data, not mockups.
 * The point of checking them in is that a reader can see what the thing looks
 * like without installing Postgres, and that a change which wrecks a screen is
 * visible in a diff.
 *
 *   node scripts/shots.mjs
 *
 * Requires the production server on BASE and a seeded database.
 */

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = path.resolve("docs/screenshots");
const OUTBOX = path.resolve(".data/outbox");
const PIN = "4417";

async function magicLink() {
  if (!existsSync(OUTBOX)) return null;
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith(".json")).sort();
  const last = files.at(-1);
  if (!last) return null;
  const raw = JSON.parse(await readFile(path.join(OUTBOX, last), "utf8"));
  const m = /https?:\/\/[^\s"'<>]*callback[^\s"'<>]*/.exec(
    `${raw.html ?? ""} ${raw.text ?? ""}`,
  );
  return m ? m[0].replace(/&amp;/g, "&") : null;
}

async function signIn(page, sql, email) {
  await rm(OUTBOX, { recursive: true, force: true });
  await sql.query('UPDATE "User" SET "pinHash" = NULL WHERE email = $1', [email]);
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);
  const link = await magicLink();
  if (!link) throw new Error(`no magic link for ${email}`);
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/pin")) {
    await page.fill('input[name="pin"]', PIN);
    await page.fill('input[name="confirm"]', PIN);
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ]);
  }
  if (!/\/dashboard/.test(page.url())) {
    throw new Error(`sign-in for ${email} landed on ${page.url()}`);
  }
}

const shots = [];

async function shot(page, name, url, { full = false } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });

  // Images are loading="lazy", and a full-page screenshot never scrolls, so
  // anything below the fold would be captured as a broken placeholder. Walk
  // the page to trigger them, then come back to the top.
  if (full) {
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
  }
  await page.waitForTimeout(700);

  // A broken image still screenshots as a valid PNG, so the capture proves
  // nothing on its own. naturalWidth is the browser's own answer to "did the
  // bytes arrive", which is the thing actually being claimed.
  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((i) => i.currentSrc && i.complete && i.naturalWidth === 0)
      .map((i) => i.currentSrc),
  );
  if (broken.length > 0) {
    throw new Error(
      `${url} has ${broken.length} broken image(s):\n  ${broken.join("\n  ")}`,
    );
  }

  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  shots.push({ name, url });
  console.log(`  ${name}  <-  ${url}`);
}

const sql = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://transient:transient@127.0.0.1:5544/transient",
});
await sql.connect();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

try {
  // Public pages at phone width, because that is how a buyer first opens a
  // link somebody texted them.
  const buyer = await browser.newContext({ ...devices["Pixel 7"] });
  const buyerPage = await buyer.newPage();
  console.log("public (390px)");
  await shot(buyerPage, "landing", "/", { full: true });
  await shot(buyerPage, "pricing", "/pricing", { full: true });
  await buyer.close();

  // The guard's night, on the guard's phone.
  const guard = await browser.newContext({ ...devices["Pixel 7"] });
  const guardPage = await guard.newPage();
  await signIn(guardPage, sql, "guard.night@meridian.test");
  console.log("guard (390px)");
  await shot(guardPage, "dashboard-mobile", "/dashboard");

  // Pick the night with the most logged in it, not the most recent. The seed
  // creates upcoming shifts too, and a screenshot of an empty timeline shows
  // a reader nothing about what the app does.
  const { rows } = await sql.query(
    `SELECT s.id, count(e.id) AS entries FROM "Shift" s
     JOIN "User" u ON u.id = s."guardId"
     LEFT JOIN "Entry" e ON e."shiftId" = s.id AND e."deletedAt" IS NULL
     WHERE u.email = 'guard.night@meridian.test'
     GROUP BY s.id
     ORDER BY count(e.id) DESC, s."scheduledStart" DESC
     LIMIT 1`,
  );
  const shiftId = rows[0]?.id;
  if (!shiftId || Number(rows[0].entries) === 0) {
    throw new Error("no shift with entries to screenshot; run `pnpm db:demo` first");
  }
  await shot(guardPage, "timeline-mobile", `/shift/${shiftId}`, { full: true });
  await shot(guardPage, "end-of-shift-mobile", `/shift/${shiftId}/end`, { full: true });
  await guard.close();

  // The supervisor's laptop.
  const sup = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  });
  const supPage = await sup.newPage();
  await signIn(supPage, sql, "owner@meridian.test");
  console.log("supervisor (1280px)");
  await shot(supPage, "reports-desktop", "/reports");
  await shot(supPage, "audit-desktop", "/audit");
  await shot(supPage, "billing-desktop", "/settings/billing", { full: true });
  await sup.close();
} finally {
  await browser.close();
  await sql.end();
}

console.log(`\n${shots.length} screenshots written to docs/screenshots/`);
