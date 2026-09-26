"use client";

import * as React from "react";

import { OfflineBanner } from "@/components/ui/offline-banner";
import {
  flush,
  MSG_OUTBOX_CHANGED,
  outboxAvailable,
  pendingCount,
} from "@/lib/offline/outbox";
import { MSG_FLUSH_OUTBOX } from "@/lib/offline/protocol";

/**
 * Registers the service worker and keeps the offline banner honest
 * (section 14).
 *
 * This is the only place that decides *when* to drain the outbox, and it
 * listens to four things because no single one of them is reliable:
 *
 * - `online`, which fires on reconnect but lies on captive portals.
 * - `visibilitychange`, which catches the phone coming out of a pocket after
 *   the `online` event was missed because the tab was frozen. On iOS this is
 *   usually the one that actually fires.
 * - a message from the worker's Background Sync, absent on Safari entirely.
 * - a mount, so a cold start with a queue left from last night flushes.
 *
 * Any one of them alone leaves a real fleet with notes stuck in IndexedDB.
 */
export function OfflineProvider() {
  const [count, setCount] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!outboxAvailable()) return;
    try {
      setCount(await pendingCount());
    } catch {
      // A browser that refuses IndexedDB (private mode, some WebViews) gets
      // an app with no queue rather than an app that crashes on load.
    }
  }, []);

  const drain = React.useCallback(async () => {
    if (!outboxAvailable()) return;
    const before = await pendingCount().catch(() => 0);
    if (before === 0) {
      setCount(0);
      return;
    }
    setSyncing(true);
    try {
      const result = await flush();
      setCount(result.remaining);
    } catch {
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  React.useEffect(() => {
    // Same as the bell: `drain` awaits the IndexedDB count before it sets
    // anything, so this is not a synchronous setState. The mount drain is
    // load-bearing — a phone that regained signal while the app was closed
    // has a queue and no `online` event to fire.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void drain();

    const onOnline = () => void drain();
    const onVisible = () => {
      if (document.visibilityState === "visible") void drain();
    };
    const onChanged = () => void refresh();
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === MSG_FLUSH_OUTBOX) {
        void drain();
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener(MSG_OUTBOX_CHANGED, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(MSG_OUTBOX_CHANGED, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [drain, refresh]);

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registered after load rather than during render: on a slow phone the
    // worker's install (which fetches /offline) competes with the page's
    // first paint, and the page has to win.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs offline support, not the app. Browsers
        // also refuse to register over plain http on a non-localhost origin,
        // which is a legitimate way to run a preview build, so this stays
        // silent rather than surfacing an error a guard cannot act on.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return <OfflineBanner pendingCount={count} syncing={syncing} />;
}
