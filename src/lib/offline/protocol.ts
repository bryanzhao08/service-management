/**
 * Constants shared by the page and the service worker (section 14).
 *
 * This file is imported from both sides, and the worker is compiled
 * separately, so it must stay free of anything that touches `window`,
 * `document`, or a Node built-in. Its only job is to make sure the two halves
 * agree on a database name and a message type, because when they disagree the
 * symptom is an outbox that silently never drains.
 */

export const OUTBOX_DB = "transient-outbox";
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE = "requests";

/** The Background Sync tag. Ignored by Safari, which has no Background Sync. */
export const SYNC_TAG = "transient-outbox-flush";

/**
 * Messages between the page and the worker.
 *
 * `FLUSH_OUTBOX` goes worker -> page, because the page is the primary drainer
 * (see outbox.ts for why). `OUTBOX_CHANGED` goes page -> page across tabs, so
 * a second tab's banner count does not go stale.
 */
export const MSG_FLUSH_OUTBOX = "transient:flush-outbox";
export const MSG_OUTBOX_CHANGED = "transient:outbox-changed";
export const MSG_SKIP_WAITING = "transient:skip-waiting";

/**
 * One queued write.
 *
 * `id` is the caller's `clientId`, not a generated key, and that is the whole
 * idempotency story: `Entry.clientId`, `Media.clientId` and `Shift.clientId`
 * are all `@unique`, so a request replayed after a flaky network conflicts on
 * the index instead of creating a duplicate note. It also means re-queueing
 * the same write overwrites rather than stacking.
 */
export type OutboxRecord = {
  id: string;
  url: string;
  method: "POST" | "PATCH" | "DELETE";
  body: string;
  createdAt: number;
  attempts: number;
  /** Shown in the banner: "3 notes waiting" reads better than "3 requests". */
  label: string;
};

/**
 * Whether a replayed write should be dropped instead of retried.
 *
 * A 409 means the server already has this `clientId` — the request did land,
 * we just never saw the response. Dropping it is correct and is the normal
 * ending for a write made as the signal died.
 *
 * Any 4xx other than 408 and 429 is the server saying the request is wrong,
 * and wrong does not become right by sending it again. Retrying those forever
 * is how an outbox fills up with a malformed record that blocks everything
 * behind it.
 */
export function isPermanent(status: number): boolean {
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}
