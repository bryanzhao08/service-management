/**
 * Milestone 3 gate: walks the real landing page in a real browser.
 *
 * Exists because `next build` proves a page compiles and prerenders, not that
 * it is correct. The auth check in this repo already caught two enumeration
 * bugs that typecheck and build both passed; the same reasoning applies here.
 * Specifically this asserts the things a build cannot see:
 *
 *   - every internal link resolves (a marketing CTA that 404s is the classic
 *     shipped-placeholder defect)
 *   - every referenced icon and the manifest actually exist
 *   - the nine sections from section 7 are present, in order
 *   - one h1, and no skipped heading levels
 *   - tap targets meet 44px, measured with elementFromPoint so an overlay
 *     cannot make a covered control look reachable
 *   - the contact form writes a real Lead row, with a control proving the
 *     assertion can fail
 *
 * Run against a production server:
 *   BASE=http://localhost:3210 node scripts/check-landing.mjs
 */
import "dotenv/config";
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE ?? "http://localhost:3210";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Section 7's nine sections, in the order the spec lists them. */
const SECTIONS = [
  ["hero", "Log the shift"],
  ["problem", "4 AM problem"],
  ["how", "How it works"],
  ["features", "What it does"],
  ["sites", "sites actually differ"],
  ["operations", "For operations teams"],
  ["security", "Security & privacy"],
  ["contact", "per-site pricing"],
  ["footer", "all systems normal"],
];

/** The contact form, scoped so a field lookup cannot escape into the page. */
function contactForm(page) {
  return page.locator("#contact form");
}

async function fillContactForm(page, { name, email }) {
  const form = contactForm(page);
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="company"]').fill("Check Co");
  await form.locator('textarea[name="message"]').fill("12 sites, Word docs today");
}

async function main() {
  // Raw pg, not the Prisma client: src/generated/prisma is TypeScript only, so
  // a .mjs script cannot import it without a build step. check-auth.mjs takes
  // the same route.
  const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await sql.connect();
  const leadCount = async (email) => {
    const res = await sql.query(
      'SELECT COUNT(*)::int AS n FROM "Lead" WHERE email = $1',
      [email],
    );
    return res.rows[0].n;
  };

  const browser = await chromium.launch();
  // iPhone-class viewport: section 7's Lighthouse floor is a mobile one, and a
  // desktop-only pass would hide exactly the overflow this is meant to catch.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const failedRequests = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
  });

  console.log(`\nLanding page check against ${BASE}\n`);

  // --- load -----------------------------------------------------------------
  const response = await page.goto(BASE, { waitUntil: "networkidle" });
  check(
    "landing page returns 200",
    response?.status() === 200,
    `status ${response?.status()}`,
  );

  // --- sections present, in order ------------------------------------------
  const bodyText = await page.locator("body").innerText();
  let lastIndex = -1;
  let inOrder = true;
  for (const [id, needle] of SECTIONS) {
    const index = bodyText.indexOf(needle);
    check(
      `section "${id}" present`,
      index !== -1,
      index === -1 ? `missing "${needle}"` : "",
    );
    if (index !== -1) {
      if (index < lastIndex) inOrder = false;
      lastIndex = index;
    }
  }
  check("sections appear in the order section 7 specifies", inOrder);

  // --- headings -------------------------------------------------------------
  const headings = await page.evaluate(() =>
    [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
      level: Number(h.tagName[1]),
      text: h.textContent?.trim().slice(0, 40) ?? "",
    })),
  );
  const h1s = headings.filter((h) => h.level === 1);
  check("exactly one h1", h1s.length === 1, `found ${h1s.length}`);

  let skipped = null;
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i].level > headings[i - 1].level + 1) {
      skipped = `h${headings[i - 1].level} -> h${headings[i].level} at "${headings[i].text}"`;
      break;
    }
  }
  check(
    "no skipped heading levels",
    skipped === null,
    skipped ?? `${headings.length} headings`,
  );

  // --- every internal link resolves ----------------------------------------
  const hrefs = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
    ),
  ]);
  const internal = hrefs.filter((h) => h.startsWith("/"));
  check(
    "landing page has internal links to check",
    internal.length > 0,
    `${internal.length} unique`,
  );

  for (const href of internal) {
    // Strip a fragment: /#contact is the same document.
    const path = href.split("#")[0] || "/";
    const res = await page.request.get(new URL(path, BASE).toString(), {
      maxRedirects: 0,
    });
    // 200 is fine. A 307 to /sign-in means the proxy gated it, which for a
    // public marketing link is a defect, so it is NOT accepted here.
    check(`link ${href} resolves`, res.status() === 200, `status ${res.status()}`);
  }

  // --- manifest and icons ---------------------------------------------------
  const assetRefs = await page.evaluate(() => {
    const out = [];
    for (const link of document.querySelectorAll(
      'link[rel="manifest"],link[rel~="icon"],link[rel="apple-touch-icon"]',
    )) {
      const href = link.getAttribute("href");
      if (href) out.push(href);
    }
    return [...new Set(out)];
  });
  check(
    "layout references a manifest and icons",
    assetRefs.length >= 2,
    `${assetRefs.length} refs`,
  );
  for (const ref of assetRefs) {
    const res = await page.request.get(new URL(ref, BASE).toString());
    check(`asset ${ref} exists`, res.status() === 200, `status ${res.status()}`);
  }

  // --- tap targets ----------------------------------------------------------
  // elementFromPoint, not getBoundingClientRect: a box can be 44px and still be
  // covered by something else, which is the failure a rect check cannot see.
  const smallTargets = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("a[href], button")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top < 0 || rect.top > window.innerHeight) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const reachable = hit && (el.contains(hit) || hit.contains(el));
      if (!reachable) {
        bad.push(`${el.tagName} "${el.textContent?.trim().slice(0, 24)}" is covered`);
      } else if (rect.height < 44 || rect.width < 44) {
        bad.push(
          `${el.tagName} "${el.textContent?.trim().slice(0, 24)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }
    }
    return bad;
  });
  check(
    "above-the-fold tap targets are >=44px and reachable",
    smallTargets.length === 0,
    smallTargets.join("; "),
  );

  // --- horizontal overflow --------------------------------------------------
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  check(
    "no horizontal overflow at 390px",
    overflow.scroll <= overflow.client,
    `scrollWidth ${overflow.scroll} vs clientWidth ${overflow.client}`,
  );

  // --- contact form writes a Lead ------------------------------------------
  const marker = `check-landing-${Date.now()}@example.com`;
  const before = await leadCount(marker);
  check(
    "lead row does not exist before submit (control)",
    before === 0,
    `count ${before}`,
  );

  await page.locator("#contact").scrollIntoViewIfNeeded();
  // Scoped to the form. A bare getByLabel(/sites/i) matched the
  // <section id="sites" aria-labelledby=...> instead, because a labelled
  // landmark has an accessible name too — a real trap, not a typo.
  await fillContactForm(page, { email: marker, name: "Check Landing" });
  await contactForm(page)
    .getByRole("button", { name: /^send$/i })
    .click();
  await page.waitForTimeout(2500);

  const after = await leadCount(marker);
  check("contact form wrote a Lead row", after === 1, `count ${after}`);

  const confirmation = await page.locator("body").innerText();
  check(
    "form shows a confirmation, not an error",
    /thank|got it|we.ll be in touch|received/i.test(confirmation),
    "",
  );

  // Honeypot: a filled trap must be answered with success and write nothing.
  // Telling the bot author the field was detected teaches them to stop filling
  // it, so the response has to be indistinguishable from a real success.
  //
  // This goes through the real form — an earlier version of this check POSTed
  // to the page URL, which never reaches the server action, so `count === 0`
  // was true no matter what the code did. A honeypot assertion that cannot
  // fail is worse than no honeypot assertion.
  const trapMarker = `check-landing-trap-${Date.now()}@example.com`;
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#contact").scrollIntoViewIfNeeded();
  await fillContactForm(page, { email: trapMarker, name: "Trap Bot" });
  // The trap field is off-screen and tabIndex=-1, so fill it directly.
  await contactForm(page)
    .locator('input[name="website"]')
    .fill("http://spam.example", { force: true });
  await contactForm(page)
    .getByRole("button", { name: /^send$/i })
    .click();
  await page.waitForTimeout(2500);

  const trapCount = await leadCount(trapMarker);
  check("honeypot submission wrote no row", trapCount === 0, `count ${trapCount}`);
  check(
    "honeypot submission still shows success, not an error",
    /thank|that came through/i.test(await page.locator("body").innerText()),
    "",
  );

  await sql.query(`DELETE FROM "Lead" WHERE email LIKE 'check-landing-%'`);

  // --- runtime noise --------------------------------------------------------
  check(
    "no console errors",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join("; "),
  );
  check(
    "no failed network requests",
    failedRequests.length === 0,
    failedRequests.slice(0, 3).join("; "),
  );

  await browser.close();
  await sql.end();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
