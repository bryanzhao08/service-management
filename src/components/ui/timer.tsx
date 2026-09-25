"use client";

import * as React from "react";

import { cn, formatClock, formatDuration } from "@/lib/utils";

/**
 * One clock for the whole app.
 *
 * Two decisions here are load-bearing:
 *
 * 1. Every tick re-reads `Date.now()` rather than incrementing a counter. An
 *    interval in a backgrounded mobile tab is throttled or suspended, so a
 *    counter drifts low by however long the phone was in the guard's pocket,
 *    which on a twelve-hour shift is most of it.
 *
 * 2. It is a `useSyncExternalStore` source, not `useState` + `useEffect`. The
 *    clock is external mutable state; reading it with an effect means a
 *    cascading render on mount, and `getServerSnapshot` is the supported way
 *    to render a stable placeholder on the server instead of a timestamp that
 *    is guaranteed not to match the client's.
 */
function createClock(intervalMs: number) {
  let now: number | null = null;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () => {
    now = Date.now();
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        now = Date.now();
        timer = setInterval(tick, intervalMs);
        // Coming back from a locked screen must correct immediately, not on
        // the next scheduled tick.
        document.addEventListener("visibilitychange", tick);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          document.removeEventListener("visibilitychange", tick);
        }
      };
    },
    // Must return a cached value, never a fresh `Date.now()`: React compares
    // snapshots by identity and a new number every call is an infinite loop.
    getSnapshot: () => now,
    getServerSnapshot: () => null,
  };
}

const clock = createClock(1000);

/** Current epoch ms, or null before the client has mounted. */
export function useNow(): number | null {
  return React.useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    clock.getServerSnapshot,
  );
}

/** Time elapsed since `since`. Used by the shift header. */
export function ElapsedTimer({
  since,
  until,
  className,
  label = "Time on shift",
}: {
  since: Date | string | number;
  /** Freeze at this point instead of the current time (a closed shift). */
  until?: Date | string | number | null;
  className?: string;
  label?: string;
}) {
  const start = new Date(since).getTime();
  const frozen = until ? new Date(until).getTime() : null;
  const now = useNow();
  const end = frozen ?? now;

  return (
    <time
      // No dateTime: this is a duration, not an instant.
      aria-label={label}
      className={cn("tabular-nums", className)}
      suppressHydrationWarning
    >
      {end === null ? "--:--:--" : formatClock(Math.max(0, end - start))}
    </time>
  );
}

/**
 * Counts down to `target`. Goes `attention` in the last `warnAtMs`, then
 * `danger` and negative once it passes.
 */
export function Countdown({
  target,
  warnAtMs = 5 * 60 * 1000,
  className,
  label = "Time remaining",
}: {
  target: Date | string | number;
  warnAtMs?: number;
  className?: string;
  label?: string;
}) {
  const deadline = new Date(target).getTime();
  const now = useNow();
  const remaining = now === null ? null : deadline - now;

  return (
    <time
      aria-label={label}
      className={cn(
        "tabular-nums",
        remaining !== null && remaining <= 0 && "text-danger",
        remaining !== null &&
          remaining > 0 &&
          remaining <= warnAtMs &&
          "text-attention",
        className,
      )}
      suppressHydrationWarning
    >
      {remaining === null
        ? "--:--"
        : remaining <= 0
          ? `-${formatDuration(-remaining, { hideSeconds: true })}`
          : formatDuration(remaining, { hideSeconds: true })}
    </time>
  );
}
