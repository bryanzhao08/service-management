import type { JobType } from "@/generated/prisma/enums";

import { prisma } from "./client";

/**
 * The job queue (section 5: "a `Job` table in Postgres plus a worker
 * function").
 *
 * This lives in `lib/db` rather than `lib/jobs` because it is data access, and
 * `lib/db` is the one place the lint rule lets raw Prisma through. The handlers
 * and the worker loop live in `lib/jobs` and call into here.
 *
 * Jobs are deliberately **not** company-scoped. The table has no `companyId`,
 * and a worker sweeping the queue has no session to scope against. That is safe
 * only because a payload is written by trusted server code at enqueue time and
 * never by a request body — every handler re-reads the row it was given and
 * derives the company from the database, not from the payload. Breaking that
 * rule would make the queue a hole straight through section 17.
 */

/** Attempts before a job is left FAILED for a human. */
export const MAX_ATTEMPTS = 5;

/** How long a claimed job may stay RUNNING before the sweeper reclaims it. */
export const LEASE_MS = 5 * 60_000;

const BACKOFF_BASE_MS = 10_000;
const BACKOFF_CAP_MS = 15 * 60_000;

export type ClaimedJob = {
  id: string;
  type: JobType;
  payload: unknown;
  attempts: number;
};

/**
 * Exponential backoff with a cap.
 *
 * Exported because the test asserts the shape of the curve rather than
 * re-deriving it: a retry schedule that silently collapses to "immediately"
 * turns one broken job into a hot loop against whatever it was failing to
 * reach.
 */
export function backoffMs(attempts: number): number {
  const raw = BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(raw, BACKOFF_CAP_MS);
}

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options: { runAfter?: Date } = {},
): Promise<{ id: string }> {
  return prisma.job.create({
    data: {
      type,
      payload: payload as never,
      runAfter: options.runAfter ?? new Date(),
    },
    select: { id: true },
  });
}

/**
 * Every raw comparison against a Prisma `DateTime` uses `now() AT TIME ZONE
 * 'UTC'`, never bare `now()`.
 *
 * Prisma maps `DateTime` to `timestamp without time zone` holding UTC digits,
 * while `now()` is a `timestamptz`. Comparing the two makes Postgres reinterpret
 * the stored digits in the *session* time zone, so on a machine set to
 * `America/Los_Angeles` a job enqueued for right now reads as seven hours in
 * the future and is never claimed. Nothing errors; the queue just silently
 * stops. This bit once already, in the milestone 4 browser gate.
 */

/**
 * Claims up to `limit` runnable jobs and marks them RUNNING.
 *
 * `FOR UPDATE SKIP LOCKED` is the load-bearing part. Two workers running the
 * same query at the same instant would otherwise both read the same QUEUED row
 * and both run it; with SKIP LOCKED the second one steps over the rows the
 * first has locked and takes the next ones instead. The claim and the status
 * write are one statement, so there is no window between reading a row and
 * owning it.
 */
export async function claimJobs(limit = 5, types?: JobType[]): Promise<ClaimedJob[]> {
  // An empty array means "any type". Passing the filter as a parameter rather
  // than splicing it into the SQL keeps this off the injection path even though
  // `types` is typed today — the next caller is the one who gets it from a
  // query string.
  const wanted: string[] = types ?? [];
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));

  // `NOW_UTC`, never bare `now()`. See the note above this function.
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = (now() AT TIME ZONE 'UTC'),
      attempts = attempts + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'QUEUED' AND "runAfter" <= (now() AT TIME ZONE 'UTC')
        AND (cardinality(${wanted}::text[]) = 0
             OR type::text = ANY(${wanted}::text[]))
      ORDER BY "runAfter"
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts`;
}

export async function succeedJob(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: "SUCCEEDED", lockedAt: null, lastError: null },
  });
}

/**
 * Records a failure and either schedules a retry or gives up.
 *
 * Giving up is a real state, not a bug: a job that retries forever hides the
 * fault instead of surfacing it, and every retry costs the same work that
 * already failed.
 */
export async function failJob(
  id: string,
  attempts: number,
  message: string,
): Promise<{ retrying: boolean }> {
  const retrying = attempts < MAX_ATTEMPTS;
  await prisma.job.update({
    where: { id },
    data: {
      status: retrying ? "QUEUED" : "FAILED",
      lockedAt: null,
      // Truncated: a stack trace from a dependency can be tens of kilobytes,
      // and the queue is not a log store.
      lastError: message.slice(0, 2_000),
      ...(retrying ? { runAfter: new Date(Date.now() + backoffMs(attempts)) } : {}),
    },
  });
  return { retrying };
}

/**
 * Returns jobs whose worker died mid-run to the queue.
 *
 * Without this a process that is killed between claiming a job and finishing it
 * leaves the row RUNNING forever, and the job is simply lost — no error, no
 * retry, nothing in the UI. The lease is what makes a crash recoverable.
 */
export async function reclaimStuckJobs(leaseMs = LEASE_MS): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs);
  const { count } = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: cutoff } },
    data: { status: "QUEUED", lockedAt: null },
  });
  return count;
}

export async function jobCounts(): Promise<Record<string, number>> {
  const rows = await prisma.job.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

// ---------------------------------------------------------------------------
// Worker-side reads
// ---------------------------------------------------------------------------
//
// A worker has no session, so it cannot go through `db(actor)`. These live here
// rather than in `lib/jobs` for the same reason the queue does: `lib/db` is the
// one place raw Prisma is allowed, and keeping the exemption to one directory
// is what makes the rule checkable. Each function is deliberately narrow — the
// worker gets exactly the row it was told to process and nothing that would let
// it wander across companies.

export async function mediaForProcessing(mediaId: string) {
  return prisma.media.findFirst({
    where: { id: mediaId },
    select: {
      id: true,
      kind: true,
      status: true,
      storageKeyOriginal: true,
      shift: {
        select: { id: true, siteId: true, site: { select: { companyId: true } } },
      },
    },
  });
}

export async function markMediaProcessed(
  mediaId: string,
  variants: {
    storageKeyThumb?: string | null;
    storageKeyPdf?: string | null;
    width?: number | null;
    height?: number | null;
  } = {},
): Promise<void> {
  await prisma.media.update({
    where: { id: mediaId },
    data: { status: "PROCESSED", ...variants },
  });
}

export async function markMediaFailed(mediaId: string): Promise<void> {
  await prisma.media.updateMany({
    where: { id: mediaId },
    data: { status: "FAILED" },
  });
}
