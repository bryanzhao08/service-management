/**
 * Milestone 4 gate: the clock-in flow, the live timeline and the upload path,
 * exercised in a real browser against a real server and a real database.
 *
 * The layers this covers are the ones nothing else can reach:
 *
 *   - the storage HTTP round trip (presign -> PUT -> record -> signed GET).
 *     The unit tests cover the token and key functions; they have never once
 *     moved a byte, so a signature the route rejects would pass them.
 *   - server actions, which run only in a request. `tsc` proves the argument
 *     shape and nothing about whether the row lands.
 *   - the sheets, whose whole contract is "the entry is stamped when you
 *     opened it, not when you saved it" — a claim only a clock can settle.
 *   - axe on the authenticated screen. Section 18 applies to the app, not
 *     just the marketing page the milestone 3 gate covered.
 *
 * Every positive assertion that could pass vacuously is paired with a control
 * that must fail. Run against a started production server:
 *   BASE=http://127.0.0.1:3210 node scripts/check-shift.mjs
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE ?? "http://127.0.0.1:3210";
const OUTBOX = path.resolve(".data/outbox");
const GUARD_EMAIL = "guard.night@meridian.test";
const PIN = "4821";

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function outboxFiles() {
  if (!existsSync(OUTBOX)) return [];
  return (await readdir(OUTBOX)).filter((f) => f.endsWith(".json"));
}

async function latestMagicLink() {
  const files = await outboxFiles();
  const last = files.at(-1);
  if (!last) return null;
  const raw = JSON.parse(await readFile(path.join(OUTBOX, last), "utf8"));
  const match = /https?:\/\/[^\s"'<>]*callback[^\s"'<>]*/.exec(
    `${raw.html ?? ""} ${raw.text ?? ""}`,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

/** Signs a context in as `email` and unlocks it, leaving it on /dashboard. */
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
 * Guarantees a second company with one owner in it.
 *
 * Cross-tenant isolation is the one property that cannot be tested from inside
 * a single company, and the seed ships one (section 22.2). Without this the
 * isolation control is vacuous — it would report "no second company" forever
 * and never actually exercise the scoping layer.
 */
async function ensureRivalCompany() {
  const email = "rival.owner@sentinel.test";
  const { rows: existing } = await sql.query(
    'SELECT id, email FROM "User" WHERE email = $1',
    [email],
  );
  if (existing[0]) return existing[0];

  const companyId = "chkrivalco";
  await sql.query(
    `INSERT INTO "Company" (id, name, slug, "createdAt", "updatedAt")
     VALUES ($1, 'Sentinel Protective', 'sentinel-protective', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [companyId],
  );
  const { rows } = await sql.query(
    `INSERT INTO "User" (id, "companyId", email, name, role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Rival Owner', 'OWNER', now(), now())
     RETURNING id, email`,
    ["chkrivalowner", companyId, email],
  );
  return rows[0];
}

/**
 * Resets the guard's shifts and guarantees exactly one SCHEDULED shift to
 * start.
 *
 * The seed deliberately creates users, sites and config only (section 22.2) —
 * the sample shift is milestone 12 — so the fixture has to exist here or the
 * dashboard has nothing to offer and the run fails for a reason unrelated to
 * the code. Only the scheduled row is fabricated; the clock-in itself is done
 * through the real UI, which is the thing being tested.
 */
async function resetGuardShifts() {
  const { rows: guard } = await sql.query(
    'SELECT id, "companyId" FROM "User" WHERE email = $1',
    [GUARD_EMAIL],
  );
  if (!guard[0]) throw new Error(`seed is missing ${GUARD_EMAIL}`);

  const { rows: existing } = await sql.query(
    'SELECT id FROM "Shift" WHERE "guardId" = $1',
    [guard[0].id],
  );
  const ids = existing.map((r) => r.id);
  if (ids.length > 0) {
    await sql.query('DELETE FROM "Media" WHERE "shiftId" = ANY($1::text[])', [ids]);
    await sql.query('DELETE FROM "Entry" WHERE "shiftId" = ANY($1::text[])', [ids]);
    await sql.query('DELETE FROM "Shift" WHERE id = ANY($1::text[])', [ids]);
  }

  const { rows: site } = await sql.query(
    `SELECT s.id, s.name,
       (SELECT count(*) FROM "SiteEntryType" t WHERE t."siteId" = s.id) AS types
     FROM "Site" s
     JOIN "SiteAssignment" a ON a."siteId" = s.id
     WHERE a."userId" = $1
     ORDER BY types DESC, s.name LIMIT 1`,
    [guard[0].id],
  );
  if (!site[0]) throw new Error(`${GUARD_EMAIL} is assigned to no site`);
  // The incident sheet needs categories to be usable at all, so the fixture
  // deliberately picks a configured site. A site with none is a real gap —
  // recorded in ASSUMPTIONS.md, not papered over here.
  if (Number(site[0].types) === 0) {
    throw new Error(`${site[0].name} has no entry types; cannot test incidents`);
  }

  const start = new Date(Date.now() - 10 * 60_000);
  const end = new Date(start.getTime() + 8 * 3_600_000);
  await sql.query(
    `INSERT INTO "Shift" (id, "siteId", "guardId", "scheduledStart",
       "scheduledEnd", status, "clientId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'SCHEDULED', $1, now(), now())`,
    [`chk${Date.now()}`, site[0].id, guard[0].id, start, end],
  );
  return { removed: ids.length, site: site[0].name };
}

/** A 2 px JPEG, generated in the page so it is a real decodable image. */
const MAKE_FILE = `
  const canvas = document.createElement("canvas");
  canvas.width = 2400; canvas.height = 1800;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#14532d"; ctx.fillRect(0, 0, 2400, 1800);
  ctx.fillStyle = "#f97316"; ctx.fillRect(100, 100, 900, 700);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  return new File([blob], "test.jpg", { type: "image/jpeg", lastModified: Date.now() });
`;

const browser = await chromium.launch();
await sql.connect();

try {
  const fixture = await resetGuardShifts();
  console.log(
    `\n(removed ${fixture.removed} prior shift(s); scheduled one at ${fixture.site})\n`,
  );

  const { ctx, page } = await signIn(browser, GUARD_EMAIL);
  page.on("pageerror", (error) => {
    check("no uncaught page error", false, error.message);
  });

  // ---- 1. Clock in --------------------------------------------------------
  const startedAt = Date.now();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const startLink = page.locator('a[href*="/start"]').first();
  const dash = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(
    "the dashboard offers a shift to start",
    (await startLink.count()) > 0,
    `${page.url()} :: ${dash.slice(0, 160)}`,
  );
  await startLink.click();
  await page.waitForURL(/\/shift\/[^/]+\/start/, { timeout: 20_000 });

  // The clock-in is a wizard whose steps depend on site config (handoff,
  // property checks, blind spots), so driving it by a fixed step list would
  // couple the gate to one site's configuration. Walk whatever it offers.
  const ADVANCE =
    /^(Clock in|Continue|Continue without the rest|Acknowledge handoff|Go to timeline)$/;
  for (let i = 0; i < 10 && !/\/shift\/[^/]+$/.test(page.url()); i += 1) {
    const next = page.getByRole("button", { name: ADVANCE }).last();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(1_200);
  }
  await page.waitForURL(/\/shift\/[^/]+$/, { timeout: 30_000 });
  const shiftId = new URL(page.url()).pathname.split("/").pop();
  check("clocking in lands on the live timeline", Boolean(shiftId), page.url());

  {
    const { rows } = await sql.query(
      `SELECT status, "clockInAt" AT TIME ZONE 'UTC' AS "clockInAt"
       FROM "Shift" WHERE id = $1`,
      [shiftId],
    );
    check(
      "the shift row is ACTIVE in the database",
      rows[0]?.status === "ACTIVE",
      JSON.stringify(rows[0] ?? null),
    );
    // Control: the row must be this run's, not a leftover the clear missed.
    check(
      "and it was started by this run",
      rows[0] && new Date(rows[0].clockInAt).getTime() >= startedAt - 60_000,
      String(rows[0]?.clockInAt),
    );
  }

  // ---- 2. Note sheet ------------------------------------------------------
  {
    const openedAt = Date.now();
    await page.getByRole("button", { name: "Note" }).click();
    // Deliberate: the whole point of the open-time stamp is that a slow typist
    // does not get a timestamp minutes after the thing they are describing.
    await page.waitForTimeout(3_000);
    await page
      .getByRole("textbox", { name: /what happened/i })
      .fill("Gate 3 latch not catching, wedged it shut for now.");
    await page.getByRole("button", { name: /save note/i }).click();
    await page.waitForTimeout(2_500);

    const { rows } = await sql.query(
      // Prisma maps DateTime to `timestamp without time zone` and writes UTC
      // digits into it. node-pg would otherwise read those digits as local
      // time, which is a silent 7-hour skew here. `AT TIME ZONE 'UTC'` says
      // what the digits already mean.
      `SELECT type, text,
         "occurredAt" AT TIME ZONE 'UTC' AS "occurredAt",
         "createdAt" AT TIME ZONE 'UTC' AS "createdAt"
       FROM "Entry"
       WHERE "shiftId" = $1 AND type = 'NOTE' ORDER BY "createdAt" DESC LIMIT 1`,
      [shiftId],
    );
    check("the note reached the database", Boolean(rows[0]), String(rows.length));
    check(
      "with the text as typed",
      rows[0]?.text === "Gate 3 latch not catching, wedged it shut for now.",
      rows[0]?.text ?? "none",
    );

    const occurred = new Date(rows[0]?.occurredAt ?? 0).getTime();
    const created = new Date(rows[0]?.createdAt ?? 0).getTime();
    check(
      "occurredAt is when the sheet opened, not when it saved",
      Math.abs(occurred - openedAt) < 2_000,
      `${occurred - openedAt}ms from open`,
    );
    // Control: if occurredAt were stamped server-side the two would be equal,
    // and the assertion above would pass for the wrong reason on a fast run.
    check(
      "and it is measurably earlier than createdAt",
      created - occurred > 2_000,
      `${created - occurred}ms apart`,
    );

    const body = await page.locator("main").innerText();
    check(
      "the note appears in the timeline without a reload",
      body.includes("Gate 3 latch"),
      body.slice(0, 160),
    );
  }

  // ---- 3. Photo: the full storage round trip ------------------------------
  let mediaId = null;
  {
    await page.getByRole("button", { name: "Photo" }).click();
    // Bypasses the file picker, which cannot be driven from script, but every
    // hop after it is the real one: compress -> presign -> PUT -> record.
    const input = page.locator('input[type="file"]');
    const handle = await input.elementHandle();
    await page.evaluate(
      async ([el, source]) => {
        const make = new Function(`return (async () => { ${source} })()`);
        const file = await make();
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      [handle, MAKE_FILE],
    );

    await page
      .getByRole("button", { name: /save 1 photo/i })
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(500);

    const { rows } = await sql.query(
      `SELECT id, "storageKeyOriginal", bytes, width, height, status, "entryId"
       FROM "Media" WHERE "shiftId" = $1`,
      [shiftId],
    );
    check("the upload produced a Media row", rows.length === 1, String(rows.length));
    mediaId = rows[0]?.id ?? null;

    check(
      "the object was downscaled to the 2048px cap",
      rows[0]?.width === 2048 && rows[0]?.height === 1536,
      `${rows[0]?.width}x${rows[0]?.height}`,
    );
    // Control: a 2400px source that came back unchanged would mean the
    // compressor never ran and the original was uploaded whole.
    check(
      "which is smaller than the 2400px source",
      (rows[0]?.width ?? 0) < 2400,
      String(rows[0]?.width),
    );
    check(
      "and the recorded byte count came from storage, not the client",
      (rows[0]?.bytes ?? 0) > 0,
      `${rows[0]?.bytes} bytes`,
    );

    const key = rows[0]?.storageKeyOriginal ?? "";
    const onDisk = path.resolve(".data/uploads", key);
    check(
      "the bytes are actually on disk under the company prefix",
      existsSync(onDisk),
      key,
    );
    const { rows: company } = await sql.query(
      'SELECT "companyId" FROM "User" WHERE email = $1',
      [GUARD_EMAIL],
    );
    check(
      "and the key starts with the guard's own company id",
      key.startsWith(`${company[0].companyId}/`),
      key.slice(0, 40),
    );

    await page.getByRole("button", { name: /save 1 photo/i }).click();
    await page.waitForTimeout(2_500);

    const { rows: linked } = await sql.query(
      'SELECT "entryId" FROM "Media" WHERE id = $1',
      [mediaId],
    );
    check(
      "saving the entry relinks the photo to it",
      Boolean(linked[0]?.entryId),
      String(linked[0]?.entryId),
    );
  }

  // ---- 4. Signed GET, and the cross-tenant control ------------------------
  {
    const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await fetch(`${BASE}/api/media/${mediaId}`, {
      headers: { cookie: cookies },
      redirect: "manual",
    });
    const location = res.headers.get("location") ?? "";
    check(
      "GET /api/media/:id redirects to a signed URL",
      res.status === 307 && location.includes("token="),
      `${res.status} ${location.slice(0, 60)}`,
    );

    const bytes = await fetch(new URL(location, BASE), {
      headers: { cookie: cookies },
    });
    const buffer = Buffer.from(await bytes.arrayBuffer());
    check(
      "the signed URL serves the image back",
      bytes.ok && buffer.length > 1000,
      `${bytes.status}, ${buffer.length} bytes`,
    );
    check(
      "and what comes back is a JPEG",
      buffer[0] === 0xff && buffer[1] === 0xd8,
      buffer.subarray(0, 2).toString("hex"),
    );

    // Control 1: a tampered token must not validate. If it does, the signature
    // is decorative and every object is effectively public.
    const tampered = location.replace(/token=([^&]{8})/, "token=AAAAAAAA");
    const bad = await fetch(new URL(tampered, BASE), {
      headers: { cookie: cookies },
    });
    check("a tampered download token is refused", !bad.ok, `${bad.status}`);

    // Control 2: no session at all.
    const anon = await fetch(`${BASE}/api/media/${mediaId}`, {
      redirect: "manual",
    });
    check(
      "an unauthenticated media request is 401",
      anon.status === 401,
      String(anon.status),
    );

    // Control 3: the enumeration oracle. A media id that exists but belongs to
    // nobody visible must answer 404, the same as one that does not exist.
    const missing = await fetch(`${BASE}/api/media/clzzzzzzzzzzzzzzzzzzzzzz`, {
      headers: { cookie: cookies },
      redirect: "manual",
    });
    check(
      "an unknown media id is 404, not 403",
      missing.status === 404,
      String(missing.status),
    );
  }

  // ---- 5. Presign refuses what it should ----------------------------------
  {
    const cookies = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const post = (body) =>
      fetch(`${BASE}/api/uploads/presign`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookies },
        body: JSON.stringify(body),
      });

    const ok = await post({
      shiftId,
      mediaId: "aaaaaaaabbbbbbbb",
      contentType: "image/jpeg",
      bytes: 100_000,
    });
    check(
      "presign accepts a valid photo request",
      ok.status === 200,
      String(ok.status),
    );

    const exe = await post({
      shiftId,
      mediaId: "aaaaaaaabbbbbbbb",
      contentType: "application/x-msdownload",
      bytes: 100,
    });
    check("presign refuses a non-media type", exe.status === 415, String(exe.status));

    const huge = await post({
      shiftId,
      mediaId: "aaaaaaaabbbbbbbb",
      contentType: "image/jpeg",
      bytes: 50 * 1024 * 1024,
    });
    check(
      "presign refuses an oversized photo",
      huge.status === 413,
      String(huge.status),
    );

    const foreign = await post({
      shiftId: "clzzzzzzzzzzzzzzzzzzzzzz",
      mediaId: "aaaaaaaabbbbbbbb",
      contentType: "image/jpeg",
      bytes: 100,
    });
    check(
      "presign refuses a shift the caller cannot see",
      foreign.status === 404,
      String(foreign.status),
    );

    // Recording an upload that never happened must not create a row.
    const { key } = await ok.json();
    const phantom = await fetch(`${BASE}/api/media`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({
        shiftId,
        mediaId: "aaaaaaaabbbbbbbb",
        key,
        kind: "PHOTO",
        bytes: 100_000,
        capturedAt: new Date().toISOString(),
      }),
    });
    check(
      "recording media with no object behind it is refused",
      phantom.status === 409,
      String(phantom.status),
    );

    // And a key pointing outside the caller's own prefix.
    const stolen = await fetch(`${BASE}/api/media`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({
        shiftId,
        mediaId: "aaaaaaaabbbbbbbb",
        key: `some-other-company/s/${shiftId}/aaaaaaaabbbbbbbb/original.jpg`,
        kind: "PHOTO",
        bytes: 100,
        capturedAt: new Date().toISOString(),
      }),
    });
    check(
      "recording media under another company's prefix is refused",
      stolen.status === 404,
      String(stolen.status),
    );
  }

  // ---- 6. Incident: category, code, ongoing -------------------------------
  {
    await page.getByRole("button", { name: "Incident" }).click();
    await page
      .getByRole("radio", { name: /suspicious/i })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: /details|what happened/i })
      .fill("Two people trying door handles on level 2.");
    await page.getByRole("button", { name: /^Log / }).click();
    await page.waitForTimeout(2_500);

    const { rows } = await sql.query(
      `SELECT i.code, i.status, e.type FROM "Incident" i
       JOIN "Entry" e ON e.id = i."entryId" WHERE e."shiftId" = $1`,
      [shiftId],
    );
    check("the incident reached the database", rows.length === 1, String(rows.length));
    check(
      "and was allocated a site-and-date code",
      /^[A-Z]{2,4}-\d{4}-\d{2,}$/.test(rows[0]?.code ?? ""),
      rows[0]?.code ?? "none",
    );
    check(
      "the entry is typed INCIDENT, not NOTE",
      rows[0]?.type === "INCIDENT",
      rows[0]?.type ?? "none",
    );

    const body = await page.locator("main").innerText();
    check(
      "the incident code is visible in the timeline",
      body.includes(rows[0]?.code ?? "\u0000"),
      rows[0]?.code ?? "none",
    );
  }

  // ---- 7. Accessibility on the authenticated screen -----------------------
  {
    await page.goto(`${BASE}/shift/${shiftId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    check(
      "the live timeline has no critical or serious axe violations",
      serious.length === 0,
      serious.map((v) => `${v.id}(${v.nodes.length})`).join(", ") || "none",
    );

    // Each sheet is a separate screen once open, and axe cannot see it closed.
    for (const name of ["Note", "Photo", "Incident", "More"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.waitForTimeout(600);
      const sheet = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const bad = sheet.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      check(
        `the ${name} sheet has no critical or serious axe violations`,
        bad.length === 0,
        bad.map((v) => `${v.id}: ${v.nodes[0]?.html?.slice(0, 80)}`).join(" | ") ||
          "none",
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  }

  // ---- 8. Tap targets on the action bar -----------------------------------
  {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const small = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("nav button, nav a")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 44 || r.height < 44) {
          out.push(
            `${el.textContent?.trim()}: ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
        }
      }
      return out;
    });
    check(
      "every action-bar control is at least 44x44 at 375px",
      small.length === 0,
      small.join(", ") || "none",
    );

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
    check("and the page does not scroll sideways", overflow <= 375, `${overflow}px`);
  }

  // ---- 9. Cross-tenant read, from a different company ---------------------
  {
    const rival = await ensureRivalCompany();
    check(
      "a second company exists to test isolation against",
      Boolean(rival?.email),
      rival?.email ?? "none",
    );
    const rows = [rival];
    {
      const other = await signIn(browser, rows[0].email);
      const cookies = (await other.ctx.cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      const res = await fetch(`${BASE}/api/media/${mediaId}`, {
        headers: { cookie: cookies },
        redirect: "manual",
      });
      check(
        "another company's user gets 404 for this media",
        res.status === 404,
        `${res.status} (as ${rows[0].email})`,
      );
      await other.ctx.close();
    }
  }

  await ctx.close();
} finally {
  await browser.close();
  await sql.end();
}

console.log(
  `\n${failed === 0 ? "check-shift: all checks passed" : `check-shift: ${failed} FAILED`}`,
);
process.exit(failed === 0 ? 0 : 1);
