/**
 * Milestone 5 gate: the media worker, from a photo taken in the browser to two
 * derived files on disk, plus the cron endpoint that guarantees it runs.
 *
 * What only this can reach:
 *
 *   - `after()`. It fires after a real response, in a real server. Nothing in
 *     the unit or database suites runs a Next.js request lifecycle, so the
 *     nudge that makes an upload feel instant is untested until here.
 *   - the variant round trip. `/api/media/<id>?variant=thumb` has to return the
 *     worker's 400px JPEG and not the 2048px original, and the only proof is
 *     decoding the bytes that come back over HTTP.
 *   - the sweep route's authentication, which is the one thing standing between
 *     a public URL and a worker that does real work on demand.
 *
 * Run against a started production server:
 *   AUTH_URL=http://localhost:3210 BASE=http://localhost:3210 node scripts/check-jobs.mjs
 */
import "dotenv/config";

import { chromium } from "playwright";
import pg from "pg";

import { requireMatchingAuthOrigin, signIn } from "./support/session.mjs";

const BASE = process.env.BASE ?? "http://localhost:3210";
requireMatchingAuthOrigin(BASE);
const GUARD_EMAIL = "guard.night@meridian.test";
const PEER_EMAIL = "guard.swing@meridian.test";
const PEER_SHIFT = "isoshiftjobsgate";

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });

/** One SCHEDULED shift at a fully configured site. Same fixture as milestone 4. */
async function resetGuardShifts() {
  const { rows: guard } = await sql.query('SELECT id FROM "User" WHERE email = $1', [
    GUARD_EMAIL,
  ]);
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

  const start = new Date(Date.now() - 10 * 60_000);
  await sql.query(
    `INSERT INTO "Shift" (id, "siteId", "guardId", "scheduledStart",
       "scheduledEnd", status, "clientId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'SCHEDULED', $1, now(), now())`,
    [
      `job${Date.now()}`,
      site[0].id,
      guard[0].id,
      start,
      new Date(start.getTime() + 8 * 3_600_000),
    ],
  );
  return site[0].name;
}

/** A real, decodable 2400x1800 JPEG built in the page. */
const MAKE_FILE = `
  const canvas = document.createElement("canvas");
  canvas.width = 2400; canvas.height = 1800;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 2400, 1800);
  grad.addColorStop(0, "#0b3d91"); grad.addColorStop(1, "#f2a900");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 2400, 1800);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  return new File([blob], "gate.jpg", { type: "image/jpeg" });
`;

/**
 * Walks the clock-in wizard.
 *
 * Its steps depend on site config (handoff, property checks, blind spots), so
 * a fixed step list would couple the gate to one site's configuration. Same
 * walker as the milestone 4 gate.
 */
async function clockIn(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const startLink = page.locator('a[href*="/start"]').first();
  if ((await startLink.count()) === 0) {
    throw new Error(`dashboard offered no shift to start (${page.url()})`);
  }
  await startLink.click();
  await page.waitForURL(/\/shift\/[^/]+\/start/, { timeout: 20_000 });

  const ADVANCE =
    /^(Clock in|Continue|Continue without the rest|Acknowledge handoff|Go to timeline)$/;
  for (let i = 0; i < 10 && !/\/shift\/[^/]+$/.test(page.url()); i += 1) {
    const next = page.getByRole("button", { name: ADVANCE }).last();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(1_200);
  }
  await page.waitForURL(/\/shift\/[^/]+$/, { timeout: 30_000 });
}

async function main() {
  await sql.connect();
  const site = await resetGuardShifts();
  console.log(`fixture: one SCHEDULED shift at ${site}\n`);

  const browser = await chromium.launch();
  const { ctx, page } = await signIn(browser, GUARD_EMAIL, { base: BASE, sql });

  // ---------------------------------------------------------------- upload
  console.log("— upload and worker —");
  await clockIn(page);
  const shiftId = new URL(page.url()).pathname.split("/").pop();

  await page.getByRole("button", { name: "Photo" }).click();
  // Bypasses the file picker, which cannot be driven from script. Every hop
  // after it is real: compress -> presign -> PUT -> record -> enqueue.
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
  const save = page.getByRole("button", { name: /save 1 photo/i });
  await save.waitFor({ state: "visible", timeout: 30_000 });
  // Saving is what attaches the Media to an Entry. Without it the photo is
  // orphaned and the timeline has no row to hang a thumbnail on.
  await save.click();
  await page.waitForTimeout(1_500);

  const mediaRow = async () => {
    const { rows } = await sql.query(
      `SELECT id, status, "storageKeyOriginal", "storageKeyThumb",
              "storageKeyPdf", width, height
       FROM "Media" WHERE "shiftId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [shiftId],
    );
    return rows[0];
  };

  let media = await mediaRow();
  check("upload created a Media row", Boolean(media), media?.id ?? "none");

  // Poll: `after()` runs behind the response, so the row is PENDING for a
  // moment by design. A fixed sleep would either be flaky or slow.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && media?.status === "PENDING") {
    await new Promise((r) => setTimeout(r, 400));
    media = await mediaRow();
  }

  check(
    "after() drove the job to completion without a cron",
    media?.status === "PROCESSED",
    `status=${media?.status}`,
  );
  // The browser compresses to MAX_LONG_EDGE (2048, src/lib/media/compress.ts)
  // before it ever leaves the phone, so the stored "original" is 2048 wide,
  // not the 2400 the canvas drew.
  //
  // These dimensions are CLIENT-REPORTED (route.ts reads body.width); the
  // worker never writes them back. Proven by the negative control: with the
  // worker disabled this check still passed. So it evidences the client
  // compressor, not the worker. The worker's own output is checked over HTTP
  // below, by decoding the bytes it actually wrote.
  check(
    "the client compressed before upload and the row records it",
    media?.width === 2048 && media.width < 2400,
    `w=${media?.width} h=${media?.height}`,
  );
  check("worker wrote a thumb key", Boolean(media?.storageKeyThumb));
  check("worker wrote a pdf key", Boolean(media?.storageKeyPdf));
  check(
    "the original key is untouched",
    media?.storageKeyOriginal?.endsWith("/original.jpg"),
    media?.storageKeyOriginal ?? "",
  );

  const { rows: jobs } = await sql.query(
    `SELECT status, attempts FROM "Job" WHERE payload->>'mediaId' = $1`,
    [media?.id ?? ""],
  );
  check(
    "the job row is SUCCEEDED after exactly one attempt",
    jobs[0]?.status === "SUCCEEDED" && jobs[0]?.attempts === 1,
    `status=${jobs[0]?.status} attempts=${jobs[0]?.attempts}`,
  );

  // ------------------------------------------------------------- variants
  console.log("\n— variants over HTTP —");
  const fetchVariant = async (variant) =>
    ctx.request.get(`${BASE}/api/media/${media.id}?variant=${variant}`);

  const dims = async (response) => {
    const buf = Buffer.from(await response.body());
    // Walk the JPEG segment markers to the SOF frame, which carries the size.
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { w: 0, h: 0 };
  };

  const thumb = await fetchVariant("thumb");
  const thumbSize = await dims(thumb);
  check("thumb variant is served", thumb.status() === 200, `status=${thumb.status()}`);
  check(
    "thumb is 400px on its long edge, not the original",
    Math.max(thumbSize.w, thumbSize.h) === 400,
    `${thumbSize.w}x${thumbSize.h}`,
  );

  const pdfVariant = await fetchVariant("pdf");
  const pdfSize = await dims(pdfVariant);
  check(
    "pdf variant is 1600px on its long edge",
    Math.max(pdfSize.w, pdfSize.h) === 1600,
    `${pdfSize.w}x${pdfSize.h}`,
  );

  const original = await fetchVariant("original");
  const originalSize = await dims(original);
  check(
    "original is served undownscaled at its stored size",
    originalSize.w === 2048,
    `${originalSize.w}x${originalSize.h}`,
  );

  const thumbBytes = (await thumb.body()).length;
  const originalBytes = (await original.body()).length;
  check(
    "the thumb is dramatically smaller than the original",
    thumbBytes * 10 < originalBytes,
    `${thumbBytes} vs ${originalBytes} bytes`,
  );

  // The point of the variant: the grid must not pull the full-size file.
  const thumbRequests = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/media/")) thumbRequests.push(req.url());
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  // domcontentloaded resolves before the browser fetches images, so waiting
  // for the <img> to exist is what makes the request list non-empty.
  await page
    .locator('img[src*="/api/media/"]')
    .first()
    .waitFor({ state: "attached", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(1_000);
  check(
    "the timeline requests thumbs, never the original",
    thumbRequests.length > 0 && thumbRequests.every((u) => u.includes("variant=thumb")),
    `${thumbRequests.length} media requests`,
  );

  // --------------------------------------------------------------- sweep
  console.log("\n— sweep endpoint —");
  const anon = await ctx.request.get(`${BASE}/api/jobs/sweep`);
  check(
    "sweep rejects an unauthenticated call",
    anon.status() === 401,
    `status=${anon.status()}`,
  );

  const wrong = await ctx.request.get(`${BASE}/api/jobs/sweep`, {
    headers: { authorization: "Bearer not-the-secret" },
  });
  check(
    "sweep rejects a wrong secret",
    wrong.status() === 401,
    `status=${wrong.status()}`,
  );

  // A near-miss: the right secret with one character removed. A length-only or
  // prefix comparison would let this through.
  const secret = process.env.CRON_SECRET;
  const nearMiss = await ctx.request.get(`${BASE}/api/jobs/sweep`, {
    headers: { authorization: `Bearer ${secret.slice(0, -1)}` },
  });
  check(
    "sweep rejects a one-character-short secret",
    nearMiss.status() === 401,
    `status=${nearMiss.status()}`,
  );

  const authed = await ctx.request.get(`${BASE}/api/jobs/sweep`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = authed.ok() ? await authed.json() : {};
  check(
    "sweep accepts the configured secret",
    authed.status() === 200,
    `status=${authed.status()}`,
  );
  check(
    "sweep reports queue counts",
    typeof body.queue === "object" && body.queue !== null,
  );
  check("sweep is not cacheable", authed.headers()["cache-control"] === "no-store");

  // ------------------------------------------------------- sweep does work
  console.log("\n— sweep drains a backlog —");
  // A job the nudge cannot have handled: enqueued straight into the table with
  // no request behind it, which is exactly the redeploy/crash case.
  await sql.query(
    `INSERT INTO "Job" (id, type, payload, status, "runAfter", "updatedAt")
     VALUES ($1, 'PROCESS_MEDIA', $2::jsonb, 'QUEUED',
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`,
    [`gate${Date.now()}`, JSON.stringify({ mediaId: media.id })],
  );
  await sql.query(
    `UPDATE "Media" SET status = 'PENDING', "storageKeyThumb" = NULL WHERE id = $1`,
    [media.id],
  );

  const swept = await ctx.request.get(`${BASE}/api/jobs/sweep`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const summary = await swept.json();
  const after = await mediaRow();
  check(
    "sweep claimed and ran the orphaned job",
    summary.claimed >= 1 && summary.succeeded >= 1,
    `claimed=${summary.claimed} succeeded=${summary.succeeded}`,
  );
  check(
    "sweep restored the variant the nudge never saw",
    after?.status === "PROCESSED" && Boolean(after?.storageKeyThumb),
    `status=${after?.status}`,
  );

  // ------------------------------------------------------------- failure
  console.log("\n— a broken job gives up and says so —");
  const { rows: broken } = await sql.query(
    `INSERT INTO "Media" (id, "shiftId", kind, status, "storageKeyOriginal",
        bytes, "capturedAt", "clientId", "createdAt")
     VALUES ($1, $2, 'PHOTO', 'PENDING', 'does/not/exist/original.jpg',
             1, (now() AT TIME ZONE 'UTC'), $1, (now() AT TIME ZONE 'UTC'))
     RETURNING id`,
    [`gatebad${Date.now()}`, shiftId],
  );
  const badId = broken[0].id;
  const { rows: badJob } = await sql.query(
    `INSERT INTO "Job" (id, type, payload, status, "runAfter", "updatedAt")
     VALUES ($1, 'PROCESS_MEDIA', $2::jsonb, 'QUEUED',
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
     RETURNING id`,
    [`gatebadjob${Date.now()}`, JSON.stringify({ mediaId: badId })],
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await ctx.request.get(`${BASE}/api/jobs/sweep`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    await sql.query(
      `UPDATE "Job" SET "runAfter" = (now() AT TIME ZONE 'UTC') - interval '1 minute'
       WHERE id = $1`,
      [badJob[0].id],
    );
  }

  const { rows: finalJob } = await sql.query(
    'SELECT status, attempts, "lastError" FROM "Job" WHERE id = $1',
    [badJob[0].id],
  );
  check(
    "a permanently broken job ends FAILED, not looping",
    finalJob[0].status === "FAILED" && finalJob[0].attempts === 5,
    `status=${finalJob[0].status} attempts=${finalJob[0].attempts}`,
  );
  check("the failure is recorded, not swallowed", Boolean(finalJob[0].lastError));

  const { rows: finalMedia } = await sql.query(
    'SELECT status FROM "Media" WHERE id = $1',
    [badId],
  );
  check(
    "the photo says FAILED rather than processing forever",
    finalMedia[0].status === "FAILED",
    `status=${finalMedia[0].status}`,
  );

  const failedShot = await ctx.request.get(`${BASE}/api/media/${badId}?variant=thumb`);
  check(
    "a failed photo 404s instead of serving a missing object",
    failedShot.status() === 404,
    `status=${failedShot.status()}`,
  );

  // ------------------------------------------------------------ isolation
  console.log("\n— isolation —");
  // The seed ships no foreign media, so fabricate one on the OTHER guard in
  // the SAME company. Same-company is the harder case: company scoping alone
  // would let it through, so this proves the route scopes to the guard.
  await sql.query(
    `INSERT INTO "Shift" (id, "siteId", "guardId", "scheduledStart",
       "scheduledEnd", status, "clientId", "createdAt", "updatedAt")
     SELECT $1, a."siteId", u.id, (now() AT TIME ZONE 'UTC'),
            (now() AT TIME ZONE 'UTC') + interval '8 hours', 'SCHEDULED', $1,
            (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
     FROM "User" u
     JOIN "SiteAssignment" a ON a."userId" = u.id
     WHERE u.email = $2
     LIMIT 1
     ON CONFLICT (id) DO NOTHING`,
    [PEER_SHIFT, PEER_EMAIL],
  );
  const { rows: peer } = await sql.query(
    `SELECT s.id AS shift FROM "Shift" s WHERE s.id = $1`,
    [PEER_SHIFT],
  );
  let foreignId = null;
  if (peer[0]) {
    const { rows: made } = await sql.query(
      `INSERT INTO "Media" (id, "shiftId", kind, status, "storageKeyOriginal",
                            bytes, "capturedAt", "clientId", "createdAt")
       VALUES ($1, $2, 'PHOTO', 'PROCESSED', $3, 10, (now() AT TIME ZONE 'UTC'),
               $4, (now() AT TIME ZONE 'UTC'))
       RETURNING id`,
      [`iso${Date.now()}`, peer[0].shift, "peer/original.jpg", `isoc${Date.now()}`],
    );
    foreignId = made[0].id;
  }
  check("a foreign media row exists to attempt", Boolean(foreignId), String(foreignId));
  if (foreignId) {
    const stolen = await ctx.request.get(`${BASE}/api/media/${foreignId}`);
    check(
      "another guard's media is not readable",
      stolen.status() === 404,
      `status=${stolen.status()}`,
    );
    await sql.query('DELETE FROM "Media" WHERE id = $1', [foreignId]);
  }
  await sql.query('DELETE FROM "Shift" WHERE id = $1', [PEER_SHIFT]);

  await sql.query('DELETE FROM "Media" WHERE id = $1', [badId]);
  await browser.close();
  await sql.end();

  console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await sql.end().catch(() => {});
  process.exit(1);
});
