import { after } from "next/server";

import type { JobType } from "@/generated/prisma/enums";
import { enqueue } from "@/lib/db/jobs";

import { runJobs } from "./runner";

/**
 * Enqueue plus an immediate nudge (section 5: "trigger immediate processing
 * with Next.js `after()`").
 *
 * `after()` runs the callback once the response has been sent, so the caller
 * gets their 200 at upload speed and the encode happens behind it. The row is
 * already committed before the nudge, so if the instance is torn down before
 * the callback runs the job is simply picked up by the next sweep — the nudge
 * is an optimisation, never the delivery guarantee.
 */
export async function enqueueAndKick(
  type: JobType,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const job = await enqueue(type, payload);
  after(async () => {
    try {
      // Only this type, and only a couple: the point is to finish *this* job
      // quickly, not to turn every upload request into a queue drain.
      await runJobs({ limit: 2, types: [type], reclaim: false });
    } catch (error) {
      // Swallowed deliberately. The response is already sent, so throwing here
      // would only produce an unhandled rejection; the job stays QUEUED and the
      // sweep is the backstop.
      console.error("job kick failed", error);
    }
  });
  return job;
}
