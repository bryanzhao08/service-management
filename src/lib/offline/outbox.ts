"use client";

import { openDB, type IDBPDatabase } from "idb";

import {
  isPermanent,
  MSG_OUTBOX_CHANGED,
  OUTBOX_DB,
  OUTBOX_DB_VERSION,
  OUTBOX_STORE,
  SYNC_TAG,
  type OutboxRecord,
} from "./protocol";

/**
 * The offline write queue (section 14).
 *
 * **The page drains it, not the service worker.** Background Sync does not
 * exist in Safari, and a guard standing in a stairwell with an iPhone is the
 * exact user this feature is for. A worker-first design would work beautifully
 * on the Android test device and quietly never flush on half the fleet. So the
 * page flushes on `online`, on load, and on visibility; the worker's `sync`
 * event is a bonus that nudges an open page and nothing depends on it.
 *
 * Idempotency is not this layer's invention: every queued write already
 * carries a `clientId` that is `@unique` server-side, so replaying one
 * conflicts rather than duplicating. That is what makes "retry until it
 * sticks" safe to do blindly.
 */

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(OUTBOX_DB, OUTBOX_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = database.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    },
  });
  return dbPromise;
}

/** True when IndexedDB is usable. Private browsing and old WebViews say no. */
export function outboxAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function announce(): void {
  window.dispatchEvent(new CustomEvent(MSG_OUTBOX_CHANGED));
}

/**
 * Queues a write for later.
 *
 * Keyed on the caller's `clientId`, so queueing the same write twice replaces
 * rather than appends. A guard who taps "save" on a note twice while offline
 * gets one note, not two, without the UI having to track it.
 */
export async function enqueue(
  record: Omit<OutboxRecord, "attempts" | "createdAt"> &
    Partial<Pick<OutboxRecord, "createdAt">>,
): Promise<void> {
  const database = await db();
  await database.put(OUTBOX_STORE, {
    ...record,
    createdAt: record.createdAt ?? Date.now(),
    attempts: 0,
  } satisfies OutboxRecord);
  announce();
  void requestBackgroundSync();
}

export async function pending(): Promise<OutboxRecord[]> {
  const database = await db();
  const all = (await database.getAll(OUTBOX_STORE)) as OutboxRecord[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  const database = await db();
  return database.count(OUTBOX_STORE);
}

async function drop(id: string): Promise<void> {
  const database = await db();
  await database.delete(OUTBOX_STORE, id);
}

async function bumpAttempts(record: OutboxRecord): Promise<void> {
  const database = await db();
  await database.put(OUTBOX_STORE, { ...record, attempts: record.attempts + 1 });
}

/**
 * Asks for a Background Sync, and shrugs if the browser has none.
 *
 * Wrapped in a try because `registration.sync` is absent in Safari and
 * throws `NotAllowedError` in Firefox with the permission denied. Neither is
 * a failure of the feature; the page-side flush is what actually carries it.
 */
async function requestBackgroundSync(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = (await navigator.serviceWorker
      .ready) as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await registration.sync?.register(SYNC_TAG);
  } catch {
    // No Background Sync here. Fine.
  }
}

export type FlushResult = {
  sent: number;
  dropped: number;
  remaining: number;
};

let flushing = false;

/**
 * Replays everything queued, oldest first.
 *
 * **Serial, and it stops at the first network failure.** Entries are written
 * in the order a guard walked the building, and a report that lists 02:14
 * before 01:50 is worse than one that is late. Firing them in parallel would
 * also mean a dead network produces N simultaneous timeouts on a phone that is
 * already struggling.
 *
 * Re-entrancy is guarded because `online`, `visibilitychange` and the worker's
 * nudge all fire within a second of each other when a phone leaves a lift.
 */
export async function flush(): Promise<FlushResult> {
  if (flushing) return { sent: 0, dropped: 0, remaining: await pendingCount() };
  flushing = true;
  try {
    const queued = await pending();
    let sent = 0;
    let dropped = 0;

    for (const record of queued) {
      let response: Response;
      try {
        response = await fetch(record.url, {
          method: record.method,
          headers: {
            "content-type": "application/json",
            // Tells the server this is a replay, so a handler can tell a
            // late-arriving duplicate from a live double-submit if it ever
            // needs to. Nothing depends on it today.
            "x-transient-replay": "1",
          },
          body: record.body,
        });
      } catch {
        // Still offline. Leave this one and everything after it alone: the
        // order matters, so skipping ahead would be worse than waiting.
        await bumpAttempts(record);
        break;
      }

      if (response.ok || response.status === 409) {
        // 409 means the server already has this clientId. The write landed and
        // we simply never saw the response, which is the ordinary ending for a
        // request made as the signal died.
        await drop(record.id);
        sent += 1;
        continue;
      }

      if (isPermanent(response.status)) {
        // The server says this request is wrong, and wrong does not become
        // right by sending it again. Dropping it keeps one malformed record
        // from blocking every good write behind it.
        await drop(record.id);
        dropped += 1;
        continue;
      }

      await bumpAttempts(record);
      break;
    }

    announce();
    return { sent, dropped, remaining: await pendingCount() };
  } finally {
    flushing = false;
  }
}

/**
 * Posts a write, queueing it if the network is not there.
 *
 * This is the one function feature code should call. It returns whether the
 * write went out now or went into the queue, so the UI can say "saved" versus
 * "saved, will send" honestly instead of claiming success for both.
 */
export async function postOrQueue(params: {
  url: string;
  clientId: string;
  label: string;
  body: unknown;
  method?: "POST" | "PATCH" | "DELETE";
}): Promise<{ queued: boolean; response: Response | null }> {
  const method = params.method ?? "POST";
  const body = JSON.stringify(params.body);

  // Checking `navigator.onLine` first avoids a guaranteed-doomed request on a
  // phone that already knows it has no radio. It is famously unreliable in the
  // other direction — `true` does not mean reachable — which is why the catch
  // below still has to queue.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await enqueue({
      id: params.clientId,
      url: params.url,
      method,
      body,
      label: params.label,
    });
    return { queued: true, response: null };
  }

  try {
    const response = await fetch(params.url, {
      method,
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status >= 500 || response.status === 429) {
      await enqueue({
        id: params.clientId,
        url: params.url,
        method,
        body,
        label: params.label,
      });
      return { queued: true, response };
    }
    return { queued: false, response };
  } catch {
    await enqueue({
      id: params.clientId,
      url: params.url,
      method,
      body,
      label: params.label,
    });
    return { queued: true, response: null };
  }
}

export { MSG_OUTBOX_CHANGED };
export type { OutboxRecord };
