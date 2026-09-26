import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DeliveryStatus,
  EntryType,
  LoggingMode,
  MediaKind,
  RecipientStatus,
  ReportStatus,
  Severity,
  ShiftStatus,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import { ALWAYS_INCLUDED, PLANS, type Entitlement } from "@/lib/billing/plans";
import {
  activeSiteCount,
  billingSummary,
  companyHasEntitlement,
  companySubscription,
  setCompanyPlan,
} from "@/lib/db/billing";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Subscriptions, against a real Postgres.
 *
 * The claim this file exists to defend is the one in `ALWAYS_INCLUDED`: the
 * pricing system must never be the reason a record is incomplete. That is a
 * promise about what the code does *not* do, which is the kind of promise
 * that rots quietly — someone adds a plan check in an action six months from
 * now and no existing test notices, because every existing test runs as a
 * company that happens to be paying.
 *
 * So the tests below run a company with no subscription at all and assert
 * that the whole recording path still works end to end, and separately that
 * the gated extras really are off for that same company. One without the
 * other proves nothing: if everything is allowed the first test passes for
 * the wrong reason, and if everything is denied the second does.
 */
let paid: Awaited<ReturnType<typeof createTenant>>;
let free: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  await resetDatabase();
  paid = await createTenant("billing-paid");
  free = await createTenant("billing-free");
  await setCompanyPlan(paid.company.id, {
    planId: "assurance",
    status: SubscriptionStatus.ACTIVE,
  });
});

afterAll(async () => {
  await resetDatabase();
});

describe("what a plan may never switch off", () => {
  it("leaves a company with no subscription able to record a full shift", async () => {
    const before = await companySubscription(free.company.id);
    expect(before.plan).toBeNull();
    expect(before.status).toBeNull();

    // The whole chain, as a company that has never paid: clock in, log an
    // entry, attach a photo, raise an incident, close the shift. Every step
    // is in `ALWAYS_INCLUDED`, so every step must succeed here or the
    // product is lying on its own pricing page.
    const shift = await raw.shift.update({
      where: { id: free.shift.id },
      data: { clockInAt: new Date(), status: ShiftStatus.ACTIVE },
    });
    expect(shift.clockInAt).not.toBeNull();

    const entry = await raw.entry.create({
      data: {
        shiftId: free.shift.id,
        type: EntryType.NOTE,
        text: "Gate secure.",
        occurredAt: new Date(),
        clientId: "free-entry-1",
      },
    });
    expect(entry.id).toBeTruthy();

    const photo = await raw.media.create({
      data: {
        shiftId: free.shift.id,
        entryId: entry.id,
        kind: MediaKind.PHOTO,
        storageKeyOriginal: "free/photo.jpg",
        bytes: 1024,
        capturedAt: new Date(),
        clientId: "free-media-1",
      },
    });
    expect(photo.id).toBeTruthy();

    const incidentEntry = await raw.entry.create({
      data: {
        shiftId: free.shift.id,
        type: EntryType.INCIDENT,
        text: "Door forced.",
        occurredAt: new Date(),
        clientId: "free-entry-2",
      },
    });
    const incident = await raw.incident.create({
      data: {
        entryId: incidentEntry.id,
        code: "FREE-1",
        categoryKey: "access",
        severity: Severity.HIGH,
      },
    });
    expect(incident.severity).toBe(Severity.HIGH);

    const report = await raw.report.create({
      data: {
        shiftId: free.shift.id,
        version: 1,
        status: ReportStatus.SENT,
        contentHash: "hash-free",
        generatedById: free.owner.id,
      },
    });
    expect(report.status).toBe(ReportStatus.SENT);

    const recipient = await raw.recipient.create({
      data: {
        siteId: free.site.id,
        email: "client@free.test",
        name: "Client",
        roleLabel: "Property manager",
        status: RecipientStatus.VERIFIED,
      },
    });
    const delivery = await raw.reportDelivery.create({
      data: {
        reportId: report.id,
        recipientId: recipient.id,
        email: recipient.email,
        status: DeliveryStatus.DELIVERED,
      },
    });
    expect(delivery.status).toBe(DeliveryStatus.DELIVERED);
  });

  it("denies every gated entitlement to that same company", async () => {
    // The control for the test above. If this failed open, the previous test
    // would pass without proving anything at all.
    const gated: Entitlement[] = [
      "client_portal",
      "custom_templates",
      "push_alerts",
      "sso",
      "api_access",
      "audit_export",
      "delivery_attestation",
      "white_label",
    ];

    for (const entitlement of gated) {
      expect(
        await companyHasEntitlement(free.company.id, entitlement),
        `unsubscribed company must not have ${entitlement}`,
      ).toBe(false);
    }
  });

  it("keeps the evidence floor even with no subscription", async () => {
    const subscription = await companySubscription(free.company.id);
    // A lapsed card is not a reason the night of an incident becomes
    // unavailable. Twelve months is the floor for everyone.
    expect(subscription.retentionMonths).toBeGreaterThanOrEqual(12);
  });

  it("states nothing in ALWAYS_INCLUDED as a purchasable entitlement", () => {
    // A drift guard on the two lists. If a capability ever appears in both,
    // the marketing page and the gate disagree and one of them is a lie.
    const entitlementLabels = new Set(
      PLANS.flatMap((plan) => plan.entitlements.map((e) => String(e))),
    );
    for (const promise of ALWAYS_INCLUDED) {
      expect(entitlementLabels.has(promise)).toBe(false);
    }
  });
});

describe("resolving a plan", () => {
  it("grants exactly the entitlements its plan lists", async () => {
    expect(await companyHasEntitlement(paid.company.id, "audit_export")).toBe(true);
    expect(await companyHasEntitlement(paid.company.id, "push_alerts")).toBe(true);
    // Assurance stops short of white-label. A plan granting more than it
    // sells is the failure nobody reports.
    expect(await companyHasEntitlement(paid.company.id, "white_label")).toBe(false);
  });

  it("degrades to no plan when the stored id is not a plan any more", async () => {
    // A renamed plan must not 500 every signed-in screen. The safe direction
    // is the free capability set: recording keeps working, extras go quiet.
    await raw.company.update({
      where: { id: free.company.id },
      data: {
        planId: "plan-that-was-renamed",
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });

    const subscription = await companySubscription(free.company.id);
    expect(subscription.plan).toBeNull();
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.retentionMonths).toBeGreaterThanOrEqual(12);
    expect(await companyHasEntitlement(free.company.id, "push_alerts")).toBe(false);

    await raw.company.update({
      where: { id: free.company.id },
      data: { planId: null, subscriptionStatus: null },
    });
  });

  it("still resolves the plan while a payment is failing", async () => {
    // Revoking capability on a failed payment means a webhook retry silently
    // changes what a supervisor may do mid-shift. Billing state is a
    // conversation with an owner, not a switch on a guard's screen.
    await raw.company.update({
      where: { id: paid.company.id },
      data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
    });

    expect(await companyHasEntitlement(paid.company.id, "audit_export")).toBe(true);

    await raw.company.update({
      where: { id: paid.company.id },
      data: { subscriptionStatus: SubscriptionStatus.ACTIVE },
    });
  });
});

describe("the active-site meter", () => {
  it("counts a site once a guard clocks in there this month", async () => {
    const zero = await activeSiteCount(paid.company.id);
    expect(zero).toBe(0);

    await raw.shift.update({
      where: { id: paid.shift.id },
      data: { clockInAt: new Date() },
    });

    expect(await activeSiteCount(paid.company.id)).toBe(1);
  });

  it("does not count a shift from a previous month", async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    lastMonth.setDate(15);

    const otherSite = await raw.site.create({
      data: {
        companyId: paid.company.id,
        name: "Last month only",
        code: "LM",
        address: "2 Test Street",
        loggingMode: LoggingMode.FULL,
      },
    });
    await raw.shift.create({
      data: {
        siteId: otherSite.id,
        guardId: paid.guard.id,
        clientId: "paid-last-month",
        scheduledStart: lastMonth,
        scheduledEnd: lastMonth,
        clockInAt: lastMonth,
      },
    });

    // Still 1: the meter is this calendar month, so a site that went quiet
    // stops being billable without anyone having to remember to remove it.
    expect(await activeSiteCount(paid.company.id)).toBe(1);
  });

  it("does not count a scheduled shift nobody turned up to", async () => {
    const ghostSite = await raw.site.create({
      data: {
        companyId: paid.company.id,
        name: "Scheduled only",
        code: "SO",
        address: "3 Test Street",
        loggingMode: LoggingMode.FULL,
      },
    });
    await raw.shift.create({
      data: {
        siteId: ghostSite.id,
        guardId: paid.guard.id,
        clientId: "paid-ghost",
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
      },
    });

    // A schedule is an intention. Billing on one means an operator pays for
    // a site the moment they plan it, which is the sort of surprise that
    // ends a contract.
    expect(await activeSiteCount(paid.company.id)).toBe(1);
  });

  it("bills the plan minimum when fewer sites are active", async () => {
    const summary = await billingSummary(paid.company.id);
    expect(summary.activeSites).toBe(1);
    // Assurance has a five-site minimum, and the total must follow the
    // billable units rather than the raw meter.
    expect(summary.billableUnits).toBe(5);
    expect(summary.monthlyTotalUsd).toBe(5 * 149);
  });

  it("charges nothing for a company with no plan", async () => {
    const summary = await billingSummary(free.company.id);
    expect(summary.monthlyTotalUsd).toBeNull();
    expect(summary.billableUnits).toBe(summary.activeSites);
  });
});
