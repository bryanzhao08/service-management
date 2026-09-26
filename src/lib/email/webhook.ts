import type { DeliveryStatus } from "@/generated/prisma/enums";
import { applyDeliveryWebhook } from "@/lib/db/deliveries";
import { notifyDelivery } from "@/lib/jobs/notify-delivery";

/**
 * The body of the Resend webhook, minus signature verification.
 *
 * It lives here rather than in the route so the dev simulator can drive the
 * exact same code. A simulator with its own copy of this logic would prove
 * only that the simulator works.
 */

/**
 * Resend event names to our own status.
 *
 * `email.sent` is deliberately absent: we set SENT ourselves at the moment the
 * API accepted the message, and letting a webhook write it back would let a
 * replayed `sent` overwrite a `delivered` that already arrived.
 */
export const EVENT_STATUS: Record<string, DeliveryStatus> = {
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "DELAYED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.failed": "FAILED",
};

export type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    bounce?: { message?: string; type?: string; subType?: string };
    reason?: string;
  };
};

export type WebhookOutcome =
  | { ok: true; ignored: string }
  | { ok: true; matched: false }
  | {
      ok: true;
      matched: true;
      status: DeliveryStatus;
      reportStatus: string;
      complete: boolean;
    };

export async function handleResendEvent(event: ResendEvent): Promise<WebhookOutcome> {
  const status = event.type ? EVENT_STATUS[event.type] : undefined;
  const messageId = event.data?.email_id;
  if (!status || !messageId) {
    return { ok: true, ignored: event.type ?? "unknown" };
  }

  const parsed = event.created_at ? new Date(event.created_at) : new Date();
  const at = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const reason = bounceReason(event);

  const applied = await applyDeliveryWebhook({
    providerMessageId: messageId,
    status,
    at,
    ...(reason ? { bounceReason: reason } : {}),
  });

  // Not an error. An unknown message id is a webhook for a report we deleted
  // under retention, and a terminal row is a provider retrying something we
  // already recorded. Both are normal and both must answer 200.
  if (!applied) return { ok: true, matched: false };

  const outcome = await notifyDelivery(applied);
  return { ok: true, matched: true, status, ...outcome };
}

function bounceReason(event: ResendEvent): string | undefined {
  const bounce = event.data?.bounce;
  if (bounce?.message) return bounce.message;
  if (bounce?.type) {
    return [bounce.type, bounce.subType].filter(Boolean).join(" / ");
  }
  return event.data?.reason;
}
