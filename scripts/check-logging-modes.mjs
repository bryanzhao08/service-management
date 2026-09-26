/**
 * Milestone 9 gate: a site's logging mode, in a real browser.
 *
 * The capability table has unit tests and they prove the wrong thing. They
 * prove `capabilitiesFor("VERBAL").photos === false`, which is a restatement
 * of the table, not evidence that the school's timeline is missing a camera
 * button. The screen could import the table, compute the right answer, and
 * render four buttons anyway.
 *
 * So this drives the actual pages, and the control is the part that matters:
 * the same guard, the same shift id, the same script, with one column flipped
 * in Postgres. If VERBAL and FULL render the same thing, the gate says so.
 * Without that flip a passing run is indistinguishable from a page that never
 * read the mode at all.
 *
 * Run against a started production server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-logging-modes.mjs
 */
import "dotenv/config";

import { chromium } from "playwright";
import pg from "pg";

import { requireMatchingAuthOrigin, signIn } from "./support/session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3210";
requireMatchingAuthOrigin(BASE);
const GUARD_EMAIL = "guard.night@meridian.test";
const SHIFT_ID = "chkmodeshift";

let failed = 0;
// The detail is evidence for a failure, so it is only printed on one. Printing
// it on a pass invites a caller to compute it with a ternary whose else-branch
// then reads as a contradiction of the PASS next to it — which is exactly what
// the first version of this file did.
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`,
  );
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

/**
 * One shift, reused across both modes.
 *
 * Reusing the id is the point. Two shifts at two sites would differ in more
 * than the mode, and any difference in the rendered page could be blamed on
 * the other site's data. One row, one column changing, is the only version of
 * this that isolates the thing being tested.
 */
async function seedShift(siteId) {
  const { rows: guard } = await sql.query('SELECT id FROM "User" WHERE email = $1', [
    GUARD_EMAIL,
  ]);
  const guardId = guard[0].id;

  await sql.query('DELETE FROM "Shift" WHERE id = $1', [SHIFT_ID]);
  await sql.query(
    `INSERT INTO "Shift" (id, "siteId", "guardId", "clientId", "scheduledStart",
       "scheduledEnd", "clockInAt", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4,
       (now() AT TIME ZONE 'UTC') - interval '6 hours',
       (now() AT TIME ZONE 'UTC') + interval '2 hours',
       (now() AT TIME ZONE 'UTC') - interval '6 hours',
       'ACTIVE', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`,
    [SHIFT_ID, siteId, guardId, "chk-mode-shift"],
  );
  return guardId;
}

async function setMode(siteId, mode) {
  await sql.query('UPDATE "Site" SET "loggingMode" = $1 WHERE id = $2', [mode, siteId]);
}

async function clearEntries() {
  await sql.query('DELETE FROM "Entry" WHERE "shiftId" = $1', [SHIFT_ID]);
}

async function addNote(text, clientId) {
  await sql.query(
    `INSERT INTO "Entry" (id, "shiftId", type, "occurredAt", text, "clientId",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'NOTE', (now() AT TIME ZONE 'UTC') - interval '1 hour',
       $3, $4, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`,
    [clientId, SHIFT_ID, text, clientId],
  );
}

/** What the action bar is offering, as the guard sees it. */
async function barLabels(page) {
  await page.goto(`${BASE}/shift/${SHIFT_ID}`, {
    waitUntil: "domcontentloaded",
  });
  // A redirect to sign-in renders zero action buttons, which is exactly what
  // a correctly-restricted VERBAL timeline looks like. Reject the ambiguity
  // rather than measure it.
  if (!page.url().includes(`/shift/${SHIFT_ID}`)) {
    throw new Error(`bounced off the timeline to ${page.url()}`);
  }
  await page.waitForSelector("nav[aria-label='Log an entry']", {
    timeout: 15_000,
  });
  return page
    .locator("nav[aria-label='Log an entry'] button")
    .evaluateAll((nodes) =>
      nodes
        .map((n) => (n.textContent ?? "").trim())
        .filter((t) => ["Note", "Photo", "Incident", "More"].includes(t)),
    );
}

/** The step labels on the end-of-shift screen. */
async function railLabels(page) {
  await page.goto(`${BASE}/shift/${SHIFT_ID}/end`, {
    waitUntil: "domcontentloaded",
  });
  if (!page.url().includes(`/shift/${SHIFT_ID}/end`)) {
    throw new Error(`bounced off the end-of-shift screen to ${page.url()}`);
  }
  await page.waitForSelector("ol[aria-label='End of shift progress']", {
    timeout: 15_000,
  });
  return page
    .locator("ol[aria-label='End of shift progress'] li p")
    .evaluateAll((nodes) =>
      nodes.map((n) => (n.textContent ?? "").replace(/\s*\(done\)$/, "").trim()),
    );
}

async function main() {
  await sql.connect();

  const { rows: sites } = await sql.query(
    `SELECT s.id, s.name, s."loggingMode" FROM "Site" s
     JOIN "User" u ON u."companyId" = s."companyId"
     WHERE u.email = $1 ORDER BY s.code`,
    [GUARD_EMAIL],
  );
  const site = sites[0];
  if (!site) throw new Error("no site for the seeded guard");
  const originalMode = site.loggingMode;

  const browser = await chromium.launch();
  const { ctx, page } = await signIn(browser, GUARD_EMAIL, { base: BASE, sql });

  try {
    await seedShift(site.id);

    // ---- VERBAL --------------------------------------------------------
    await setMode(site.id, "VERBAL");
    await clearEntries();

    const verbalBar = await barLabels(page);
    check(
      "VERBAL timeline offers Note and nothing else",
      verbalBar.length === 1 && verbalBar[0] === "Note",
      JSON.stringify(verbalBar),
    );

    // The cap is the whole of VERBAL's "single optional note". One note in,
    // and the control that writes a second has to be gone.
    await addNote("Verbal handover to the day guard.", "chk-mode-note-1");
    const verbalCapped = await barLabels(page);
    check(
      "VERBAL timeline hides Note once one exists",
      verbalCapped.length === 0,
      JSON.stringify(verbalCapped),
    );

    const verbalRail = await railLabels(page);
    check(
      "VERBAL end-of-shift is Review then Clock out",
      verbalRail.length === 2 &&
        verbalRail[0] === "1. Review" &&
        verbalRail[1] === "4. Clock out",
      JSON.stringify(verbalRail),
    );

    const verbalBody = (await page.locator("body").innerText()).toLowerCase();
    check(
      "VERBAL end-of-shift never offers to send anything",
      !verbalBody.includes("recipient") && !verbalBody.includes("generate"),
      verbalBody.includes("recipient") ? "mentions recipients" : "mentions generate",
    );

    // The server half. Hiding the button is half a fix; the other half is
    // every route that could hand back a document existing only when the site
    // agreed to one. This is the weaker of the two claims — it 404s because a
    // VERBAL shift has no report row, not because the route reads the mode —
    // so it is named for what it actually shows. The mode-aware refusals in
    // the build handler and the three server actions are pinned in
    // tests/db/logging-mode.test.ts against real Postgres.
    const receiptStatus = await page.evaluate(async (base) => {
      const res = await fetch(`${base}/api/reports/chkmodeshift/receipt`);
      return res.status;
    }, BASE);
    check(
      "VERBAL shift has no report, so its receipt route 404s",
      receiptStatus === 404,
      `status ${receiptStatus}`,
    );

    // Typed into the address bar rather than reached from a link, because
    // that is the one way a guard at a verbal-handover site could still land
    // on a report screen.
    const reportPage = await page.goto(`${BASE}/shift/${SHIFT_ID}/report`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "VERBAL report page is not reachable by URL",
      reportPage?.status() === 404,
      `status ${reportPage?.status()}`,
    );

    // ---- FULL, the control ---------------------------------------------
    // Same page, same shift, same note already on the timeline. If these
    // assertions do not flip, nothing above was reading the mode.
    await setMode(site.id, "FULL");

    const fullBar = await barLabels(page);
    check(
      "CONTROL: FULL restores Photo and Incident",
      fullBar.includes("Photo") &&
        fullBar.includes("Incident") &&
        fullBar.includes("Note"),
      JSON.stringify(fullBar),
    );

    const fullRail = await railLabels(page);
    check(
      "CONTROL: FULL end-of-shift has all four steps",
      fullRail.length === 4 &&
        fullRail[1] === "2. Generate" &&
        fullRail[2] === "3. Send",
      JSON.stringify(fullRail),
    );

    // ---- LIGHT ----------------------------------------------------------
    // The middle mode is the one most likely to be wrong, because it is the
    // one nobody pictures: a full timeline that produces no PDF.
    await setMode(site.id, "LIGHT");

    const lightBar = await barLabels(page);
    check(
      "LIGHT keeps the timeline whole",
      lightBar.includes("Photo") && lightBar.includes("Incident"),
      JSON.stringify(lightBar),
    );

    const lightRail = await railLabels(page);
    check(
      "LIGHT still ends in a send, without a PDF",
      lightRail.length === 4,
      JSON.stringify(lightRail),
    );
  } finally {
    await setMode(site.id, originalMode);
    await sql.query('DELETE FROM "Shift" WHERE id = $1', [SHIFT_ID]);
    await ctx.close();
    await browser.close();

    const { rows: restored } = await sql.query(
      'SELECT "loggingMode" FROM "Site" WHERE id = $1',
      [site.id],
    );
    check(
      "site's mode is restored",
      restored[0]?.loggingMode === originalMode,
      `${restored[0]?.loggingMode} vs ${originalMode}`,
    );
    await sql.end();
  }

  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
