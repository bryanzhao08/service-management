import { sentDeliveriesOlderThan } from "@/lib/db/deliveries";
import { isConsoleEmail } from "@/lib/email/provider";
import { handleResendEvent } from "@/lib/email/webhook";

/**
 * In console mode, play the part of the mail provider.
 *
 * There is no Resend account on a laptop, so nothing ever posts a webhook and
 * every delivery sits at SENT forever. That makes the delivery half of the
 * product -- the half the whole thing is sold on -- invisible on any machine
 * without a verified sending domain, including the one the demo runs on.
 *
 * It is not a fake result: the row goes through `handleResendEvent`, the same
 * function the real webhook calls, so the state machine, the terminal-state
 * guard and the report rollup are all genuinely exercised. The only thing
 * skipped is signature verification, and `isConsoleEmail()` means this cannot
 * run at all once a real key is configured.
 */

/**
 * Long enough that a delivery is visibly pending first -- a status that flips
 * to DELIVERED in the same breath as the send teaches a demo audience nothing
 * about what the product actually tracks.
 */
export const CONFIRM_AFTER_MS = 20_000;

export async function confirmConsoleDeliveries(now = new Date()): Promise<number> {
  if (!isConsoleEmail()) return 0;

  const cutoff = new Date(now.getTime() - CONFIRM_AFTER_MS);
  const due = await sentDeliveriesOlderThan(cutoff);

  let confirmed = 0;
  for (const messageId of due) {
    const outcome = await handleResendEvent({
      type: "email.delivered",
      created_at: now.toISOString(),
      data: { email_id: messageId },
    });
    if ("matched" in outcome && outcome.matched) confirmed += 1;
  }
  return confirmed;
}
