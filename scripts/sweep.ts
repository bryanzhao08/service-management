/**
 * `pnpm jobs:sweep` (section 21) — runs the sweeper once, locally.
 *
 * The same work the cron does, without needing a cron or the HTTP route. Useful
 * while developing (`after()` does not fire for a request you never made) and
 * as the thing a deploy runs by hand after a backlog builds up.
 */
import { jobCounts, runJobs } from "../src/lib/jobs/runner";
import { applyRetention } from "../src/lib/jobs/retention";

async function main() {
  const limit = Number(process.env["SWEEP_LIMIT"] ?? 25);
  const ran = await runJobs({ limit });
  const retention = await applyRetention();
  const queue = await jobCounts();

  console.log(
    [
      `claimed ${ran.claimed}`,
      `succeeded ${ran.succeeded}`,
      `failed ${ran.failed}`,
      `reclaimed ${ran.reclaimed}`,
      `retention-deleted ${retention.deleted}`,
    ].join(" · "),
  );
  console.log("queue:", JSON.stringify(queue));

  // Non-zero when anything failed, so a CI step or a deploy hook that calls
  // this notices instead of printing a red line into a log nobody reads.
  if (ran.failed > 0 || retention.objectsFailed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
