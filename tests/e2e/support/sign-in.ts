import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";
import type { Client } from "pg";

const OUTBOX = path.resolve(".data/outbox");
const DEFAULT_PIN = "4417";

/**
 * Read the most recent magic link out of the console-email outbox.
 *
 * There is no mail provider on a laptop, so the app writes what it would have
 * sent. Reading it back is not a shortcut around auth: the link is the real
 * one, signed by the real callback, and following it sets the real cookie.
 */
async function latestMagicLink(): Promise<string | null> {
  if (!existsSync(OUTBOX)) return null;
  const files = (await readdir(OUTBOX)).filter((f) => f.endsWith(".json")).sort();
  const last = files.at(-1);
  if (!last) return null;
  const raw = JSON.parse(await readFile(path.join(OUTBOX, last), "utf8")) as {
    html?: string;
    text?: string;
  };
  const match = /https?:\/\/[^\s"'<>]*callback[^\s"'<>]*/.exec(
    `${raw.html ?? ""} ${raw.text ?? ""}`,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

/**
 * Sign a seeded user in and leave the page on the dashboard.
 *
 * The PIN is cleared first so a run is repeatable whether or not an earlier
 * one set one. Throwing rather than returning a flag is deliberate: a spec
 * that carried on unauthenticated would assert against the sign-in form and
 * report it as a pass.
 */
export async function signInAs(
  page: Page,
  base: string,
  sql: Client,
  email: string,
  pin = DEFAULT_PIN,
): Promise<void> {
  await rm(OUTBOX, { recursive: true, force: true });
  await sql.query('UPDATE "User" SET "pinHash" = NULL WHERE email = $1', [email]);

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
}
