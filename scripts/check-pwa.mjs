/**
 * Milestone 10 gate: the PWA, the service worker, the bell and the offline
 * outbox, in a real browser against a real server.
 *
 * The layers this covers are the ones nothing else can reach:
 *
 *   - manifest and icons. `tsc` proves the generator compiles; it proves
 *     nothing about whether the browser can parse what it wrote, or whether
 *     the icons it references are actually served.
 *   - service worker registration. A worker that throws on install still
 *     registers from the page's point of view, so the only honest test is to
 *     wait for it to reach `activated`.
 *   - the offline outbox end to end: go offline, write a note, watch it land
 *     in the timeline and in the banner, come back online, watch it reach the
 *     database. Unit tests cover `isPermanent` and the protocol constants;
 *     neither has ever queued a real request.
 *   - the bell, which polls a route that only exists at runtime.
 *
 * Every positive assertion that could pass vacuously is paired with a control
 * that must fail. Run against a started production server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-pwa.mjs
 */
import "dotenv/config";

import { chromium } from "playwright";
import pg from "pg";

import { requireMatchingAuthOrigin, signIn } from "./support/session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3210";
requireMatchingAuthOrigin(BASE);
const GUARD_EMAIL = "guard.night@meridian.test";

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

/**
 * Guarantees an open shift for `guardId` on a FULL-mode site.
 *
 * The seed's open shift is on a VERBAL site, where one note is the documented
 * maximum and the action is hidden once it is used. Reusing it would make a
 * correctly-hidden button look like a broken outbox, so the gate owns its own
 * shift rather than depending on whatever the last run left behind.
 */
async function ensureOpenFullShift(guardId) {
  const { rows: sites } = await sql.query(
    `SELECT id FROM "Site" WHERE "loggingMode" = 'FULL' LIMIT 1`,
  );
  const siteId = sites[0]?.id;
  if (!siteId) return null;

  const { rows: open } = await sql.query(
    `SELECT id FROM "Shift" WHERE "guardId" = $1 AND "siteId" = $2
       AND "clockInAt" IS NOT NULL AND "clockOutAt" IS NULL
     ORDER BY "clockInAt" DESC LIMIT 1`,
    [guardId, siteId],
  );
  if (open[0]) return open[0].id;

  const id = "chkpwashift";
  await sql.query(
    `INSERT INTO "Shift" (id, "clientId", "siteId", "guardId", status, "scheduledStart", "scheduledEnd",
                          "clockInAt", "createdAt", "updatedAt")
     VALUES ($1, $1, $2, $3, 'ACTIVE',
             (now() AT TIME ZONE 'UTC') - interval '1 hour',
             (now() AT TIME ZONE 'UTC') + interval '7 hours',
             (now() AT TIME ZONE 'UTC') - interval '1 hour',
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
     ON CONFLICT (id) DO UPDATE
       SET "clockOutAt" = NULL, status = 'ACTIVE', "updatedAt" = (now() AT TIME ZONE 'UTC')`,
    [id, siteId, guardId],
  );
  return id;
}

async function main() {
  await sql.connect();
  const browser = await chromium.launch();

  // ---------------------------------------------------------------------
  // Manifest and icons, unauthenticated
  // ---------------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    const href = await page.getAttribute('link[rel="manifest"]', "href");
    check(
      "manifest is linked from the document",
      href === "/manifest.webmanifest",
      String(href),
    );

    const response = await page.request.get(`${BASE}/manifest.webmanifest`);
    let manifest = null;
    try {
      manifest = await response.json();
    } catch {
      // Left null; the checks below report it.
    }
    check("manifest parses as JSON", manifest !== null, `status ${response.status()}`);
    check(
      "manifest is installable",
      manifest?.display === "standalone" &&
        typeof manifest?.name === "string" &&
        typeof manifest?.start_url === "string",
      `display=${manifest?.display} start_url=${manifest?.start_url}`,
    );
    check(
      "theme and background are the spec colour",
      manifest?.theme_color === "#030701" && manifest?.background_color === "#030701",
      `${manifest?.theme_color} / ${manifest?.background_color}`,
    );

    // A manifest that lists an icon the server does not have is worse than no
    // manifest: the install prompt silently never appears and nothing logs.
    const icons = manifest?.icons ?? [];
    check("manifest lists icons", icons.length >= 2, `${icons.length} icons`);
    let missing = 0;
    for (const icon of icons) {
      const iconResponse = await page.request.get(new URL(icon.src, BASE).toString());
      if (!iconResponse.ok()) missing += 1;
    }
    check("every listed icon is actually served", missing === 0, `${missing} missing`);

    const maskable = icons.some((icon) =>
      String(icon.purpose ?? "").includes("maskable"),
    );
    check("a maskable icon is offered", maskable);

    // Control: a path the manifest does not list must 404, proving the check
    // above is reading the server and not a cache that answers everything.
    const bogus = await page.request.get(`${BASE}/icons/icon-does-not-exist.png`);
    check(
      "CONTROL a missing icon 404s",
      bogus.status() === 404,
      `status ${bogus.status()}`,
    );

    await context.close();
  }

  // ---------------------------------------------------------------------
  // Service worker, authenticated
  // ---------------------------------------------------------------------
  const { ctx: context, page } = await signIn(browser, GUARD_EMAIL, {
    base: BASE,
    sql,
  });

  // The worker is registered from /dashboard and /shift, deliberately not
  // from the marketing pages.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker =
      registration.active ?? registration.installing ?? registration.waiting;
    return worker ? worker.state : "none";
  });
  check("service worker reaches activated", state === "activated", state);

  const controllerScript = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null,
  );
  check(
    "the activated worker is our /sw.js",
    typeof controllerScript === "string" && controllerScript.endsWith("/sw.js"),
    String(controllerScript),
  );

  // Control: the marketing pages must NOT mount the app chrome. A pricing
  // visitor downloading a notification poller is a real regression and the
  // only way to see it is to look.
  {
    const marketing = await browser.newContext();
    const marketingPage = await marketing.newPage();
    await marketingPage.goto(`${BASE}/pricing`, { waitUntil: "load" });
    const bell = await marketingPage.locator("[data-notification-bell]").count();
    check("CONTROL the pricing page mounts no bell", bell === 0, `${bell} found`);
    await marketing.close();
  }

  // ---------------------------------------------------------------------
  // The bell
  // ---------------------------------------------------------------------
  const { rows: guardRows } = await sql.query(
    'SELECT id FROM "User" WHERE email = $1',
    [GUARD_EMAIL],
  );
  const guardId = guardRows[0]?.id;
  check("seed guard exists", Boolean(guardId), GUARD_EMAIL);

  await sql.query(
    `INSERT INTO "Notification" (id, "userId", type, title, body, url, "createdAt")
     VALUES ($1, $2, 'REPORT_DELIVERED', 'Report delivered', 'Gate test notification', '/dashboard', (now() AT TIME ZONE 'UTC'))`,
    [`gate-noti-${Date.now()}`, guardId],
  );

  await page.reload({ waitUntil: "load" });
  const bell = page.locator("[data-notification-bell]");
  check("the bell renders", (await bell.count()) === 1);

  // The unread badge is the whole point of the bell; a bell that never counts
  // is decoration. The raw count is on the button because the badge caps at
  // "9+".
  await page
    .waitForFunction(
      () =>
        Number(
          document
            .querySelector("[data-unread-count]")
            ?.getAttribute("data-unread-count"),
        ) >= 1,
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
  const unread = await page
    .locator("[data-unread-count]")
    .first()
    .getAttribute("data-unread-count");
  check("the bell shows an unread count", Number(unread) >= 1, String(unread));

  // Opening the panel *is* the read receipt in this design, so the database
  // check below is the only thing that proves the receipt was recorded rather
  // than just painted.
  await bell.locator("button").first().click();
  const item = page.getByText("Gate test notification");
  check("the notification body is listed", (await item.count()) >= 1);

  let stillUnread = -1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { rows } = await sql.query(
      `SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = $1 AND "readAt" IS NULL`,
      [guardId],
    );
    stillUnread = rows[0].n;
    if (stillUnread === 0) break;
    await page.waitForTimeout(500);
  }
  check(
    "opening the bell records the read in the database",
    stillUnread === 0,
    `${stillUnread} unread`,
  );

  // ---------------------------------------------------------------------
  // The push toggle
  // ---------------------------------------------------------------------
  await page.goto(`${BASE}/settings`, { waitUntil: "load" });
  const pushState = await page
    .locator("[data-push-state]")
    .first()
    .getAttribute("data-push-state");
  check(
    "the push toggle reports a real state",
    ["off", "on", "denied", "unsupported"].includes(String(pushState)),
    String(pushState),
  );

  // ---------------------------------------------------------------------
  // Offline: the whole point of the milestone
  // ---------------------------------------------------------------------
  // Must be a FULL site. VERBAL caps notes at one, so on that site the Note
  // action is correctly absent and the offline test would report a missing
  // button as if the outbox were broken.
  const shiftId = await ensureOpenFullShift(guardId);
  check("guard has an open shift on a FULL site", Boolean(shiftId), String(shiftId));

  if (shiftId) {
    await page.goto(`${BASE}/shift/${shiftId}`, { waitUntil: "load" });
    // Let the worker take control, or the offline navigation has no cache to
    // fall back on and the test measures nothing but a network error.
    await page
      .waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
        timeout: 15000,
      })
      .catch(() => {});

    const marker = `Gate offline note ${Date.now()}`;
    await context.setOffline(true);

    await page
      .getByRole("button", { name: /^note$/i })
      .first()
      .click();
    await page.locator("textarea").first().fill(marker);
    await page.getByRole("button", { name: /save/i }).first().click();

    // The row must appear immediately. A guard who cannot see the note they
    // just wrote types it again, and the report ends up with two.
    const optimistic = page.getByText(marker);
    let visible = false;
    try {
      await optimistic.first().waitFor({ state: "visible", timeout: 8000 });
      visible = true;
    } catch {
      visible = false;
    }
    check("an offline note appears in the timeline immediately", visible);

    const pendingBadge = await page.getByText("Saved on this phone").count();
    check(
      "the queued note is marked as not yet synced",
      pendingBadge >= 1,
      `${pendingBadge}`,
    );

    const banner = await page.locator("[data-offline-banner]").count();
    check("the offline banner is shown", banner >= 1, `${banner}`);

    // Control: it must genuinely not be in the database yet. Without this the
    // whole offline test would pass against a build that quietly stayed
    // online.
    const { rows: before } = await sql.query(
      'SELECT count(*)::int AS n FROM "Entry" WHERE text = $1',
      [marker],
    );
    check(
      "CONTROL the note is not in the database while offline",
      before[0].n === 0,
      `${before[0].n}`,
    );

    await context.setOffline(false);
    // The page drains on `online`, `visibilitychange`, a worker message and
    // mount. This exercises the first.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    let landed = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { rows } = await sql.query(
        'SELECT count(*)::int AS n FROM "Entry" WHERE text = $1',
        [marker],
      );
      landed = rows[0].n;
      if (landed > 0) break;
      await page.waitForTimeout(1000);
    }
    check(
      "the queued note reaches the database once online",
      landed === 1,
      `${landed} rows`,
    );

    // Replaying is idempotent on clientId, so a second flush must not double
    // the note. This is the property the whole outbox design rests on.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(2000);
    const { rows: after } = await sql.query(
      'SELECT count(*)::int AS n FROM "Entry" WHERE text = $1',
      [marker],
    );
    check(
      "a second flush does not duplicate it",
      after[0].n === 1,
      `${after[0].n} rows`,
    );

    await sql.query('DELETE FROM "Entry" WHERE text = $1', [marker]);
  }

  // ---------------------------------------------------------------------
  // The offline fallback document
  // ---------------------------------------------------------------------
  {
    const offlinePage = await context.newPage();
    await offlinePage.goto(`${BASE}/offline`, { waitUntil: "domcontentloaded" });
    const heading = await offlinePage.locator("h1").first().textContent();
    check("the offline page renders", Boolean(heading?.trim()), String(heading));
    await offlinePage.close();
  }

  await sql.query(`DELETE FROM "Notification" WHERE body = 'Gate test notification'`);
  await context.close();
  await browser.close();
  await sql.end();

  console.log(
    failed === 0 ? "\nAll PWA checks passed." : `\n${failed} check(s) failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
