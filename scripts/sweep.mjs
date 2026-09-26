/**
 * Drain the job queue.
 *
 * This used to import the handlers directly and had never run: the PDF
 * builder pulls in `@react-pdf/textkit`, which imports
 * `@react-pdf/hyphenate/en-us`, and that package's `exports` map declares no
 * `require` condition. Node refuses the subpath outside Next's bundler, so
 * `pnpm jobs:sweep` failed on import every time.
 *
 * Driving the HTTP route instead fixes that and removes a second execution
 * path. Production drains the queue by pointing a cron at this same endpoint,
 * so a local sweep and a deployed sweep are now the same code doing the same
 * work, rather than two implementations that can drift.
 *
 * Loops until the queue reports nothing claimed, because building a report
 * enqueues the send, and confirming the send is a later tick again.
 */
import "dotenv/config";

const BASE =
  process.env.SWEEP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
const MAX_PASSES = 12;

if (!SECRET) {
  console.error(
    "CRON_SECRET is not set. The sweep route fails closed without it — set it in .env.",
  );
  process.exit(1);
}

let pass = 0;
let total = 0;

while (pass < MAX_PASSES) {
  pass += 1;

  let res;
  try {
    res = await fetch(`${BASE}/api/jobs/sweep`, {
      headers: { authorization: `Bearer ${SECRET}` },
    });
  } catch {
    console.error(
      `Could not reach ${BASE}. Start the app first (pnpm dev), or set SWEEP_URL.`,
    );
    process.exit(1);
  }

  if (res.status === 401) {
    console.error(
      "The sweep route rejected CRON_SECRET. Check .env matches the running server.",
    );
    process.exit(1);
  }
  if (!res.ok) {
    // A 404 here almost always means SWEEP_URL points at some other app that
    // happens to be on that port. Dumping its HTML at the reader helps nobody,
    // so say what was wrong with the address instead of what it replied.
    const body = (await res.text()).trim();
    const looksLikeHtml = body.startsWith("<");
    console.error(
      `Sweep failed: ${res.status} from ${BASE}/api/jobs/sweep` +
        (looksLikeHtml
          ? `\nThat responded with a web page, not this app's API. Something else is` +
            `\nprobably listening on that port. Set SWEEP_URL to the Transient server,` +
            `\ne.g. SWEEP_URL=http://localhost:3210 pnpm jobs:sweep`
          : `\n${body.slice(0, 400)}`),
    );
    process.exit(1);
  }

  const body = await res.json();
  total += body.succeeded ?? 0;

  console.log(
    `pass ${pass}: claimed ${body.claimed}, ok ${body.succeeded}, failed ${body.failed}` +
      `, deliveries confirmed ${body.deliveries?.confirmed ?? 0}`,
  );

  if (body.failed > 0) {
    // Surface it rather than looping a poison job to the cap. Queue failures
    // retry on their own schedule; a sweep that quietly spins looks like work.
    console.error(`${body.failed} job(s) failed this pass — see the server log.`);
  }

  // Nothing claimed and nothing confirmed means the queue is genuinely idle.
  if ((body.claimed ?? 0) === 0 && (body.deliveries?.confirmed ?? 0) === 0) break;
}

console.log(`Queue idle after ${pass} pass(es); ${total} job(s) completed.`);
