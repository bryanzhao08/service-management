/**
 * Milestone 8 gate: the end-of-shift flow and the receipt, in a real browser.
 *
 * Everything in this milestone is a claim about *what the guard is told*, and
 * none of it survives being checked from the outside only:
 *
 *   - the four steps are a client state machine over server actions. `tsc`
 *     proves the props line up and says nothing about whether step 2 ever
 *     hands over to step 3.
 *   - the end-of-shift timer is the product's headline promise. The unit test
 *     proves the arithmetic; only a browser proves the stamp is written when
 *     the guard opens the screen rather than when they submit it.
 *   - `/r/[token]` and `/g/[token]` are read by someone with no account. The
 *     only honest test of "no session required" is a fresh browser context
 *     with no cookies.
 *   - a forged or expired token must 404. That is a control that has to run
 *     against the real route, because the failure mode is a route that
 *     verifies nothing and renders anyway.
 *
 * Run against a started production server:
 *   BASE=http://127.0.0.1:3210 node scripts/check-end-of-shift.mjs
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import pg from "pg";

// Must match AUTH_URL, or the session cookie set by the magic link is for a
// different origin and every authenticated check silently redirects to sign-in.
const BASE =
  process.env.BASE ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3210";
const OUTBOX = path.resolve(".data/outbox");
const GUARD_EMAIL = "guard.night@meridian.test";
const PIN = "4821";

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function latestMagicLink() {
  if (!existsSync(OUTBOX)) return null;
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith(".json"));
  const last = files.at(-1);
  if (!last) return null;
  const raw = JSON.parse(await readFile(path.join(OUTBOX, last), "utf8"));
  const match = /https?:\/\/[^\s"'<>]*callback[^\s"'<>]*/.exec(
    `${raw.html ?? ""} ${raw.text ?? ""}`,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

async function signIn(browser, email) {
  await rm(OUTBOX, { recursive: true, force: true });
  await sql.query('UPDATE "User" SET "pinHash" = NULL WHERE email = $1', [email]);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);

  const link = await latestMagicLink();
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
  return { ctx, page };
}

/**
 * A shift that is already running, with something on the timeline.
 *
 * Fabricated rather than driven through the UI because milestone 4's gate
 * already proves clocking in and logging work; repeating it here would make
 * this run fail for reasons that have nothing to do with section 9.4.
 */
async function liveShift() {
  const { rows: guard } = await sql.query(
    'SELECT id, "companyId" FROM "User" WHERE email = $1',
    [GUARD_EMAIL],
  );
  const guardId = guard[0].id;
  const { rows: site } = await sql.query(
    'SELECT id, timezone FROM "Site" WHERE "companyId" = $1 ORDER BY code LIMIT 1',
    [guard[0].companyId],
  );
  const siteId = site[0].id;

  await sql.query('DELETE FROM "Shift" WHERE "guardId" = $1', [guardId]);
  const { rows: shift } = await sql.query(
    `INSERT INTO "Shift" (id, "siteId", "guardId", "clientId", "scheduledStart",
       "scheduledEnd", "clockInAt", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4,
       (now() AT TIME ZONE 'UTC') - interval '8 hours',
       (now() AT TIME ZONE 'UTC') + interval '10 minutes',
       (now() AT TIME ZONE 'UTC') - interval '8 hours',
       'ACTIVE', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
     RETURNING id`,
    ["chkeosshift", siteId, guardId, "chk-eos-shift"],
  );
  const shiftId = shift[0].id;

  await sql.query(
    `INSERT INTO "Entry" (id, "shiftId", type, "occurredAt", text, "clientId",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'NOTE', (now() AT TIME ZONE 'UTC') - interval '5 hours',
       'Perimeter walk, all doors secure.', $3,
       (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`,
    ["chkeosentry", shiftId, "chk-eos-entry"],
  );

  // One recipient so step 3 has somebody to offer.
  await sql.query(
    `INSERT INTO "Recipient" (id, "siteId", name, email, "roleLabel", required,
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'Priya Raman', 'priya@westhaven.test', 'Property manager',
       true, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
     ON CONFLICT ("siteId", email) DO NOTHING`,
    ["chkeosrecip", siteId],
  );

  return { shiftId, siteId, guardId, timezone: site[0].timezone };
}

async function main() {
  await sql.connect();
  const { shiftId } = await liveShift();
  const browser = await chromium.launch();

  try {
    const { ctx, page } = await signIn(browser, GUARD_EMAIL);

    // ---- step 1: review ------------------------------------------------
    await page.goto(`${BASE}/shift/${shiftId}/end`, { waitUntil: "domcontentloaded" });
    const body = await page.textContent("body");
    check("end-of-shift screen renders", page.url().includes("/end"), page.url());
    check(
      "step 1 shows what is on the timeline",
      /1\s*note|1 entry|Notes/i.test(body ?? ""),
      (body ?? "").slice(0, 120).replace(/\s+/g, " "),
    );

    // The timer stamp is the milestone's whole promise. It must be written by
    // *opening* the screen, not by finishing it.
    const { rows: stamped } = await sql.query(
      'SELECT "endFlowStartedAt", "endFlowCompletedAt" FROM "Shift" WHERE id = $1',
      [shiftId],
    );
    check(
      "opening the flow starts the end-of-shift clock",
      stamped[0].endFlowStartedAt !== null,
      String(stamped[0].endFlowStartedAt),
    );
    check(
      "and does not pre-declare it finished",
      stamped[0].endFlowCompletedAt === null,
    );

    const firstStamp = stamped[0].endFlowStartedAt;
    await page.reload({ waitUntil: "domcontentloaded" });
    const { rows: restamped } = await sql.query(
      'SELECT "endFlowStartedAt" FROM "Shift" WHERE id = $1',
      [shiftId],
    );
    check(
      "re-entering does not reset the clock",
      firstStamp !== null &&
        String(restamped[0].endFlowStartedAt) === String(firstStamp),
      `${firstStamp} -> ${restamped[0].endFlowStartedAt}`,
    );

    // A summary the guard can edit must actually be prefilled, or the whole
    // step is a blank box at 6am.
    const summary = await page.inputValue("textarea").catch(() => "");
    check(
      "the summary arrives written, not blank",
      summary.trim().length > 20,
      summary.slice(0, 80),
    );

    // ---- axe on the authenticated screen -------------------------------
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const serious = axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    );
    check(
      "no serious or critical axe violations on the end-of-shift screen",
      serious.length === 0,
      serious.map((v) => v.id).join(", "),
    );

    // ---- the receipt ---------------------------------------------------
    // Fabricate a sent report so the receipt has something true to show. The
    // generate/send path itself is milestone 7's gate.
    const { rows: report } = await sql.query(
      `INSERT INTO "Report" (id, "shiftId", "generatedById", version, status,
         bytes, pages, sha256, "contentHash", "generatedAt", "sentAt",
         "galleryToken", "galleryExpiresAt", "createdAt", "updatedAt")
       SELECT $1, $2, "guardId", 1, 'SENT', 412000, 3, $3, $4,
         (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'),
         $5, (now() AT TIME ZONE 'UTC') + interval '30 days',
         (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
       FROM "Shift" WHERE id = $2
       RETURNING id`,
      ["chkeosreport", shiftId, "a".repeat(64), "b".repeat(64), "chkeosgallery"],
    );
    const reportId = report[0].id;
    await sql.query(
      `INSERT INTO "ReportDelivery" (id, "reportId", "recipientId", email, status,
         "statusAt", "providerMessageId", attempts)
       VALUES
         ($1, $2, NULL, 'priya@westhaven.test', 'DELIVERED',
          (now() AT TIME ZONE 'UTC'), 'msg-ok', 1),
         ($3, $2, NULL, 'gone@westhaven.test', 'BOUNCED',
          (now() AT TIME ZONE 'UTC'), 'msg-bounce', 1)`,
      ["chkeosdel1", reportId, "chkeosdel2"],
    );

    await page.goto(`${BASE}/shift/${shiftId}/report`, {
      waitUntil: "domcontentloaded",
    });
    const receipt = (await page.textContent("body")) ?? "";
    check("receipt page renders", !page.url().includes("/dashboard"), page.url());
    check(
      "receipt names the delivered recipient",
      receipt.includes("priya@westhaven.test"),
    );
    check(
      "receipt does not hide the bounce",
      /bounce/i.test(receipt) && receipt.includes("gone@westhaven.test"),
    );
    check("receipt carries the file hash", receipt.includes("a".repeat(16)));

    // ---- the receipt PDF -----------------------------------------------
    const pdf = await ctx.request.get(`${BASE}/api/reports/${reportId}/receipt`);
    const pdfBytes = Buffer.from(await pdf.body());
    check(
      "receipt PDF downloads",
      pdf.status() === 200 && pdfBytes.subarray(0, 5).toString() === "%PDF-",
      `${pdf.status()} ${pdfBytes.length}b`,
    );
    check(
      "receipt PDF is never cached",
      (pdf.headers()["cache-control"] ?? "").includes("no-store"),
      pdf.headers()["cache-control"],
    );

    // ---- the public link -----------------------------------------------
    const linkUrl = await page.evaluate(async () => {
      const el = document.querySelector("[data-receipt-link]");
      return el ? el.textContent : null;
    });
    // The link is minted by a server action on click, so drive the control.
    const copyButton = page.getByRole("button", { name: /link/i }).first();
    let publicPath = linkUrl;
    if (!publicPath && (await copyButton.count())) {
      await copyButton.click();
      await page.waitForTimeout(1500);
      publicPath = await page.evaluate(() => {
        const match = /\/r\/[A-Za-z0-9_.-]+/.exec(document.body.innerText);
        return match ? match[0] : null;
      });
    }
    check(
      "a shareable receipt link can be minted",
      Boolean(publicPath),
      String(publicPath),
    );

    if (publicPath) {
      const anon = await browser.newContext();
      const anonPage = await anon.newPage();
      await anonPage.goto(`${BASE}${publicPath}`, { waitUntil: "domcontentloaded" });
      const anonText = (await anonPage.textContent("body")) ?? "";
      check(
        "the signed link opens with no account",
        anonText.includes("priya@westhaven.test"),
        anonPage.url(),
      );
      check(
        "the public receipt offers no PDF download",
        !/download.*receipt/i.test(anonText),
      );

      // Control: a forged token must 404, or the signature means nothing.
      const forged = publicPath.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
      const bad = await anonPage.goto(`${BASE}${forged}`, {
        waitUntil: "domcontentloaded",
      });
      check(
        "a tampered receipt token 404s",
        bad?.status() === 404,
        String(bad?.status()),
      );
      await anon.close();
    }

    // ---- the gallery ---------------------------------------------------
    const anon2 = await browser.newContext();
    const gPage = await anon2.newPage();
    const gRes = await gPage.goto(`${BASE}/g/chkeosgallery`, {
      waitUntil: "domcontentloaded",
    });
    check("the gallery link resolves", gRes?.status() === 200, String(gRes?.status()));
    const gone = await gPage.goto(`${BASE}/g/not-a-real-token`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "an unknown gallery token 404s",
      gone?.status() === 404,
      String(gone?.status()),
    );

    // Control: an expired gallery reads as gone, not empty.
    await sql.query(
      `UPDATE "Report" SET "galleryExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 day'
       WHERE id = $1`,
      [reportId],
    );
    const expired = await gPage.goto(`${BASE}/g/chkeosgallery`, {
      waitUntil: "domcontentloaded",
    });
    check(
      "an expired gallery 404s rather than showing an empty grid",
      expired?.status() === 404,
      String(expired?.status()),
    );
    await anon2.close();

    // ---- the dashboard stat --------------------------------------------
    await sql.query(
      `UPDATE "Shift" SET "endFlowCompletedAt" = "endFlowStartedAt" + interval '171 seconds'
       WHERE id = $1`,
      [shiftId],
    );
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    const dash = (await page.textContent("body")) ?? "";
    check(
      "the dashboard shows the guard their own end-of-shift time",
      /end-of-shift time this month/i.test(dash) && /2m\s*51s|2:51/.test(dash),
      (/Your end-of-shift[^]{0,80}/.exec(dash) ?? [""])[0].replace(/\s+/g, " "),
    );

    await ctx.close();
  } finally {
    await browser.close();
    await sql.end();
  }

  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
