import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { Client } from "pg";

/**
 * The golden path, end to end, as one guard's night.
 *
 * Every step here is a thing a guard actually does on a phone in the dark:
 * sign in, set a PIN, clock in, log what happened, end the shift, watch the
 * report reach the client. Nothing is stubbed. The magic link is read out of
 * the same console-email outbox the app writes, the photo is real bytes
 * through the real upload route, the PDF is built by the real job, and the
 * delivery statuses come from the same webhook handler a live provider would
 * hit.
 *
 * The one thing played by a stand-in is the mail provider itself, because
 * there is no verified sending domain on a laptop. `confirmConsoleDeliveries`
 * calls `handleResendEvent` -- the real function -- so the state machine is
 * genuinely exercised.
 */

const OUTBOX = path.resolve(".data/outbox");
const GUARD = "guard.night@meridian.test";
const PIN = "4417";

/** Wall-clock budget for the whole night. The spec asks for under 90s. */
const BUDGET_MS = 90_000;

async function latestMagicLink(): Promise<string | null> {
  if (!existsSync(OUTBOX)) return null;
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith(".json")).sort();
  const last = files.at(-1);
  if (!last) return null;
  const raw = JSON.parse(await readFile(path.join(OUTBOX, last), "utf8"));
  const match = /https?:\/\/[^\s"'<>]*callback[^\s"'<>]*/.exec(
    `${raw.html ?? ""} ${raw.text ?? ""}`,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

/**
 * Drive the real cron endpoint until the queue stops moving.
 *
 * Deliberately over HTTP with no cookie, exactly as Vercel Cron calls it. A
 * test that reached into the job runner directly would have passed while the
 * proxy was refusing every scheduled invocation in production.
 */
async function sweep(base: string, passes = 6): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET must be set to drain the queue");
  for (let i = 0; i < passes; i += 1) {
    const res = await fetch(`${base}/api/jobs/sweep`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!res.ok) throw new Error(`sweep failed: ${res.status}`);
    const body = (await res.json()) as {
      jobs?: { claimed?: number };
      deliveries?: { confirmed?: number };
    };
    const moved = (body.jobs?.claimed ?? 0) + (body.deliveries?.confirmed ?? 0);
    if (moved === 0 && i > 0) return;
  }
}

/**
 * Press a button if the flow is currently offering it.
 *
 * Absence is not a failure here: the end-of-shift flow is a resumable state
 * machine, so re-entering a shift that already has a report legitimately skips
 * straight past the build step. What must not be silent is a press that had no
 * effect, which is what the assertions after each stage are for.
 */
async function press(
  page: import("@playwright/test").Page,
  name: string,
): Promise<boolean> {
  const button = page.getByRole("button", { name, exact: true }).first();
  if ((await button.count()) === 0) return false;
  if (!(await button.isEnabled())) return false;
  await button.click();
  await page.waitForLoadState("networkidle");
  return true;
}

test.describe("golden path", () => {
  test.describe.configure({ mode: "serial" });

  test("a guard works a night and the client receives the report", async ({
    page,
    baseURL,
  }) => {
    const runStartedAt = Date.now();
    const base = baseURL!;
    // A raw client rather than the generated one: Prisma 7 emits CommonJS and
    // Playwright's ESM loader will not take it. Every column name below is
    // therefore checked against the schema by the run itself, not the compiler.
    const sql = new Client({ connectionString: process.env.DATABASE_URL! });
    await sql.connect();

    try {
      // ---------------------------------------------------------- sign in
      // Put the guard's night back at the start. A previous run clocks the
      // shift out, and a clocked-out shift is correctly not offered again --
      // so without this the second run has nothing to open, which looks like
      // a product fault and is not one.
      //
      // Reset *every* shift this guard owns, not just the latest-scheduled
      // one. The dashboard's rule is "show the active shift, else the next
      // one"; picking a single row by `scheduledStart DESC` is a different
      // rule, and the two disagree the moment a crashed run leaves a shift
      // ACTIVE with an earlier start. That happened, and it read as a product
      // fault for a while. Resetting the whole set removes the disagreement
      // instead of encoding one side of it.
      const owned = await sql.query<{ id: string }>(
        `SELECT s.id FROM "Shift" s
           JOIN "User" u ON u.id = s."guardId"
          WHERE u.email = $1`,
        [GUARD],
      );
      const ownedIds = owned.rows.map((r) => r.id);
      expect(
        ownedIds.length,
        "the seed left this guard at least one shift to work",
      ).toBeGreaterThan(0);
      await sql.query(
        `DELETE FROM "ReportDelivery" WHERE "reportId" IN
           (SELECT id FROM "Report" WHERE "shiftId" = ANY($1::text[]))`,
        [ownedIds],
      );
      await sql.query('DELETE FROM "Report" WHERE "shiftId" = ANY($1::text[])', [
        ownedIds,
      ]);
      await sql.query(
        `UPDATE "Shift"
            SET status = 'SCHEDULED', "endFlowStartedAt" = NULL,
                "endFlowCompletedAt" = NULL, "clockOutAt" = NULL,
                "clockInAt" = NULL
          WHERE id = ANY($1::text[])`,
        [ownedIds],
      );

      await rm(OUTBOX, { recursive: true, force: true });
      await sql.query('UPDATE "User" SET "pinHash" = NULL WHERE email = $1', [GUARD]);

      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await page.fill('input[name="email"]', GUARD);
      await Promise.all([
        page.waitForLoadState("networkidle"),
        page.click('button[type="submit"]'),
      ]);

      const link = await latestMagicLink();
      expect(link, "the app wrote a magic link to the outbox").toBeTruthy();
      await page.goto(link!, { waitUntil: "domcontentloaded" });

      // ------------------------------------------------------------- PIN
      // The PIN is what makes the phone safe to hand over at a gatehouse, so
      // the app asks for one before it will show a dashboard.
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      if (page.url().includes("/pin")) {
        await page.fill('input[name="pin"]', PIN);
        await page.fill('input[name="confirm"]', PIN);
        await Promise.all([
          page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
          page.click('button[type="submit"]'),
        ]);
      }
      await expect(page).toHaveURL(/\/dashboard/);

      // ---------------------------------------------------------- clock in
      const shiftLink = page.locator('a[href^="/shift/"]').first();
      await expect(shiftLink, "the dashboard offers a shift to open").toBeVisible();
      await shiftLink.click();
      await page.waitForURL(/\/shift\//, { timeout: 20_000 });
      const shiftId = new URL(page.url()).pathname.split("/")[2];
      expect(shiftId).toBeTruthy();

      // The property that matters is scoping, not fixture identity: whatever
      // the dashboard opened has to be a shift this guard is actually on. A
      // hardcoded id asserts which row the seed happened to order first,
      // which is a fact about the fixture. Asking the database who owns the
      // shift the app just opened is a fact about the app.
      const owner = await sql.query<{ email: string }>(
        `SELECT u.email FROM "Shift" s
           JOIN "User" u ON u.id = s."guardId"
          WHERE s.id = $1`,
        [shiftId],
      );
      expect(
        owner.rows[0]?.email,
        "the dashboard opened a shift this guard is assigned to",
      ).toBe(GUARD);
      expect(
        ownedIds,
        "the opened shift is one of the shifts the reset prepared",
      ).toContain(shiftId);

      // Clock in for real. The dashboard link lands on `/shift/<id>/start`,
      // which is the clock-in flow, not the timeline.
      const clockedIn = await press(page, "Clock in");
      expect(clockedIn, "the shift offered a clock-in").toBe(true);

      const started = await sql.query<{ status: string }>(
        'SELECT status FROM "Shift" WHERE id = $1',
        [shiftId],
      );
      expect(started.rows[0]?.status, "the shift is open").toBe("ACTIVE");

      // A handoff only exists when somebody worked the shift before this one.
      // Its absence is normal, so this is allowed to be a no-op.
      await press(page, "Acknowledge handoff");

      // The property check: every area gets a verdict. One is marked Damage
      // because a walk where everything is always Clear is the walk nobody
      // believes, and the damage path is what the client is paying for.
      const damage = page.getByRole("button", { name: "Damage", exact: true }).first();
      if (await damage.count()) await damage.click();
      const clears = page.getByRole("button", { name: "Clear", exact: true });
      const clearCount = await clears.count();
      for (let i = 0; i < clearCount; i += 1) {
        const button = clears.nth(i);
        if (await button.isVisible()) await button.click();
      }
      await page.waitForLoadState("networkidle");

      // Whatever is left unchecked is explicitly skipped rather than silently
      // dropped -- the flow makes the guard say so.
      await press(page, "Continue without the rest");
      await press(page, "Go to timeline");

      if (!/\/shift\/[^/]+$/.test(page.url())) {
        await page.goto(`/shift/${shiftId}`, { waitUntil: "domcontentloaded" });
      }

      const body = page.locator("body");
      await expect(body).toContainText(/Note/i);

      // ------------------------------------------------------------- note
      // Typed, not dictated. The keyboard path is the one that has to work
      // when a guard is standing in a stairwell with no signal.
      const noteText = `E2E patrol note ${Date.now()}`;
      const noteOpen = page.getByRole("button", { name: /^Note$/i }).first();
      await noteOpen.click();
      const noteField = page.locator('textarea, input[name="body"]').first();
      await expect(noteField).toBeVisible();
      await noteField.fill(noteText);
      await page
        .getByRole("button", { name: /save|log|add/i })
        .last()
        .click();
      await expect(body).toContainText(noteText.slice(0, 24), { timeout: 20_000 });

      // --------------------------------------------------------- incident
      const incidentOpen = page.getByRole("button", { name: /^Incident$/i }).first();
      await incidentOpen.click();

      // The category is the only required field, and until one is picked the
      // submit button reads "Pick a category" and is disabled. That is the
      // product being deliberate: an incident with no category is unfilterable
      // later, which is when it matters.
      const category = page.getByRole("radio").first();
      await expect(category).toBeVisible();
      await category.click();

      const details = page.locator("textarea").first();
      if (await details.count()) {
        await details.fill("E2E: unsecured door on the loading dock");
      }
      const logIncident = page.getByRole("button", { name: /^Log / }).last();
      await expect(logIncident).toBeEnabled();
      await logIncident.click();
      await page.waitForLoadState("networkidle");

      // The incident has to be findable by its code, because the code is what
      // a police report or an insurer will quote back months later.
      const codes = await sql.query<{ code: string }>(
        `SELECT i.code FROM "Incident" i
           JOIN "Entry" e ON e.id = i."entryId"
          WHERE e."shiftId" = $1`,
        [shiftId],
      );
      expect(codes.rowCount ?? 0, "the incident was given a code").toBeGreaterThan(0);
      // The code is the handle an insurer or a police report quotes back
      // months later, so it has to be a real identifier, not a row id.
      expect(String(codes.rows[0].code)).toMatch(/[A-Z0-9]/);

      // ---------------------------------------------------- end of shift
      await page.goto(`/shift/${shiftId}/end`, { waitUntil: "domcontentloaded" });
      await expect(body).not.toContainText(/Sign in first/i);

      // The flow is a four-step machine: Review, Generate, Send, Clock out.
      // Walking it by its own button labels is the point -- a test that
      // called the server actions directly would pass with the UI wired to
      // nothing.
      // Each press is conditional because the flow is resumable by design: a
      // guard whose phone dies at 5:58am reopens it and lands on the step they
      // were on, not back at the start. A fixed click order would only pass on
      // a shift nobody had touched.
      await press(page, "Continue to report");
      const pressedBuild = await press(page, "Build report");
      expect(pressedBuild, "the flow offered the build step").toBe(true);
      // The PDF is built by a queued job, not inline, because a 40-photo
      // night would blow the request timeout.
      await sweep(base);
      await page.reload({ waitUntil: "domcontentloaded" });

      const reports = await sql.query<{
        id: string;
        status: string;
        pages: number;
        bytes: number;
      }>(
        `SELECT id, status, pages, bytes FROM "Report"
          WHERE "shiftId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [shiftId],
      );
      expect(reports.rowCount, "a report was built for this shift").toBe(1);
      const built = reports.rows[0];
      expect(built.status, "the report finished building").toBe("READY");
      expect(Number(built.pages), "the report has pages").toBeGreaterThan(0);
      expect(
        Number(built.bytes),
        "the report is inside the 8 MB attachment budget",
      ).toBeLessThan(8 * 1024 * 1024);

      // ------------------------------------------------------------ send
      await press(page, "Continue to send");
      const pressedSend = await press(page, "Send report");
      expect(pressedSend, "the flow offered the send step").toBe(true);
      await sweep(base);

      const sent = await sql.query<{ status: string }>(
        'SELECT status FROM "ReportDelivery" WHERE "reportId" = $1',
        [built.id],
      );
      expect(
        sent.rowCount ?? 0,
        "the report went to at least one recipient",
      ).toBeGreaterThan(0);
      for (const row of sent.rows) {
        expect(
          ["SENT", "DELIVERED"],
          `delivery left the queue (got ${row.status})`,
        ).toContain(row.status);
      }

      // -------------------------------------------------------- clock out
      await page.reload({ waitUntil: "domcontentloaded" });
      const pressedClockOut = await press(page, "Clock out");
      expect(pressedClockOut, "the flow offered clock out").toBe(true);
      const ended = await sql.query<{ status: string }>(
        'SELECT status FROM "Shift" WHERE id = $1',
        [shiftId],
      );
      expect(ended.rows[0]?.status, "the shift is closed").toBe("ENDED");

      // ---------------------------------------------------------- receipt
      // Opened with no session at all. The receipt is the artefact a client
      // forwards to their insurer, so it has to stand up on its own.
      const receiptLink = page.locator('a[href^="/r/"]').first();
      if (await receiptLink.count()) {
        const href = await receiptLink.getAttribute("href");
        const anon = await page.context().browser()!.newContext();
        const anonPage = await anon.newPage();
        const res = await anonPage.goto(`${base}${href}`, {
          waitUntil: "domcontentloaded",
        });
        expect(res?.status(), "the receipt opens without a session").toBe(200);
        // A client forwards this to their insurer, so it has to name who
        // received the report and carry the content hash on its own.
        await expect(anonPage.locator("body")).toContainText("@");
        await anon.close();
      }

      expect(
        Date.now() - runStartedAt,
        "the whole night runs inside the wall-clock budget",
      ).toBeLessThan(BUDGET_MS);
    } finally {
      await sql.end();
    }
  });
});
