/**
 * Generates a VAPID key pair for Web Push.
 *
 * Run: pnpm gen:vapid
 *
 * The pair identifies this deployment to the browser push services. Rotating
 * it invalidates every existing subscription — the endpoints stay valid and
 * the pushes start failing authentication — so the script refuses to overwrite
 * keys that are already set unless you say `--force`, and then tells you what
 * that costs.
 *
 * The private key is written to `.env`, which is gitignored. The public key is
 * written twice, once as `VAPID_PUBLIC_KEY` for the server and once as
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` because the browser needs it to subscribe.
 * That duplication is deliberate: `NEXT_PUBLIC_` is a promise that the value
 * ships to every client, and the private key must never be one keystroke away
 * from that prefix.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import webpush from "web-push";

const ENV = path.join(process.cwd(), ".env");
const FORCE = process.argv.includes("--force");

/**
 * Sets a key in a dotenv file, in place.
 *
 * Rewrites the existing line rather than appending, because a duplicated key
 * in a dotenv file is resolved last-wins by some loaders and first-wins by
 * others. Appending would "work" locally and then pick the stale value
 * somewhere else.
 */
function setKey(source: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const existing = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (existing.test(source)) return source.replace(existing, line);
  return `${source.replace(/\n*$/, "")}\n${line}\n`;
}

function currentValue(source: string, key: string): string | null {
  const match = source.match(new RegExp(`^${key}="?([^"\\n]*)"?$`, "m"));
  const value = match?.[1]?.trim();
  return value ? value : null;
}

async function main() {
  let source = "";
  try {
    source = await readFile(ENV, "utf8");
  } catch {
    throw new Error(
      `${ENV} does not exist. Copy .env.example to .env first; this script ` +
        `edits an existing file rather than inventing one, so it cannot ` +
        `silently create a config that is missing everything else.`,
    );
  }

  const already = currentValue(source, "VAPID_PRIVATE_KEY");
  if (already && !FORCE) {
    console.log(
      "VAPID keys are already set in .env. Leaving them alone.\n\n" +
        "Rotating them invalidates every push subscription already stored in\n" +
        "PushSubscription: the endpoints remain valid, so nothing errors at\n" +
        "subscribe time, but every send fails authentication and guards simply\n" +
        "stop being told their report was delivered.\n\n" +
        "If you mean it: pnpm gen:vapid --force, then clear the table.",
    );
    return;
  }

  const { publicKey, privateKey } = webpush.generateVAPIDKeys();

  source = setKey(source, "VAPID_PUBLIC_KEY", publicKey);
  source = setKey(source, "VAPID_PRIVATE_KEY", privateKey);
  source = setKey(source, "NEXT_PUBLIC_VAPID_PUBLIC_KEY", publicKey);
  if (!currentValue(source, "VAPID_SUBJECT")) {
    source = setKey(source, "VAPID_SUBJECT", "mailto:ops@transient.local");
  }
  await writeFile(ENV, source, "utf8");

  // The public key is printed because it is public by definition and useful
  // to paste into a hosting dashboard. The private key is not printed at all:
  // it would land in scrollback, in CI logs, and in whatever captured this
  // terminal. Read it from .env if you need it.
  console.log("Wrote VAPID keys to .env");
  console.log(`  VAPID_PUBLIC_KEY=${publicKey}`);
  console.log("  VAPID_PRIVATE_KEY=<written to .env, not printed>");
  if (already) {
    console.log(
      "\nRotated. Existing rows in PushSubscription are now dead — delete them,\n" +
        "or every send will spend a request discovering that one at a time.",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
