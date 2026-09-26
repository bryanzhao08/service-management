"use client";

import { Bell, BellRing, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { disablePush, enablePush, readPushState } from "@/lib/push/client";

/**
 * Turns Web Push on for this device (section 13).
 *
 * "This device", not "this account", and the copy says so. A guard who enables
 * notifications on the depot tablet and then carries their own phone gets
 * nothing on the phone, and a toggle labelled as an account setting would make
 * that look like a bug instead of the browser model it is.
 *
 * The permission prompt is only ever raised by a click. Browsers penalise
 * origins that ask on page load, and more to the point a guard who is denied
 * once can never be asked again by us — the block is permanent until they dig
 * through site settings. One prompt, at a moment they asked for it.
 */

type State = "unsupported" | "denied" | "off" | "on" | "working";

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = React.useState<State>("working");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void readPushState(publicKey).then(setState);
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setState("working");
    setError(null);
    const result = await enablePush(publicKey);
    if (result.state === "off" && result.error) setError(result.error);
    setState(result.state);
  }

  async function disable() {
    setState("working");
    setError(null);
    const { ok } = await disablePush();
    if (ok) {
      setState("off");
    } else {
      setError("Couldn't turn them off here. Check browser site settings.");
      setState("on");
    }
  }

  if (state === "unsupported") {
    return (
      <p className="text-sm text-text-muted" data-push-state="unsupported">
        This browser can&rsquo;t show push notifications. You&rsquo;ll still see
        everything in the bell.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-sm text-text-muted" data-push-state="denied">
        Notifications are blocked for this site. Turn them back on in your
        browser&rsquo;s site settings; we can&rsquo;t ask again from here.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-push-state={state}>
      <Button
        type="button"
        variant={state === "on" ? "secondary" : "primary"}
        onClick={state === "on" ? disable : enable}
        disabled={state === "working"}
      >
        {state === "working" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : state === "on" ? (
          <BellRing className="size-4" aria-hidden="true" />
        ) : (
          <Bell className="size-4" aria-hidden="true" />
        )}
        {state === "on" ? "Turn off on this device" : "Notify me on this device"}
      </Button>
      <p className="text-sm text-text-muted">
        {state === "on"
          ? "This device will buzz when a report lands or bounces."
          : "Get told when a report is delivered, or when it bounces and needs a call."}
      </p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
