"use client";

/**
 * The browser half of Web Push (section 13).
 *
 * Shared by the Settings toggle and the one-time prompt after a first report
 * send, because a second copy of this is a second chance to get the
 * subscribe/record/rollback ordering wrong — and getting it wrong produces a
 * device that believes it is subscribed and a server that will never send to
 * it, which nobody notices until a report bounces silently.
 */

export type PushSupport = "unsupported" | "denied" | "off" | "on";

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normalised = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function readPushState(publicKey: string | null): Promise<PushSupport> {
  if (
    !publicKey ||
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return existing ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

export type EnableResult =
  { state: "on" } | { state: "denied" } | { state: "off"; error: string | null };

export async function enablePush(publicKey: string | null): Promise<EnableResult> {
  if (!publicKey) return { state: "off", error: null };
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return permission === "denied"
        ? { state: "denied" }
        : { state: "off", error: null };
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      // Required by every browser that implements Push: a subscription that
      // can deliver silently is not allowed to exist.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) {
      // The browser subscribed but we did not record it, so undo the browser
      // half. Leaving it would mean a device that believes it is subscribed
      // and a server that will never send to it.
      await subscription.unsubscribe().catch(() => {});
      return { state: "off", error: "Couldn't save this device. Try again." };
    }
    return { state: "on" };
  } catch {
    return { state: "off", error: "This browser refused the subscription." };
  }
}

export async function disablePush(): Promise<{ ok: boolean }> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe();
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Whether the one-time prompt has already been shown on this device.
 *
 * Device-local rather than per-user in the database, and deliberately: the
 * thing being remembered is "this browser was already asked", and a browser
 * that was denied once can never be asked again by us. Storing it server-side
 * would re-prompt a guard on every device they sign into, which is exactly
 * the behaviour the once-only rule exists to prevent.
 */
const PROMPT_KEY = "transient:push-prompted";

export function pushAlreadyPrompted(): boolean {
  try {
    return window.localStorage.getItem(PROMPT_KEY) === "1";
  } catch {
    // Private mode and locked-down enterprise profiles throw here. Treating a
    // throw as "already asked" errs toward not nagging.
    return true;
  }
}

export function markPushPrompted(): void {
  try {
    window.localStorage.setItem(PROMPT_KEY, "1");
  } catch {
    // Nothing to do. Worst case the prompt shows once more.
  }
}
