"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/guards";
import {
  clearPin,
  clearPinAttempts,
  pinAttemptStatus,
  pinSchema,
  recordPinFailure,
  setPin,
  verifyPin,
} from "@/lib/auth/pin";
import { grantUnlock, revokeUnlock } from "@/lib/auth/unlock";

export type PinState = { error: string | null };

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** First time on a device: set the PIN and unlock immediately. */
export async function submitSetPin(
  _prev: PinState,
  formData: FormData,
): Promise<PinState> {
  const actor = await requireActor();

  const parsed = pinSchema.safeParse(formData.get("pin"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid PIN" };
  }
  if (formData.get("confirm") !== parsed.data) {
    return { error: "The two PINs do not match" };
  }

  await setPin(actor.userId, parsed.data);
  await grantUnlock(actor.userId);
  redirect("/dashboard");
}

export async function submitVerifyPin(
  _prev: PinState,
  formData: FormData,
): Promise<PinState> {
  const actor = await requireActor();

  const status = pinAttemptStatus(actor.userId);
  if (status.locked) {
    return {
      error: `Too many attempts. Try again in ${minutes(status.retryAfterMs)} minutes, or use "Forgot PIN".`,
    };
  }

  const raw = formData.get("pin");
  const ok = typeof raw === "string" && (await verifyPin(actor.userId, raw));

  if (!ok) {
    recordPinFailure(actor.userId);
    const after = pinAttemptStatus(actor.userId);
    return {
      error: after.locked
        ? `Too many attempts. Try again in ${minutes(after.retryAfterMs)} minutes, or use "Forgot PIN".`
        : `Incorrect PIN. ${after.remaining} ${after.remaining === 1 ? "try" : "tries"} left.`,
    };
  }

  clearPinAttempts(actor.userId);
  await grantUnlock(actor.userId);
  redirect("/dashboard");
}

/**
 * "Forgot PIN" re-runs the magic link (section 8). The PIN is cleared first, so
 * a guard who has forgotten it is not locked behind a screen they cannot pass
 * after the email signs them back in.
 */
export async function forgotPin(): Promise<void> {
  const actor = await requireActor();
  await clearPin(actor.userId);
  clearPinAttempts(actor.userId);
  await revokeUnlock();
  redirect("/api/auth/signout?callbackUrl=/sign-in");
}

/** Skip for now. The device stays unlocked for this session's cookie life. */
export async function skipPin(): Promise<void> {
  const actor = await requireActor();
  await grantUnlock(actor.userId);
  redirect("/dashboard");
}
