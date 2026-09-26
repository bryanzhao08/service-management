import { z } from "zod";

import { recipientForVerification } from "@/lib/db/recipients";
import { getEmailProvider } from "@/lib/email/provider";
import { verifyRecipientEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/url";

/**
 * `VERIFY_RECIPIENT` (section 9.8).
 *
 * Asks an address to confirm it is real, so that a bounce three months from
 * now is a surprise rather than the normal state of a list nobody checks.
 *
 * The job reads the token from the row instead of carrying it in the payload.
 * That matters because the queue retries: if the token were in the payload, a
 * retry would mail a link that "Re-verify all" had already replaced, and the
 * recipient would click a dead link through no fault of their own. Reading it
 * at send time means the most recent token is always the one in the mail.
 */

export const verifyRecipientPayload = z.object({ recipientId: z.string().min(1) });

export type VerifyRecipientResult = {
  recipientId: string;
  result: "sent" | "gone" | "already-verified" | "no-token";
};

export async function verifyRecipient(
  payload: unknown,
): Promise<VerifyRecipientResult> {
  const { recipientId } = verifyRecipientPayload.parse(payload);

  const recipient = await recipientForVerification(recipientId);

  // Deleted between enqueue and run. Not an error: a manager removing a
  // recipient they just added is a normal thing to do, and failing the job
  // would put a red row on the admin queue for a correct outcome.
  if (!recipient) return { recipientId, result: "gone" };
  if (recipient.status === "VERIFIED") {
    return { recipientId, result: "already-verified" };
  }
  if (!recipient.verifyToken) return { recipientId, result: "no-token" };

  const message = verifyRecipientEmail({
    to: recipient.email,
    name: recipient.name,
    siteName: recipient.site.name,
    companyName: recipient.site.company.name,
    url: appUrl(`/confirm/${recipient.verifyToken}`),
  });

  await getEmailProvider().send(message);
  return { recipientId, result: "sent" };
}
