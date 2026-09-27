"use client";

import { Bell, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  enablePush,
  markPushPrompted,
  pushAlreadyPrompted,
  readPushState,
} from "@/lib/push/client";

/**
 * The one-time ask, raised after a guard's first successful report send
 * (section 13).
 *
 * The timing is the whole design. "Want to know when it's delivered?" is a
 * question a guard has a reason to answer only in the ten seconds after they
 * hit send, while they are still standing there wondering whether it went. Ask
 * on page load and it is an interruption; ask in Settings and nobody goes.
 *
 * It asks once per device, forever, because a browser that is denied once can
 * never be asked again by us — the block is permanent until the guard digs
 * through site settings. Spending that single chance at the only moment the
 * answer is obviously yes is the point.
 */
export function PushPrompt({ publicKey }: { publicKey: string | null }) {
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<"on" | "denied" | null>(null);

  React.useEffect(() => {
    void (async () => {
      if (pushAlreadyPrompted()) return;
      const state = await readPushState(publicKey);
      // Only "off" is a question. Already on needs nothing, denied cannot be
      // undone from here, unsupported has no answer to give.
      if (state !== "off") return;
      setVisible(true);
    })();
  }, [publicKey]);

  if (!visible) return null;

  async function accept() {
    setBusy(true);
    markPushPrompted();
    const outcome = await enablePush(publicKey);
    setBusy(false);
    if (outcome.state === "on") {
      setResult("on");
      return;
    }
    if (outcome.state === "denied") {
      setResult("denied");
      return;
    }
    setVisible(false);
  }

  function decline() {
    // Marked as prompted on decline too. "Not now" from a guard mid-clock-out
    // is an answer, and re-asking next week is how a product earns a
    // permanent block.
    markPushPrompted();
    setVisible(false);
  }

  if (result) {
    return (
      <p className="text-sm text-text-muted" data-push-prompt={result}>
        {result === "on"
          ? "We'll let you know on this device when it lands."
          : "Notifications are blocked for this site. The bell still has everything."}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-push-prompt="asking"
    >
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-text">
            Want to know when it&rsquo;s delivered?
          </p>
          <p className="text-sm text-text-muted">
            We&rsquo;ll buzz this device once every recipient has it, and straight away
            if one bounces.
          </p>
        </div>
        <button
          type="button"
          onClick={decline}
          className="-m-2 shrink-0 rounded p-2 text-text-muted hover:text-text"
          aria-label="Not now"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="md" busy={busy} onClick={accept}>
          Yes, notify me
        </Button>
        <Button type="button" size="md" variant="ghost" onClick={decline}>
          Not now
        </Button>
      </div>
    </div>
  );
}
