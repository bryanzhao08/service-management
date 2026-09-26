import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { latestReportId, receiptData } from "@/lib/db/receipt";
import {
  receiptClaims,
  signReceiptToken,
  verifyReceiptToken,
} from "@/lib/storage/tokens";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Section 9.5's receipt.
 *
 * `receiptData` is deliberately unscoped so a signed public link and the
 * guard's own page render from one assembler and cannot disagree about what
 * happened. That makes two things worth pinning: the assembler tells the whole
 * truth (including a bounce), and the token that gates the public copy refuses
 * anything it did not sign.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

async function seedReport(slug: string, overrides: Record<string, unknown> = {}) {
  const tenant = await createTenant(slug);
  const report = await raw.report.create({
    data: {
      shiftId: tenant.shift.id,
      generatedById: tenant.guard.id,
      version: 1,
      status: "SENT",
      bytes: 412_000,
      pages: 3,
      sha256: "a".repeat(64),
      contentHash: "b".repeat(64),
      generatedAt: new Date("2026-02-01T16:02:00.000Z"),
      sentAt: new Date("2026-02-01T16:02:40.000Z"),
      ...overrides,
    },
  });
  return { ...tenant, report };
}

describe("receiptData", () => {
  it("reports a bounce as a bounce, with the provider's reason", async () => {
    const { site, report } = await seedReport("rcpt-a");
    const recipient = await raw.recipient.create({
      data: {
        siteId: site.id,
        name: "Property manager",
        email: "pm@client.test",
        roleLabel: "Property manager",
        required: true,
      },
    });
    await raw.reportDelivery.create({
      data: {
        reportId: report.id,
        recipientId: recipient.id,
        email: recipient.email,
        status: "BOUNCED",
        bounceReason: "550 5.1.1 recipient does not exist",
        attempts: 1,
      },
    });

    const data = await receiptData(report.id);
    expect(data).not.toBeNull();
    expect(data?.deliveries).toHaveLength(1);
    expect(data?.deliveries[0]?.status).toBe("BOUNCED");
    // A receipt that hides why is worth less than no receipt: the guard needs
    // to know the address is wrong, tonight, while they can still fix it.
    expect(data?.deliveries[0]?.bounceReason).toContain("550");
    expect(data?.deliveries[0]?.required).toBe(true);
    expect(data?.deliveries[0]?.roleLabel).toBe("Property manager");
  });

  it("carries both hashes so the file can be checked against the record", async () => {
    const { report } = await seedReport("rcpt-b");
    const data = await receiptData(report.id);
    expect(data?.sha256).toHaveLength(64);
    expect(data?.contentHash).toHaveLength(64);
    expect(data?.bytes).toBe(412_000);
    expect(data?.pages).toBe(3);
  });

  it("lists every version of this shift's report, newest first", async () => {
    const { shift, guard, report } = await seedReport("rcpt-c");
    await raw.report.create({
      data: {
        shiftId: shift.id,
        generatedById: guard.id,
        version: 2,
        status: "READY",
        generatedAt: new Date("2026-02-02T09:00:00.000Z"),
      },
    });

    const data = await receiptData(report.id);
    expect(data?.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("says there is no gallery once the link has expired", async () => {
    const { report } = await seedReport("rcpt-d", {
      galleryToken: "tok-expired",
      galleryExpiresAt: new Date("2026-02-01T17:00:00.000Z"),
    });

    const live = await receiptData(report.id);
    expect(live?.hasGallery).toBe(false);

    await raw.report.update({
      where: { id: report.id },
      data: { galleryExpiresAt: new Date(Date.now() + 86_400_000) },
    });
    const fresh = await receiptData(report.id);
    expect(fresh?.hasGallery).toBe(true);
  });

  it("returns null for a report that does not exist", async () => {
    expect(await receiptData("no-such-report")).toBeNull();
  });
});

describe("latestReportId", () => {
  it("returns the newest version, not the first", async () => {
    const { shift, guard } = await seedReport("rcpt-e");
    const v2 = await raw.report.create({
      data: { shiftId: shift.id, generatedById: guard.id, version: 2, status: "READY" },
    });
    expect(await latestReportId(shift.id)).toBe(v2.id);
  });

  it("is null for a shift that has never been reported", async () => {
    const { shift } = await createTenant("rcpt-f");
    expect(await latestReportId(shift.id)).toBeNull();
  });
});

describe("receipt tokens", () => {
  /** `exp` is Unix seconds, not milliseconds. */
  const inOneHour = Math.floor(Date.now() / 1000) + 3600;

  it("round-trips a report id", () => {
    const token = signReceiptToken({ reportId: "rep_123", exp: inOneHour });
    expect(verifyReceiptToken(token)?.reportId).toBe("rep_123");
  });

  it("refuses a token whose payload was edited", () => {
    const token = signReceiptToken({ reportId: "rep_123", exp: inOneHour });
    const [version, payload, signature] = token.split(".") as [string, string, string];
    const forged = Buffer.from(
      Buffer.from(payload, "base64url").toString("utf8").replace("rep_123", "rep_999"),
      "utf8",
    ).toString("base64url");
    expect(verifyReceiptToken(`${version}.${forged}.${signature}`)).toBeNull();
    // Control: the untouched token still verifies, so the rejection above is
    // the edit and not a broken harness.
    expect(verifyReceiptToken(token)?.reportId).toBe("rep_123");
  });

  it("refuses a token whose signature was replaced", () => {
    const token = signReceiptToken({ reportId: "rep_123", exp: inOneHour });
    const [version, payload] = token.split(".") as [string, string, string];
    const other = signReceiptToken({ reportId: "rep_999", exp: inOneHour });
    const otherSignature = other.split(".")[2]!;
    expect(verifyReceiptToken(`${version}.${payload}.${otherSignature}`)).toBeNull();
  });

  it("refuses an expired token", () => {
    const token = signReceiptToken({
      reportId: "rep_123",
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    expect(verifyReceiptToken(token)).toBeNull();
  });

  it("expires a real 90-day link, and not a moment before", () => {
    const minted = new Date("2026-02-01T16:00:00.000Z");
    const token = signReceiptToken(receiptClaims("rep_123", minted));

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-01T15:00:00.000Z")); // day 89
      expect(verifyReceiptToken(token)?.reportId).toBe("rep_123");

      vi.setSystemTime(new Date("2026-05-03T00:00:00.000Z")); // day 91
      // If the mint ever passes milliseconds, `exp` reads as the year 58000
      // and this link outlives the company. That is what this pins.
      expect(verifyReceiptToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a version it did not issue", () => {
    const token = signReceiptToken({ reportId: "rep_123", exp: inOneHour });
    const [, payload, signature] = token.split(".") as [string, string, string];
    expect(verifyReceiptToken(`v2.${payload}.${signature}`)).toBeNull();
  });

  it("refuses noise", () => {
    expect(verifyReceiptToken("not-a-token")).toBeNull();
    expect(verifyReceiptToken("")).toBeNull();
    expect(verifyReceiptToken("v1.only.two")).toBeNull();
  });
});
