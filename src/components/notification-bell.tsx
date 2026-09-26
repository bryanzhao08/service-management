"use client";

import { Bell, BellOff } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The notification bell (section 13).
 *
 * Polls rather than holding a socket open. A guard's phone spends the night on
 * a weak signal in a stairwell, and a dropped socket that silently stops
 * reconnecting looks exactly like "no notifications" — which is the one thing
 * this must never fake. A 60s poll is cheap, self-healing, and its failure
 * mode is being a minute late rather than being wrong.
 *
 * Push is the fast path on top; this is the floor under it, and it is the only
 * channel that works at all on a device that refused the permission prompt.
 */

type Item = {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  createdAt: string;
};

const POLL_MS = 60_000;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell({ className }: { className?: string }) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const data = (await response.json()) as { unread: number; items: Item[] };
      setItems(data.items);
      setUnread(data.unread);
      setFailed(false);
    } catch {
      // Offline. The bell says so rather than showing a stale zero, because a
      // zero here means "nothing happened" and that is a claim we cannot make.
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    // `load` is async and touches no state before its first await, so nothing
    // here is a synchronous setState — the rule cannot see through the
    // promise. This is the "subscribe to an external system" case the rule
    // documents as allowed: a poller that needs one immediate read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Opening the panel is the read receipt. Marking on open rather than on
  // click of each row matches what the count is for: it answers "is there
  // anything I have not seen", not "have I actioned everything".
  React.useEffect(() => {
    if (!open || unread === 0) return;
    void (async () => {
      try {
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        setUnread(0);
        setItems((current) => current.map((item) => ({ ...item, read: true })));
      } catch {
        // Stays unread and will be marked on the next open. Better than
        // clearing the badge locally for something the server never recorded.
      }
    })();
  }, [open, unread]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={panelRef} data-notification-bell="" className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // The badge caps at "9+", so the raw count lives here. A gate that
        // reads the rendered text cannot tell 10 from 400.
        data-unread-count={failed ? -1 : unread}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          failed
            ? "Notifications, currently unreachable"
            : unread > 0
              ? `Notifications, ${unread} unread`
              : "Notifications"
        }
        className="relative grid size-11 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface hover:text-text focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        {failed ? (
          <BellOff className="size-5" aria-hidden="true" />
        ) : (
          <Bell className="size-5" aria-hidden="true" />
        )}
        {unread > 0 && !failed ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-on-primary tabular-nums"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="border-rule absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-surface shadow-lg"
        >
          <div className="border-rule border-b px-4 py-3">
            <p className="text-sm font-semibold text-text">Notifications</p>
          </div>

          {failed ? (
            <p className="px-4 py-6 text-sm text-text-muted">
              Can&rsquo;t reach the server right now. This list is not up to date.
            </p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted">
              Nothing yet. You&rsquo;ll hear about deliveries and bounces here.
            </p>
          ) : (
            <ul className="divide-rule max-h-[60vh] divide-y overflow-y-auto">
              {items.map((item) => {
                const content = (
                  <>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-text">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-xs text-text-muted tabular-nums">
                        {timeAgo(item.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-text-muted">
                      {item.body}
                    </span>
                  </>
                );
                return (
                  <li key={item.id} className={cn(!item.read && "bg-bg")}>
                    {item.url ? (
                      <a
                        href={item.url}
                        className="block px-4 py-3 transition-colors hover:bg-bg focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                      >
                        {content}
                      </a>
                    ) : (
                      <div className="px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
