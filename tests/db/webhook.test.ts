import { beforeEach, describe, expect, it } from "vitest";

import { raw, resetDatabase, createTenant } from "./helpers";

import { createDeliveries, markDeliverySent } from "@/lib/db/deliveries";
import { handleResendEvent } from "@/lib/email/webhook";
import { confirmConsoleDeliveries, CONFIRM_AFTER_MS } from "@/lib/jobs/confirm-console";

/**
 * The webhook is where the product's central claim lives: "the report reached
 * this person's inbox at this time". Everything here is about the ways that
 * claim can be quietly wrong -- an event we misread, an event for a row we no
 * longer have, an event we credit to the wrong delivery.
 */

async function seedSentDelivery(slug: string, messageId: string) {
  const t = await createTenant(slug);
  // Report hangs off the shift, not the company: company is always derived
  // through the shift so a report cannot disagree with the shift it describes.
  const report = await raw.report.create({
    data: {
      shiftId: t.shift.id,
      status: "READY",
      storageKey: `reports/${slug}.pdf`,
      generatedById: t.guard.id,
    },
  });
  const recipient = await raw.recipient.create({
    data: {
      siteId: t.site.id,
      email: `client@${slug}.test`,
      name: "Client",
      roleLabel: "Property manager",
      required: true,
    },
  });
  const [delivery] = await createDeliveries(report.id, [recipient]);
  await markDeliverySent(delivery!.id, messageId);
  return { ...t, report, recipient, delivery: delivery! };
}

describe("handleResendEvent", () => {
  beforeEach(resetDatabase);

  it("moves a sent delivery to delivered", async () => {
    const { delivery } = await seedSentDelivery("wh-ok", "msg-ok");

    const outcome = await handleResendEvent({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-ok" },
    });

    expect(outcome).toMatchObject({ ok: true, matched: true, status: "DELIVERED" });
    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("DELIVERED");
  });

  it("ignores an event type it does not know", async () => {
    const { delivery } = await seedSentDelivery("wh-unknown", "msg-unknown");

    const outcome = await handleResendEvent({
      type: "email.opened",
      data: { email_id: "msg-unknown" },
    });

    // Opens are not delivery. Treating one as proof of receipt would let an
    // image proxy prefetching the message look like the client read it.
    expect(outcome).toMatchObject({ ok: true, ignored: "email.opened" });
    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("SENT");
  });

  it("does not write `sent` back over a delivery that already landed", async () => {
    const { delivery } = await seedSentDelivery("wh-replay", "msg-replay");
    await handleResendEvent({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-replay" },
    });

    const outcome = await handleResendEvent({
      type: "email.sent",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-replay" },
    });

    expect(outcome).toMatchObject({ ignored: "email.sent" });
    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("DELIVERED");
  });

  it("answers ok for a message id it has never seen", async () => {
    // A webhook for a report deleted under retention. Answering anything other
    // than ok makes the provider retry it forever.
    const outcome = await handleResendEvent({
      type: "email.delivered",
      data: { email_id: "msg-that-never-existed" },
    });
    expect(outcome).toEqual({ ok: true, matched: false });
  });

  it("keeps the provider's bounce reason, not a generic one", async () => {
    const { delivery } = await seedSentDelivery("wh-bounce", "msg-bounce");

    await handleResendEvent({
      type: "email.bounced",
      created_at: new Date().toISOString(),
      data: {
        email_id: "msg-bounce",
        bounce: { message: "550 5.1.1 recipient does not exist" },
      },
    });

    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("BOUNCED");
    // The operator has to act on this. "Bounced" alone does not tell them
    // whether to retype the address or ring the client.
    expect(row?.bounceReason).toContain("550 5.1.1");
  });

  it("falls back to the bounce type when there is no message", async () => {
    const { delivery } = await seedSentDelivery("wh-btype", "msg-btype");

    await handleResendEvent({
      type: "email.bounced",
      data: {
        email_id: "msg-btype",
        bounce: { type: "Permanent", subType: "Suppressed" },
      },
    });

    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.bounceReason).toBe("Permanent / Suppressed");
  });

  it("survives a malformed timestamp instead of storing an invalid date", async () => {
    const { delivery } = await seedSentDelivery("wh-baddate", "msg-baddate");

    await handleResendEvent({
      type: "email.delivered",
      created_at: "not-a-date",
      data: { email_id: "msg-baddate" },
    });

    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("DELIVERED");
    expect(row?.statusAt).toBeInstanceOf(Date);
    expect(Number.isNaN(row!.statusAt!.getTime())).toBe(false);
  });

  it("credits the event to the message id, never to the address", async () => {
    // Two sites, same client address. Matching on email would mark both.
    const a = await seedSentDelivery("wh-a", "msg-a");
    const b = await seedSentDelivery("wh-b", "msg-b");
    await raw.recipient.update({
      where: { id: b.recipient.id },
      data: { email: a.recipient.email },
    });

    await handleResendEvent({
      type: "email.delivered",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-a" },
    });

    const rowA = await raw.reportDelivery.findUnique({ where: { id: a.delivery.id } });
    const rowB = await raw.reportDelivery.findUnique({ where: { id: b.delivery.id } });
    expect(rowA?.status).toBe("DELIVERED");
    expect(rowB?.status).toBe("SENT");
  });
});

describe("confirmConsoleDeliveries", () => {
  beforeEach(resetDatabase);

  it("leaves a delivery alone until it has been pending long enough", async () => {
    const { delivery } = await seedSentDelivery("cc-early", "msg-early");

    const confirmed = await confirmConsoleDeliveries(new Date());

    expect(confirmed).toBe(0);
    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("SENT");
  });

  it("confirms one that has waited, through the real webhook path", async () => {
    const { delivery } = await seedSentDelivery("cc-late", "msg-late");

    const later = new Date(Date.now() + CONFIRM_AFTER_MS + 1_000);
    const confirmed = await confirmConsoleDeliveries(later);

    expect(confirmed).toBe(1);
    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("DELIVERED");
  });

  it("does not resurrect a bounced delivery", async () => {
    const { delivery } = await seedSentDelivery("cc-bounced", "msg-bounced");
    await handleResendEvent({
      type: "email.bounced",
      created_at: new Date().toISOString(),
      data: { email_id: "msg-bounced", bounce: { message: "hard bounce" } },
    });

    const later = new Date(Date.now() + CONFIRM_AFTER_MS + 1_000);
    await confirmConsoleDeliveries(later);

    const row = await raw.reportDelivery.findUnique({ where: { id: delivery.id } });
    expect(row?.status).toBe("BOUNCED");
  });
});
