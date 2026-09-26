import type { JobType } from "@/generated/prisma/enums";
import {
  claimJobs,
  failJob,
  jobCounts,
  markMediaFailed,
  reclaimStuckJobs,
  succeedJob,
  type ClaimedJob,
} from "@/lib/db/jobs";

import { processMedia, processMediaPayload } from "./handlers/process-media";

/**
 * The worker (section 5).
 *
 * Two entry points call this: `after()` on the request that enqueued a job, so
 * the common case is processed within a second or so, and `GET /api/jobs/sweep`
 * on a cron, which catches everything the first path missed — a crashed
 * process, a retry with backoff, a job enqueued while the app was down.
 *
 * The sweep alone would be correct but slow (up to a minute of a grey
 * placeholder in the grid). `after()` alone would be fast but lossy. Both
 * together are why the queue is in Postgres rather than in memory.
 */

type Handler = (payload: unknown) => Promise<unknown>;

/**
 * Handlers by type. Milestones 6, 7, 9 and 10 fill in the rest; a job type with
 * no handler is a configuration error, not a transient failure, so it fails
 * fast to FAILED rather than retrying five times against nothing.
 */
const HANDLERS: Partial<Record<JobType, Handler>> = {
  PROCESS_MEDIA: processMedia,
};

export class UnhandledJobTypeError extends Error {
  constructor(type: string) {
    super(`No handler registered for job type ${type}`);
    this.name = "UnhandledJobTypeError";
  }
}

export type RunSummary = {
  claimed: number;
  succeeded: number;
  failed: number;
  reclaimed: number;
};

async function runOne(job: ClaimedJob): Promise<boolean> {
  const handler = HANDLERS[job.type];
  if (!handler) throw new UnhandledJobTypeError(job.type);
  await handler(job.payload);
  return true;
}

/**
 * Marks the thing a failed job was about, so the UI can say so.
 *
 * A job that has run out of attempts is invisible to a guard unless the row it
 * was processing changes too — the photo would sit on "processing" forever with
 * nothing anywhere saying why.
 */
async function markSubjectFailed(job: ClaimedJob): Promise<void> {
  if (job.type !== "PROCESS_MEDIA") return;
  const parsed = processMediaPayload.safeParse(job.payload);
  if (parsed.success) await markMediaFailed(parsed.data.mediaId);
}

export async function runJobs(
  options: { limit?: number; types?: JobType[]; reclaim?: boolean } = {},
): Promise<RunSummary> {
  const reclaimed = options.reclaim === false ? 0 : await reclaimStuckJobs();
  const jobs = await claimJobs(options.limit ?? 10, options.types);

  let succeeded = 0;
  let failed = 0;

  // Sequential on purpose. These are CPU-bound image encodes on a serverless
  // instance with a small memory ceiling; running ten at once is how a worker
  // gets OOM-killed and leaves ten RUNNING rows for the lease to reclaim.
  for (const job of jobs) {
    try {
      await runOne(job);
      await succeedJob(job.id);
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { retrying } = await failJob(job.id, job.attempts, message);
      if (!retrying) await markSubjectFailed(job);
      failed += 1;
    }
  }

  return { claimed: jobs.length, succeeded, failed, reclaimed };
}

export { jobCounts };
