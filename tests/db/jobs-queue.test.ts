import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  backoffMs,
  claimJobs,
  enqueue,
  failJob,
  jobCounts,
  MAX_ATTEMPTS,
  reclaimStuckJobs,
  succeedJob,
} from "@/lib/db/jobs";

import { raw, resetDatabase } from "./helpers";

/**
 * Queue semantics against a real Postgres.
 *
 * None of this is testable with a mock: `FOR UPDATE SKIP LOCKED`, row locks and
 * `now()` are database behaviour, and a fake queue would pass whether or not
 * the real one is safe to run twice.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

describe("claimJobs", () => {
  it("returns a queued job and marks it RUNNING with an attempt spent", async () => {
    const { id } = await enqueue("PROCESS_MEDIA", { mediaId: "m1" });

    const claimed = await claimJobs(5);

    expect(claimed.map((job) => job.id)).toEqual([id]);
    expect(claimed[0]?.attempts).toBe(1);
    expect(claimed[0]?.payload).toEqual({ mediaId: "m1" });

    const row = await raw.job.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("RUNNING");
    expect(row.lockedAt).not.toBeNull();
  });

  it("never hands the same job to two concurrent workers", async () => {
    // Ten jobs, two workers asking for ten each at the same instant. Without
    // SKIP LOCKED the second query blocks on the first's row locks and then
    // returns the *same* ten rows, so every job runs twice — two emails sent,
    // two PDFs billed. This is the control that proves the lock clause is
    // doing something: delete `FOR UPDATE SKIP LOCKED` and this fails.
    const enqueued = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        enqueue("PROCESS_MEDIA", { mediaId: `m${index}` }),
      ),
    );

    const [first, second] = await Promise.all([claimJobs(10), claimJobs(10)]);

    const firstIds = new Set(first.map((job) => job.id));
    const secondIds = new Set(second.map((job) => job.id));
    const overlap = [...firstIds].filter((id) => secondIds.has(id));

    expect(overlap).toEqual([]);
    expect(firstIds.size + secondIds.size).toBe(enqueued.length);
  });

  it("leaves a job alone until its runAfter has passed", async () => {
    const later = await enqueue(
      "PROCESS_MEDIA",
      { mediaId: "later" },
      {
        runAfter: new Date(Date.now() + 60_000),
      },
    );
    const ready = await enqueue("PROCESS_MEDIA", { mediaId: "ready" });

    // Both halves in one test on purpose. Asserting only that the future job is
    // skipped passes just as well when *nothing* is ever claimable, which is
    // exactly the bug the next test exists for.
    expect((await claimJobs(5)).map((job) => job.id)).toEqual([ready.id]);
    expect(await raw.job.findUniqueOrThrow({ where: { id: later.id } })).toMatchObject({
      status: "QUEUED",
    });
  });

  it("claims a job enqueued for right now, whatever the server's time zone", async () => {
    // Regression. Prisma writes `DateTime` into `timestamp without time zone`
    // as UTC digits; bare `now()` is a `timestamptz`, so comparing them
    // reinterprets the stored digits in the session time zone. Under
    // America/Los_Angeles that put every fresh job seven hours in the future
    // and the queue stopped dead with no error anywhere.
    await raw.$executeRawUnsafe(`SET TIME ZONE 'America/Los_Angeles'`);
    const { id } = await enqueue("PROCESS_MEDIA", { mediaId: "now" });

    expect((await claimJobs(5)).map((job) => job.id)).toEqual([id]);

    // And the lease it just wrote must be readable by the reclaimer, which
    // compares against a JavaScript Date. If `lockedAt` were written in local
    // digits it would look seven hours stale and be reclaimed immediately.
    expect(await reclaimStuckJobs(60_000)).toBe(0);
  });

  it("filters by type, and an empty filter means any type", async () => {
    const media = await enqueue("PROCESS_MEDIA", { mediaId: "m" });
    const report = await enqueue("GENERATE_REPORT", { reportId: "r" });

    const onlyReports = await claimJobs(5, ["GENERATE_REPORT"]);
    expect(onlyReports.map((job) => job.id)).toEqual([report.id]);

    const anything = await claimJobs(5, []);
    expect(anything.map((job) => job.id)).toEqual([media.id]);
  });

  it("does not claim a job that is already running", async () => {
    await enqueue("PROCESS_MEDIA", { mediaId: "m" });
    expect(await claimJobs(5)).toHaveLength(1);
    expect(await claimJobs(5)).toEqual([]);
  });
});

describe("failJob", () => {
  it("re-queues with a future runAfter while attempts remain", async () => {
    const { id } = await enqueue("PROCESS_MEDIA", { mediaId: "m" });
    const [claimed] = await claimJobs(1);

    const { retrying } = await failJob(id, claimed!.attempts, "boom");

    expect(retrying).toBe(true);
    const row = await raw.job.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("QUEUED");
    expect(row.lastError).toBe("boom");
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
    // Backed off, so an immediate sweep does not pick it straight back up.
    expect(await claimJobs(5)).toEqual([]);
  });

  it("gives up at MAX_ATTEMPTS rather than retrying forever", async () => {
    const { id } = await enqueue("PROCESS_MEDIA", { mediaId: "m" });

    const { retrying } = await failJob(id, MAX_ATTEMPTS, "still broken");

    expect(retrying).toBe(false);
    const row = await raw.job.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("FAILED");
  });

  it("truncates a huge error instead of storing it whole", async () => {
    const { id } = await enqueue("PROCESS_MEDIA", { mediaId: "m" });
    await failJob(id, 1, "x".repeat(50_000));
    const row = await raw.job.findUniqueOrThrow({ where: { id } });
    expect(row.lastError).toHaveLength(2_000);
  });
});

describe("reclaimStuckJobs", () => {
  it("returns a job whose worker died mid-run", async () => {
    const { id } = await enqueue("PROCESS_MEDIA", { mediaId: "m" });
    await claimJobs(1);

    // Nothing reclaims a lease that has not expired.
    expect(await reclaimStuckJobs(60_000)).toBe(0);

    // Pretend the process was killed six minutes ago.
    await raw.job.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - 6 * 60_000) },
    });

    expect(await reclaimStuckJobs()).toBe(1);
    const claimed = await claimJobs(5);
    expect(claimed.map((job) => job.id)).toEqual([id]);
    // The attempt the dead worker spent is still counted, so a job that
    // reliably kills its worker cannot loop forever.
    expect(claimed[0]?.attempts).toBe(2);
  });
});

describe("jobCounts", () => {
  it("reports one bucket per status", async () => {
    await enqueue("PROCESS_MEDIA", { mediaId: "a" });
    const done = await enqueue("PROCESS_MEDIA", { mediaId: "b" });
    await claimJobs(5, ["PROCESS_MEDIA"]);
    await succeedJob(done.id);

    const counts = await jobCounts();
    expect(counts["SUCCEEDED"]).toBe(1);
    expect(counts["RUNNING"]).toBe(1);
  });
});

/**
 * The retry curve is asserted rather than re-derived.
 *
 * A backoff that silently collapses to "immediately" turns one broken job into
 * a hot loop against whatever it was failing to reach — an S3 bucket, an email
 * provider, a database. That failure is invisible in a passing suite and very
 * visible on a bill, so the shape of the curve is pinned here.
 */
describe("backoffMs", () => {
  it("starts at ten seconds and doubles", () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(3)).toBe(40_000);
    expect(backoffMs(4)).toBe(80_000);
  });

  it("is never zero, so a failing job can never hot-loop", () => {
    for (let attempts = 0; attempts <= MAX_ATTEMPTS + 3; attempts += 1) {
      expect(backoffMs(attempts)).toBeGreaterThanOrEqual(10_000);
    }
  });

  it("caps at fifteen minutes rather than growing without bound", () => {
    expect(backoffMs(20)).toBe(15 * 60_000);
    expect(backoffMs(100)).toBe(15 * 60_000);
  });

  it("is monotonic up to the cap", () => {
    for (let attempts = 1; attempts < 12; attempts += 1) {
      expect(backoffMs(attempts + 1)).toBeGreaterThanOrEqual(backoffMs(attempts));
    }
  });
});
