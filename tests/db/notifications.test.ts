import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  EntryType,
  Role,
  Severity,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import {
  handoffContext,
  notifiedSince,
  sitesWithUnverifiedRecipients,
} from "@/lib/db/notifications";
import { setCompanyPlan } from "@/lib/db/billing";
import {
  notifyHighSeverityIncident,
  remindUnverifiedRecipients,
} from "@/lib/jobs/notify-shift";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Section 13's two non-webhook notifications, against a real Postgres.
 *
 * These are queries with real filters — an "is anyone still on site" test and
 * a cross-table supervisor lookup — and a mocked client would only prove the
 * mock returned what it was told to. The bug these exist to catch is a filter
 * that silently matches nobody, which looks identical to "nothing to notify".
 */

let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  await resetDatabase();
  a = await createTenant("noti-a");
  b = await createTenant("noti-b");
});

afterAll(async () => {
  await raw.$disconnect();
});

beforeEach(async () => {
  await raw.notification.deleteMany({});
  await raw.recipient.deleteMany({});
  await raw.shift.updateMany({
    where: {},
    data: { status: "SCHEDULED", clockInAt: null, clockOutAt: null },
  });
});

async function activate(shiftId: string, at: Date) {
  await raw.shift.update({
    where: { id: shiftId },
    data: { status: "ACTIVE", clockInAt: at, clockOutAt: null },
  });
}

describe("handoffContext", () => {
  it("finds the guard still on site", async () => {
    await activate(a.shift.id, new Date("2026-02-01T06:00:00.000Z"));

    const relief = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "relief@noti-a.test",
        name: "Relief Guard",
        role: Role.GUARD,
      },
    });
    const reliefShift = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: relief.id,
        clientId: "noti-a-relief",
        scheduledStart: new Date("2026-02-01T16:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T02:00:00.000Z"),
      },
    });

    const context = await handoffContext({
      siteId: a.site.id,
      incomingGuardId: relief.id,
      incomingShiftId: reliefShift.id,
    });

    expect(context).not.toBeNull();
    expect(context?.outgoingUserId).toBe(a.guard.id);
    // Links to the outgoing guard's own shift, because that is where their
    // handoff note lives.
    expect(context?.outgoingShiftId).toBe(a.shift.id);
    expect(context?.siteName).toBe(a.site.name);
    expect(context?.incomingGuardName).toBe("Relief Guard");
  });

  it("does not report a guard as their own relief", async () => {
    // A guard who clocks in twice on one shift, or opens a second shift at the
    // same site, is not someone waiting at the door.
    await activate(a.shift.id, new Date("2026-02-01T06:00:00.000Z"));
    const second = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: a.guard.id,
        clientId: "noti-a-second",
        scheduledStart: new Date("2026-02-01T16:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T02:00:00.000Z"),
      },
    });

    const context = await handoffContext({
      siteId: a.site.id,
      incomingGuardId: a.guard.id,
      incomingShiftId: second.id,
    });

    expect(context).toBeNull();
  });

  it("ignores a shift that has already clocked out", async () => {
    await raw.shift.update({
      where: { id: a.shift.id },
      data: {
        status: "ACTIVE",
        clockInAt: new Date("2026-02-01T06:00:00.000Z"),
        clockOutAt: new Date("2026-02-01T16:00:00.000Z"),
      },
    });

    const relief = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "late@noti-a.test",
        name: "Late Guard",
        role: Role.GUARD,
      },
    });
    const reliefShift = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: relief.id,
        clientId: "noti-a-late",
        scheduledStart: new Date("2026-02-01T16:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T02:00:00.000Z"),
      },
    });

    expect(
      await handoffContext({
        siteId: a.site.id,
        incomingGuardId: relief.id,
        incomingShiftId: reliefShift.id,
      }),
    ).toBeNull();
  });

  it("never crosses sites", async () => {
    // Two companies, two sites, both with someone on shift. A handoff
    // notification that crossed here would tell a stranger to go and hand
    // over at a property they have never been to.
    await activate(b.shift.id, new Date("2026-02-01T06:00:00.000Z"));

    const relief = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "x@noti-a.test",
        name: "Cross Guard",
        role: Role.GUARD,
      },
    });
    const reliefShift = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: relief.id,
        clientId: "noti-a-cross",
        scheduledStart: new Date("2026-02-01T16:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T02:00:00.000Z"),
      },
    });

    expect(
      await handoffContext({
        siteId: a.site.id,
        incomingGuardId: relief.id,
        incomingShiftId: reliefShift.id,
      }),
    ).toBeNull();
  });
});

describe("sitesWithUnverifiedRecipients", () => {
  it("counts only required, unverified recipients", async () => {
    await raw.recipient.createMany({
      data: [
        {
          siteId: a.site.id,
          name: "Verified",
          email: "v@client.test",
          roleLabel: "Property manager",
          status: "VERIFIED",
          required: true,
        },
        {
          siteId: a.site.id,
          name: "Optional",
          email: "o@client.test",
          roleLabel: "Copy",
          status: "UNVERIFIED",
          required: false,
        },
        {
          siteId: a.site.id,
          name: "Blocking",
          email: "u@client.test",
          roleLabel: "Property manager",
          status: "UNVERIFIED",
          required: true,
        },
      ],
    });

    const sites = await sitesWithUnverifiedRecipients();
    const found = sites.find((site) => site.siteId === a.site.id);

    expect(found).toBeDefined();
    // An optional unverified recipient does not stop a report reaching the
    // people who matter, so nagging about it is noise.
    expect(found?.count).toBe(1);
    expect(found?.supervisorIds).toContain(a.owner.id);
  });

  it("returns nothing when every required recipient is verified", async () => {
    await raw.recipient.create({
      data: {
        siteId: a.site.id,
        name: "Verified",
        email: "v2@client.test",
        roleLabel: "Property manager",
        status: "VERIFIED",
        required: true,
      },
    });
    const sites = await sitesWithUnverifiedRecipients();
    expect(sites.find((site) => site.siteId === a.site.id)).toBeUndefined();
  });

  it("does not offer one company's supervisor another company's site", async () => {
    await raw.recipient.create({
      data: {
        siteId: b.site.id,
        name: "Blocking",
        email: "u@bravo.test",
        roleLabel: "Property manager",
        status: "UNVERIFIED",
        required: true,
      },
    });
    const found = (await sitesWithUnverifiedRecipients()).find(
      (site) => site.siteId === b.site.id,
    );
    expect(found?.supervisorIds).toEqual([b.owner.id]);
    expect(found?.supervisorIds).not.toContain(a.owner.id);
  });
});

describe("remindUnverifiedRecipients", () => {
  beforeEach(async () => {
    await raw.recipient.create({
      data: {
        siteId: a.site.id,
        name: "Blocking",
        email: "nag@client.test",
        roleLabel: "Property manager",
        status: "UNVERIFIED",
        required: true,
      },
    });
  });

  it("notifies once and then throttles", async () => {
    const first = await remindUnverifiedRecipients();
    expect(first.notifications).toBe(1);
    expect(first.throttled).toBe(0);

    // The sweep runs every minute. The second call is what a minute later
    // looks like, and it must be silent.
    const second = await remindUnverifiedRecipients();
    expect(second.notifications).toBe(0);
    expect(second.throttled).toBe(1);

    expect(
      await raw.notification.count({
        where: { userId: a.owner.id, type: "RECIPIENT_UNVERIFIED_REMINDER" },
      }),
    ).toBe(1);
  });

  it("nags again a day later", async () => {
    await remindUnverifiedRecipients();
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);

    const later = await remindUnverifiedRecipients(tomorrow);
    expect(later.notifications).toBe(1);
    expect(later.throttled).toBe(0);
  });
});

describe("notifiedSince", () => {
  it("is scoped to the url, so one site does not silence another", async () => {
    await raw.notification.create({
      data: {
        userId: a.owner.id,
        type: "RECIPIENT_UNVERIFIED_REMINDER",
        title: "Unverified recipients",
        body: "x",
        url: `/sites/${a.site.id}`,
      },
    });

    const since = new Date(Date.now() - 60 * 60 * 1000);
    expect(
      await notifiedSince({
        userId: a.owner.id,
        type: "RECIPIENT_UNVERIFIED_REMINDER",
        url: `/sites/${a.site.id}`,
        since,
      }),
    ).toBe(true);
    expect(
      await notifiedSince({
        userId: a.owner.id,
        type: "RECIPIENT_UNVERIFIED_REMINDER",
        url: `/sites/${b.site.id}`,
        since,
      }),
    ).toBe(false);
  });
});

/**
 * The one notification a plan is allowed to switch off.
 *
 * `notify()` writes its `Notification` row before it touches a push service,
 * so the in-app record is observable here even with no VAPID keys configured.
 * That is what makes "did the gate stop it" answerable: a gated-off alert
 * leaves no row at all, while an entitled one leaves a row per supervisor.
 *
 * Both directions are asserted on the same incident shape, because "nothing
 * happened" is also exactly what a broken query looks like.
 */
describe("high-severity incident alerts", () => {
  async function highSeverityIncident(
    tenant: Awaited<ReturnType<typeof createTenant>>,
    clientId: string,
  ) {
    const entry = await raw.entry.create({
      data: {
        shiftId: tenant.shift.id,
        type: EntryType.INCIDENT,
        text: "Forced entry at the loading dock.",
        occurredAt: new Date(),
        clientId,
      },
    });
    return raw.incident.create({
      data: {
        entryId: entry.id,
        code: `${clientId}-code`,
        categoryKey: "access",
        severity: Severity.HIGH,
      },
    });
  }

  it("stays silent for a company whose plan does not include push alerts", async () => {
    const incident = await highSeverityIncident(a, "alert-gated");

    const result = await notifyHighSeverityIncident({ incidentId: incident.id });

    expect(result.reason).toBe("not-entitled");
    expect(result.notified).toBe(0);
    expect(await raw.notification.count()).toBe(0);
  });

  it("alerts every supervisor once the plan includes push alerts", async () => {
    // Same incident shape, same company, one thing changed. If this passed
    // without the plan change, the test above would be proving nothing.
    await setCompanyPlan(a.company.id, {
      planId: "operations",
      status: SubscriptionStatus.ACTIVE,
    });

    const supervisor = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "sup@noti-a.test",
        name: "Supervisor",
        role: Role.SUPERVISOR,
        assignments: { create: { siteId: a.site.id } },
      },
    });

    const incident = await highSeverityIncident(a, "alert-entitled");
    const result = await notifyHighSeverityIncident({ incidentId: incident.id });

    expect(result.reason).toBeUndefined();
    // Two: the supervisor and the company owner. An owner hearing about a
    // forced entry at 3am is the point of the feature, so this asserts both
    // rather than only the obvious one.
    expect(result.notified).toBe(2);
    expect(await raw.notification.count({ where: { userId: a.owner.id } })).toBe(1);

    const rows = await raw.notification.findMany({ where: { userId: supervisor.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("INCIDENT_HIGH_SEVERITY");
    // The site goes in the title, which is the line a locked phone shows. A
    // supervisor covering four properties has to know whether this is theirs
    // without unlocking anything.
    expect(rows[0]!.title).toContain(a.site.name);
    // And the body has to carry the code, so the alert and the report can be
    // matched up later without guessing from a timestamp.
    expect(rows[0]!.body).toContain("alert-entitled-code");
    // Tapping it has to land on the shift, not on a list.
    expect(rows[0]!.url).toBe(`/shift/${a.shift.id}`);

    await raw.company.update({
      where: { id: a.company.id },
      data: { planId: null, subscriptionStatus: null },
    });
  });

  it("does not alert a supervisor at another company", async () => {
    await setCompanyPlan(a.company.id, {
      planId: "operations",
      status: SubscriptionStatus.ACTIVE,
    });
    await setCompanyPlan(b.company.id, {
      planId: "operations",
      status: SubscriptionStatus.ACTIVE,
    });

    const mine = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "sup2@noti-a.test",
        name: "Mine",
        role: Role.SUPERVISOR,
        assignments: { create: { siteId: a.site.id } },
      },
    });
    const theirs = await raw.user.create({
      data: {
        companyId: b.company.id,
        email: "sup2@noti-b.test",
        name: "Theirs",
        role: Role.SUPERVISOR,
        assignments: { create: { siteId: b.site.id } },
      },
    });

    const incident = await highSeverityIncident(a, "alert-scoped");
    await notifyHighSeverityIncident({ incidentId: incident.id });

    expect(await raw.notification.count({ where: { userId: mine.id } })).toBe(1);
    expect(await raw.notification.count({ where: { userId: theirs.id } })).toBe(0);

    await raw.company.updateMany({
      where: {},
      data: { planId: null, subscriptionStatus: null },
    });
  });

  it("returns quietly for an incident that no longer exists", async () => {
    // A deleted incident must not throw into the action that called it.
    const result = await notifyHighSeverityIncident({ incidentId: "does-not-exist" });
    expect(result.reason).toBe("gone");
    expect(result.notified).toBe(0);
  });
});
