/**
 * Transient's service worker (sections 13 and 14).
 *
 * Plain JavaScript on purpose. Next 16 builds with Turbopack, the Serwist
 * Next plugin injects a webpack config that Turbopack rejects, and switching
 * the whole application's bundler to get a precache manifest is a bad trade —
 * the marketing pages are measured against a Lighthouse target under the
 * bundler they actually ship with. So this file has no build step, no
 * imports, and nothing to go stale between `next build` and deploy.
 *
 * The cost of dropping the precache manifest is smaller than it looks.
 * `/_next/static/**` is content-hashed, so caching it at runtime on first
 * request is equivalent to precaching it, one visit later. A guard opens the
 * app with signal at clock-in and then walks into a basement; by then
 * everything they need is cached.
 *
 * The constants below are duplicated from src/lib/offline/protocol.ts, which
 * this cannot import. tests/unit/service-worker.test.ts reads both files and
 * fails if they drift, so the duplication is pinned rather than trusted.
 */

const VERSION = "v1";
const SHELL_CACHE = `transient-shell-${VERSION}`;
const PAGES_CACHE = `transient-pages-${VERSION}`;
const MEDIA_CACHE = `transient-media-${VERSION}`;
const OFFLINE_URL = "/offline";

/** Mirrors SYNC_TAG in src/lib/offline/protocol.ts. */
const SYNC_TAG = "transient-outbox-flush";
/** Mirrors MSG_FLUSH_OUTBOX in src/lib/offline/protocol.ts. */
const MSG_FLUSH_OUTBOX = "transient:flush-outbox";
/** Mirrors MSG_SKIP_WAITING in src/lib/offline/protocol.ts. */
const MSG_SKIP_WAITING = "transient:skip-waiting";

/** Signed media URLs die; an hour is long enough to scroll a grid, short
 * enough that a guard does not face a wall of broken images. */
const MEDIA_MAX_AGE_MS = 60 * 60 * 1000;
const PAGES_MAX_ENTRIES = 24;
const MEDIA_MAX_ENTRIES = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Only the offline page is precached, and it is precached because it is
      // the one document that is useless if it needs the network to load.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
    })(),
  );
  // Deliberately no skipWaiting(). A new worker that claims a page mid-shift
  // can swap the app out from under someone typing an incident. It waits for
  // an explicit message, or for the next cold start.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, PAGES_CACHE, MEDIA_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("transient-") && !keep.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Evicts oldest-first. Caches are FIFO by insertion, which is close enough. */
async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(
    keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)),
  );
}

function isStatic(url) {
  return (
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/")
  );
}

function isMedia(url) {
  return url.pathname.startsWith("/api/media/");
}

/**
 * Content-hashed assets. Cache first and never revalidate: the hash in the
 * filename is the version, so a cached hit is always correct by construction.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Pages. Network first, because a stale timeline that hides the note a guard
 * just wrote is worse than a slow one. The cache is the parachute, not the
 * default.
 */
async function networkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      void trim(cacheName, maxEntries);
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}

/** Media, with a hand-rolled expiry because signed URLs stop working. */
async function mediaCache(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    const stored = Number(hit.headers.get("x-transient-cached-at") ?? 0);
    if (Date.now() - stored < MEDIA_MAX_AGE_MS) return hit;
    await cache.delete(request);
  }
  const response = await fetch(request);
  if (response.ok) {
    // The timestamp is stamped onto a copy rather than tracked in IndexedDB,
    // so the expiry cannot drift away from the entry it describes.
    const body = await response.clone().blob();
    const headers = new Headers(response.headers);
    headers.set("x-transient-cached-at", String(Date.now()));
    await cache.put(request, new Response(body, { status: response.status, headers }));
    void trim(MEDIA_CACHE, MEDIA_MAX_ENTRIES);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only this origin. A signed S3 PUT or a third-party font must pass straight
  // through; caching a presigned URL would cache its expiry with it.
  if (url.origin !== self.location.origin) return;

  // Never cache an API read. These are the answers the product is sold on —
  // delivery states, notification counts — and a stale one is a lie, not a
  // slow truth. The one exception is media, handled above, because those are
  // immutable bytes behind an expiring URL.
  if (url.pathname.startsWith("/api/") && !isMedia(url)) return;

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isMedia(url)) {
    event.respondWith(mediaCache(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await networkFirst(request, PAGES_CACHE, PAGES_MAX_ENTRIES);
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const fallback = await cache.match(OFFLINE_URL);
          return (
            fallback ??
            new Response("Offline", {
              status: 503,
              headers: { "content-type": "text/plain" },
            })
          );
        }
      })(),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === MSG_SKIP_WAITING) {
    void self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  // A push with no payload, or one that will not parse, is still shown.
  // Chrome revokes the push permission from a worker that receives a push and
  // displays nothing, so swallowing a malformed payload would eventually cost
  // the user every future notification.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Transient";
  const body = payload.body || "Open the app for details.";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-32.png",
      // Tagged by notification id: two different bounces both show, while a
      // re-delivered copy of the same one replaces rather than stacks.
      tag: payload.notificationId || `transient-${Date.now()}`,
      requireInteraction: payload.urgent === true,
      data: { url: payload.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus a tab that is already open rather than leaving a guard with a
      // fourth copy of the app on their phone.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await client.navigate(new URL(target, self.location.origin).toString());
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== SYNC_TAG) return;

  // The worker does not replay the queue itself. The outbox lives in
  // IndexedDB and the page owns its ordering and retry policy; two drainers
  // would race on the same records the moment a phone reconnects with a tab
  // open. So this nudges the page — and on Safari, which never fires this at
  // all, the page's own `online` listener is what does the work.
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window" });
      for (const client of clientList) {
        client.postMessage({ type: MSG_FLUSH_OUTBOX });
      }
    })(),
  );
});
