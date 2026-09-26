"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * True when the browser reports no connection.
 *
 * `navigator.onLine` is the browser's own answer and is famously optimistic —
 * it says true on a captive portal. It is still the right signal here: this
 * banner tells the guard their work is queued, and a false "you're online" is
 * corrected within one failed sync, while a false "you're offline" would make
 * a working app look broken.
 */
export function useOnlineStatus(): boolean {
  // Start optimistic so the banner never flashes on a healthy cold load.
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

/**
 * The offline state is normal, not an error (principle 3).
 *
 * So the banner is `attention`, never `danger`, and it says what happens next
 * rather than what went wrong. A pending count makes the promise concrete:
 * the guard can see their taps were kept.
 */
export function OfflineBanner({
  pendingCount = 0,
  syncing = false,
  className,
}: {
  pendingCount?: number;
  syncing?: boolean;
  className?: string;
}) {
  const online = useOnlineStatus();

  if (online && pendingCount === 0) return null;

  const offline = !online;

  return (
    <div
      role="status"
      aria-live="polite"
      data-offline-banner={offline ? "offline" : "syncing"}
      data-pending-count={pendingCount}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2.5 text-sm",
        offline ? "bg-attention text-on-attention" : "bg-surface text-text-muted",
        className,
      )}
    >
      {offline ? (
        <CloudOff className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <RefreshCw
          className={cn("size-4 shrink-0", syncing && "animate-spin")}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1">
        {offline
          ? pendingCount > 0
            ? `Offline. ${pendingCount} ${pendingCount === 1 ? "entry" : "entries"} saved, will sync when you're back.`
            : "Offline. Everything you log is saved on this phone."
          : `Syncing ${pendingCount} ${pendingCount === 1 ? "entry" : "entries"}…`}
      </span>
    </div>
  );
}
