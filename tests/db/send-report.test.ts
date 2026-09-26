import { rm } from "node:fs/promises";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { deliveriesForReport } from "@/lib/db/deliveries";
import {
  MAX_ATTACHMENT_BYTES,
  setEmailProvider,
  type EmailMessage,
} from "@/lib/email/provider";
import { sendReport } from "@/lib/jobs/handlers/send-report";
import { LOCAL_ROOT, storage } from "@/lib/storage/driver";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * `SEND_REPORT`, end to end against a real database and real stored bytes.
 *
 * The rule under test is the one the whole milestone turns on: **exactly one
 * email per recipient per report version, never split because of size.** A
 * client who receives "report 1 of 3" learns nothing and forwards none of it,
 * and a split send makes per-recipient delivery status meaningless -- which is
 * the thing this product is sold on.
 */

/** Captures what was sent instead of writing an outbox file. */
function recorder() {
  const sent: EmailMessage[] = [];
  setEmailProvider({
    async send(message) {
      sent.push(message);
      return { messageId: `rec-${sent.length}`, provider: "console" };
    },
  });
  return sent;
}

/** A provider that fails for one address and succeeds for the rest. */
function failingFor(bad: string) {
  const sent: EmailMessage[] = [];
  setEmailProvider({
    async send(message) {
      if (message.to.includes(bad)) throw new Error("550 mailbox unavailable");
      sent.push(message);
      return { messageId: `ok-${sent.length}`, provider: "console" };
    },
  });
  return sent;
}

beforeEach(async () => {
  await resetDatabase();
  await rm(LOCAL_ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  setEmailProvider(undefined);
  await rm(LOCAL_ROOT, { recursive: true, force: true });
});

afterAll(async () => {
  await raw.$disconnect();
});

async function readyReport(slug: string, pdfBytes = 64 * 1024) {
  const tenant = await createTenant(slug);

  await raw.shift.update({
    where: { id: tenant.shift.id },
    data: {
      clockInAt: new Date("2026-02-01T06:00:00.000Z"),
      clockOutAt: new Date("2026-02-01T16:00:00.000Z"),
    },
  });

  const key = `reports/${slug}.pdf`;
  await storage().put(key, Buffer.alloc(pdfBytes, 7), "application/pdf");

  const report = await raw.report.create({
    data: {
      shiftId: tenant.shift.id,
      status: "READY",
      storageKey: key,
      bytes: pdfBytes,
      generatedById: tenant.guard.id,
    },
  });

  return { ...tenant, report, key };
}

async function addRecipient(
  siteId: string,
  email: string,
  overrides: { required?: boolean; status?: "UNVERIFIED" | "BOUNCED" } = {},
) {
  return raw.recipient.create({
    data: {
      siteId,
      email,
      name: email,
      roleLabel: "Contact",
      required: overrides.required ?? true,
      ...(overrides.status ? { status: overrides.status } : {}),
    },
  });
}

describe("sendReport", () => {
  it("sends one message per recipient and records each delivery", async () => {
    const { site, report } = await readyReport("send-a");
    await addRecipient(site.id, "a@send-a.test");
    await addRecipient(site.id, "b@send-a.test");
    const sent = recorder();

    const result = await sendReport({ reportId: report.id });

    expect(result.result).toBe("sent");
    expect(result.sent).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent.map((m) => m.to).sort()).toEqual(["a@send-a.test", "b@send-a.test"]);

    const rows = await deliveriesForReport(report.id);
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
    expect(rows.every((r) => r.providerMessageId !== null)).toBe(true);
  });

  it("attaches the PDF exactly once per message", async () => {
    const { site, report } = await readyReport("send-b");
    await addRecipient(site.id, "a@send-b.test");
    const sent = recorder();

    await sendReport({ reportId: report.id });

    expect(sent[0]!.attachments).toHaveLength(1);
    expect(sent[0]!.attachments![0]!.contentType).toBe("application/pdf");
    // The site is America/Los_Angeles and the shift starts 06:00 UTC, which is
    // 22:00 the previous day locally. The filename must agree with the subject
    // line, which says "Sat 31 Jan".
    expect(sent[0]!.attachments![0]!.filename).toBe("SE-2026-01-31-v1.pdf");
    expect(sent[0]!.subject).toContain("31 Jan 2026");
  });

  it("links instead of attaching when the PDF is over the cap, still one message", async () => {
    const { site, report } = await readyReport("send-c", MAX_ATTACHMENT_BYTES + 1024);
    await addRecipient(site.id, "a@send-c.test");
    const sent = recorder();

    const result = await sendReport({ reportId: report.id });

    // The point of the test: it degrades to a link, it does not split into
    // "part 1 of 2". One recipient, one message, one delivery status.
    expect(result.attached).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.attachments).toBeUndefined();
    expect(sent[0]!.text).toContain("too large to attach");
  });

  it("carries the delivery id as a tag so the webhook can find it", async () => {
    const { site, report } = await readyReport("send-d");
    await addRecipient(site.id, "a@send-d.test");
    const sent = recorder();

    await sendReport({ reportId: report.id });

    const rows = await deliveriesForReport(report.id);
    expect(sent[0]!.tags?.["deliveryId"]).toBe(rows[0]!.id);
    expect(sent[0]!.tags?.["reportId"]).toBe(report.id);
  });

  it("keeps going when one recipient fails", async () => {
    const { site, report } = await readyReport("send-e");
    await addRecipient(site.id, "bad@send-e.test");
    await addRecipient(site.id, "good@send-e.test");
    const sent = failingFor("bad@");

    const result = await sendReport({ reportId: report.id });

    // A bad address in the middle of an alphabetical list must not silently
    // stop the report reaching everyone after it.
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["good@send-e.test"]);

    const rows = await deliveriesForReport(report.id);
    const bad = rows.find((r) => r.email === "bad@send-e.test")!;
    const good = rows.find((r) => r.email === "good@send-e.test")!;
    expect(bad.status).toBe("FAILED");
    expect(bad.lastError).toContain("550");
    expect(good.status).toBe("SENT");
  });

  it("retries only the failed recipient on a second run", async () => {
    const { site, report } = await readyReport("send-f");
    await addRecipient(site.id, "bad@send-f.test");
    await addRecipient(site.id, "good@send-f.test");
    failingFor("bad@");
    await sendReport({ reportId: report.id });

    // Second pass, provider now healthy. The already-delivered recipient must
    // not get the same report twice -- that is the failure mode that makes a
    // client stop trusting the send.
    const second = recorder();
    const result = await sendReport({ reportId: report.id });

    expect(result.sent).toBe(1);
    expect(second.map((m) => m.to)).toEqual(["bad@send-f.test"]);
  });

  it("skips a recipient whose address already bounced", async () => {
    const { site, report } = await readyReport("send-g");
    await addRecipient(site.id, "dead@send-g.test", { status: "BOUNCED" });
    await addRecipient(site.id, "live@send-g.test");
    const sent = recorder();

    await sendReport({ reportId: report.id });

    expect(sent.map((m) => m.to)).toEqual(["live@send-g.test"]);
  });

  it("sends a single combined message when the site asks for it", async () => {
    const { site, report } = await readyReport("send-h");
    await raw.site.update({
      where: { id: site.id },
      data: { sendIndividually: false },
    });
    await addRecipient(site.id, "a@send-h.test");
    await addRecipient(site.id, "b@send-h.test");
    const sent = recorder();

    await sendReport({ reportId: report.id });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("a@send-h.test, b@send-h.test");

    // The cost of the option, made explicit: both rows now share one provider
    // message id, so one webhook speaks for two different mail servers.
    const rows = await deliveriesForReport(report.id);
    expect(new Set(rows.map((r) => r.providerMessageId)).size).toBe(1);
  });

  it("marks the report SENT once, and does not move sentAt on a retry", async () => {
    const { site, report } = await readyReport("send-i");
    await addRecipient(site.id, "a@send-i.test");
    recorder();

    await sendReport({ reportId: report.id });
    const first = await raw.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(first.status).toBe("SENT");
    expect(first.sentAt).not.toBeNull();

    await sendReport({ reportId: report.id });
    const second = await raw.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(second.sentAt?.getTime()).toBe(first.sentAt?.getTime());
  });

  it("refuses a report with no PDF rather than sending an empty one", async () => {
    const tenant = await createTenant("send-j");
    const report = await raw.report.create({
      data: {
        shiftId: tenant.shift.id,
        status: "GENERATING",
        generatedById: tenant.guard.id,
      },
    });
    const sent = recorder();

    const result = await sendReport({ reportId: report.id });

    expect(result.result).toBe("not-ready");
    expect(sent).toHaveLength(0);
  });

  it("reports a missing report as gone instead of throwing", async () => {
    const result = await sendReport({ reportId: "does-not-exist" });
    expect(result.result).toBe("gone");
  });

  it("writes one audit event for the send", async () => {
    const { site, report, company } = await readyReport("send-k");
    await addRecipient(site.id, "a@send-k.test");
    recorder();

    await sendReport({ reportId: report.id });

    const events = await raw.auditEvent.findMany({
      where: { companyId: company.id, action: "report.sent" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(report.id);
  });
});

describe("the subject line", () => {
  it("names the site, the date and the incident count", async () => {
    const { site, report, shift, guard } = await readyReport("send-l");
    await addRecipient(site.id, "a@send-l.test");

    await raw.entry.create({
      data: {
        shiftId: shift.id,
        type: "INCIDENT",
        occurredAt: new Date("2026-02-01T09:15:00.000Z"),
        text: "Unsecured door on level 2",
        clientId: "send-l-e1",
        incident: {
          create: { code: "SE-0201-01", categoryKey: "access", severity: "MEDIUM" },
        },
      },
    });

    const sent = recorder();
    await sendReport({ reportId: report.id });

    expect(sent[0]!.subject).toContain(site.code);
    expect(sent[0]!.subject).toContain("1 incident");
    expect(sent[0]!.subject).not.toContain("1 incidents");
    expect(sent[0]!.text).toContain("SE-0201-01");
    expect(sent[0]!.text).toContain("Unsecured door on level 2");
    expect(guard.name).toBeTruthy();
  });

  it("does not count a deleted entry as an incident", async () => {
    const { site, report, shift } = await readyReport("send-m");
    await addRecipient(site.id, "a@send-m.test");

    await raw.entry.create({
      data: {
        shiftId: shift.id,
        type: "INCIDENT",
        occurredAt: new Date("2026-02-01T09:15:00.000Z"),
        text: "Logged against the wrong site",
        clientId: "send-m-e1",
        deletedAt: new Date("2026-02-01T09:20:00.000Z"),
        deleteReason: "wrong site",
        incident: {
          create: { code: "SE-0201-01", categoryKey: "access", severity: "LOW" },
        },
      },
    });

    const sent = recorder();
    await sendReport({ reportId: report.id });

    expect(sent[0]!.subject).toContain("0 incidents");
  });
});
