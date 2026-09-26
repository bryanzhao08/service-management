import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";
import {
  handoffContext,
  notifiedSince,
  sitesWithUnverifiedRecipients,
} from "@/lib/db/notifications";
import { remindUnverifiedRecipients } from "@/lib/jobs/notify-shift";

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
