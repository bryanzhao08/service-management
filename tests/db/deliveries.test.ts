import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  allRequiredDelivered,
  applyDeliveryWebhook,
  createDeliveries,
  deliveriesForReport,
  expireUnconfirmed,
  markDeliveryFailed,
  markDeliverySent,
  UNCONFIRMED_AFTER_MS,
} from "@/lib/db/deliveries";
import { handleResendEvent } from "@/lib/email/webhook";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * The delivery lifecycle, against a real database.
 *
 * This is the half of the product a customer is actually buying. "We emailed
 * it" is what every incumbent already claims; "it reached this address at
 * 06:04, and this other one bounced" is the difference. A mocked provider
 * would prove the function was called, which was never in doubt -- the
 * questions here are whether a replayed webhook can resurrect a dead address,
 * whether a reordered one can walk a status backwards, and whether a slow
 * optional recipient holds up the guard. All three are database questions.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

async function scenario(slug: string) {
  const tenant = await createTenant(slug);

  const primary = await raw.recipient.create({
    data: {
      siteId: tenant.site.id,
      email: `client@${slug}.test`,
      name: "Client Contact",
      roleLabel: "Property Manager",
      required: true,
    },
  });

  const optional = await raw.recipient.create({
    data: {
      siteId: tenant.site.id,
      email: `cc@${slug}.test`,
      name: "Regional Manager",
      roleLabel: "Regional Manager",
      required: false,
    },
  });

  const report = await raw.report.create({
    data: {
      shiftId: tenant.shift.id,
      status: "READY",
      storageKey: `reports/${slug}.pdf`,
      generatedById: tenant.guard.id,
    },
  });

  return { ...tenant, primary, optional, report };
}

describe("delivery rows", () => {
  it("creates one row per recipient and is idempotent on re-run", async () => {
    const { report, primary, optional } = await scenario("del-a");

    const first = await createDeliveries(report.id, [primary, optional]);
    expect(first).toHaveLength(2);

    // The send job is retried by the queue. A second pass must not create a
    // second set of rows, or a retry would double-count every delivery.
    const second = await createDeliveries(report.id, [primary, optional]);
    expect(second).toHaveLength(2);
    expect(new Set(second.map((d) => d.id))).toEqual(new Set(first.map((d) => d.id)));
  });

  it("denormalises the email so a deleted recipient still has a receipt", async () => {
    const { report, primary } = await scenario("del-b");
    await createDeliveries(report.id, [primary]);
    await raw.recipient.delete({ where: { id: primary.id } });

    const rows = await deliveriesForReport(report.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientId).toBeNull();
    expect(rows[0]!.email).toBe("client@del-b.test");
  });
});

describe("webhook state machine", () => {
  it("moves SENT to DELIVERED on a matching message id", async () => {
    const { report, primary } = await scenario("del-c");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-c");

    const applied = await applyDeliveryWebhook({
      providerMessageId: "msg-c",
      status: "DELIVERED",
      at: new Date("2026-02-01T16:05:00.000Z"),
    });

    expect(applied).not.toBeNull();
    const after = await raw.reportDelivery.findUniqueOrThrow({
      where: { id: row!.id },
    });
    expect(after.status).toBe("DELIVERED");
  });

  it("ignores a replayed delivered after a bounce", async () => {
    const { report, primary } = await scenario("del-d");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-d");

    await applyDeliveryWebhook({
      providerMessageId: "msg-d",
      status: "BOUNCED",
      at: new Date("2026-02-01T16:05:00.000Z"),
      bounceReason: "mailbox does not exist",
    });

    // Providers retry and reorder. A replayed `delivered` arriving after the
    // bounce must not resurrect a dead address, or tonight's report goes to it
    // again and bounces again.
    const replay = await applyDeliveryWebhook({
      providerMessageId: "msg-d",
      status: "DELIVERED",
      at: new Date("2026-02-01T16:06:00.000Z"),
    });

    expect(replay).toBeNull();
    const after = await raw.reportDelivery.findUniqueOrThrow({
      where: { id: row!.id },
    });
    expect(after.status).toBe("BOUNCED");
    expect(after.bounceReason).toBe("mailbox does not exist");
  });

  it("ignores a webhook older than the state already applied", async () => {
    const { report, primary } = await scenario("del-e");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-e");

    await applyDeliveryWebhook({
      providerMessageId: "msg-e",
      status: "DELIVERED",
      at: new Date("2026-02-01T16:10:00.000Z"),
    });

    const stale = await applyDeliveryWebhook({
      providerMessageId: "msg-e",
      status: "DELAYED",
      at: new Date("2026-02-01T16:02:00.000Z"),
    });

    expect(stale).toBeNull();
    const after = await raw.reportDelivery.findUniqueOrThrow({
      where: { id: row!.id },
    });
    expect(after.status).toBe("DELIVERED");
  });

  it("marks the recipient itself BOUNCED, not just this delivery", async () => {
    const { report, primary } = await scenario("del-f");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-f");

    await applyDeliveryWebhook({
      providerMessageId: "msg-f",
      status: "BOUNCED",
      at: new Date("2026-02-01T16:05:00.000Z"),
      bounceReason: "550 5.1.1",
    });

    // Without this the same dead address gets tonight's report, and tomorrow's,
    // each bouncing on its own with nobody connecting them.
    const after = await raw.recipient.findUniqueOrThrow({
      where: { id: primary.id },
    });
    expect(after.status).toBe("BOUNCED");
    expect(after.lastBounceReason).toBe("550 5.1.1");
  });

  it("returns null for an unknown message id instead of throwing", async () => {
    await scenario("del-g");
    // The route turns this into a 200. A 4xx would make the provider retry for
    // hours against a report we deleted under retention.
    const applied = await applyDeliveryWebhook({
      providerMessageId: "never-sent-this",
      status: "DELIVERED",
      at: new Date(),
    });
    expect(applied).toBeNull();
  });

  it("writes exactly one audit event per applied webhook", async () => {
    const { report, primary, company } = await scenario("del-h");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-h");

    await handleResendEvent({
      type: "email.delivered",
      created_at: new Date("2026-02-01T16:05:00.000Z").toISOString(),
      data: { email_id: "msg-h" },
    });

    const events = await raw.auditEvent.findMany({
      where: { companyId: company.id, entityType: "ReportDelivery" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("delivery.delivered");
  });
});

describe("required vs optional recipients", () => {
  it("does not wait on an optional recipient", async () => {
    const { report, primary, optional } = await scenario("del-i");
    const rows = await createDeliveries(report.id, [primary, optional]);

    const primaryRow = rows.find((r) => r.recipientId === primary.id)!;
    await markDeliverySent(primaryRow.id, "msg-i1");
    await applyDeliveryWebhook({
      providerMessageId: "msg-i1",
      status: "DELIVERED",
      at: new Date(),
    });

    // The cc'd manager is still pending. The guard is waiting on this answer
    // before they go home, and a slow corporate mail filter must not hold it.
    expect(await allRequiredDelivered(report.id)).toBe(true);
  });

  it("does wait on a required recipient", async () => {
    const { report, primary, optional } = await scenario("del-j");
    const rows = await createDeliveries(report.id, [primary, optional]);

    const optionalRow = rows.find((r) => r.recipientId === optional.id)!;
    await markDeliverySent(optionalRow.id, "msg-j1");
    await applyDeliveryWebhook({
      providerMessageId: "msg-j1",
      status: "DELIVERED",
      at: new Date(),
    });

    expect(await allRequiredDelivered(report.id)).toBe(false);
  });

  it("is false when nothing has been sent at all", async () => {
    const { report } = await scenario("del-k");
    // Vacuous truth here would report "delivered to everyone" for a report with
    // no recipients, which is the most dangerous possible false positive.
    expect(await allRequiredDelivered(report.id)).toBe(false);
  });
});

describe("unconfirmed sweep", () => {
  it("expires a SENT row that never got a webhook", async () => {
    const { report, primary } = await scenario("del-l");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-l");

    await raw.reportDelivery.update({
      where: { id: row!.id },
      data: { statusAt: new Date(Date.now() - UNCONFIRMED_AFTER_MS - 60_000) },
    });

    expect(await expireUnconfirmed()).toBe(1);
    const after = await raw.reportDelivery.findUniqueOrThrow({
      where: { id: row!.id },
    });
    // UNCONFIRMED, never FAILED. We do not know it failed; we know we were not
    // told, and those are different facts to put in front of a client.
    expect(after.status).toBe("UNCONFIRMED");
  });

  it("leaves a fresh SENT row alone", async () => {
    const { report, primary } = await scenario("del-m");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-m");

    expect(await expireUnconfirmed()).toBe(0);
  });

  it("leaves a DELIVERED row alone", async () => {
    const { report, primary } = await scenario("del-n");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliverySent(row!.id, "msg-n");
    await applyDeliveryWebhook({
      providerMessageId: "msg-n",
      status: "DELIVERED",
      at: new Date(),
    });
    await raw.reportDelivery.update({
      where: { id: row!.id },
      data: { statusAt: new Date(Date.now() - UNCONFIRMED_AFTER_MS - 60_000) },
    });

    expect(await expireUnconfirmed()).toBe(0);
  });
});

describe("failed sends", () => {
  it("records the error and stays retryable", async () => {
    const { report, primary } = await scenario("del-o");
    const [row] = await createDeliveries(report.id, [primary]);
    await markDeliveryFailed(row!.id, "provider rejected the domain");

    const after = await raw.reportDelivery.findUniqueOrThrow({
      where: { id: row!.id },
    });
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toBe("provider rejected the domain");
    expect(after.attempts).toBe(1);
  });
});
