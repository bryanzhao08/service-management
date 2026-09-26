/**
 * Signing in, for the browser gates. One copy, because there were four and
 * they had already drifted.
 *
 * Two failures live here, and both of them produce a *green* run, which is why
 * they get their own module rather than a comment in each script.
 *
 * 1. The magic link is built from AUTH_URL, not from the base URL the gate is
 *    pointed at. `.env` ships AUTH_URL as :3000. If the server under test is
 *    on :3210 and nobody overrides it, the callback lands on a different
 *    origin, no session cookie is set, and every authenticated assertion
 *    downstream is measuring a sign-in page.
 *
 * 2. Nothing asserted the sign-in worked. The old helper returned a page
 *    object whether or not it had a session, and an unauthenticated page shows
 *    no photo button, no incident button and no recipients — which is
 *    indistinguishable from a feature being correctly restricted. So a broken
 *    sign-in read as a passing access-control test.
 *
 * Both are now refusals: a mismatched origin exits before the browser opens,
 * and a sign-in that does not land on the dashboard throws.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

export const OUTBOX = path.resolve(".data/outbox");
export const DEFAULT_PIN = "4821";

/**
 * Exit unless the auth origin and the origin under test agree.
 *
 * Deliberately a hard exit rather than a failed check. A gate that cannot
 * authenticate has nothing to report, and letting it continue to print PASS
 * lines is worse than printing nothing.
 */
export function requireMatchingAuthOrigin(base) {
  const authUrl = process.env.AUTH_URL ?? "";
  const authOrigin = new URL(authUrl || "http://unset.invalid").origin;
  if (authOrigin === new URL(base).origin) return;

  const port = new URL(base).port || "3210";
  console.error(
    `AUTH_URL (${authUrl || "unset"}) must match the server under test (${base}).\n` +
      `The magic-link callback would be sent to a different origin, so no session\n` +
      `cookie would be set and every authenticated check would silently measure\n` +
      `the sign-in page instead.\n\n` +
      `Start the server with the override:\n` +
      `  AUTH_URL=${base} NEXT_PUBLIC_APP_URL=${base} pnpm start -p ${port}\n` +
      `and run the gate with the same AUTH_URL.`,
  );
  process.exit(1);
}

/** The most recent magic link written to the console-email outbox. */
export async function latestMagicLink() {
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

/**
 * Sign a seeded user in and return an authenticated page.
 *
 * `sql` is an open pg client; the PIN is cleared first so the run is
 * repeatable whether or not a previous one set one.
 */
export async function signIn(browser, email, { base, sql, pin = DEFAULT_PIN }) {
  await rm(OUTBOX, { recursive: true, force: true });
  await sql.query('UPDATE "User" SET "pinHash" = NULL WHERE email = $1', [email]);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);

  const link = await latestMagicLink();
  if (!link) throw new Error(`no magic link was written for ${email}`);
  await page.goto(link, { waitUntil: "domcontentloaded" });

  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/pin")) {
    await page.fill('input[name="pin"]', pin);
    await page.fill('input[name="confirm"]', pin);
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 20_000 }),
      page.click('button[type="submit"]'),
    ]);
  }

  if (!/\/dashboard/.test(page.url())) {
    throw new Error(
      `sign-in for ${email} did not reach the dashboard; landed on ${page.url()}. ` +
        `Check that the server was started with AUTH_URL=${base}.`,
    );
  }
  return { ctx, page };
}
