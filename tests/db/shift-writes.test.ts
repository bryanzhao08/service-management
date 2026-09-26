import { beforeEach, describe, expect, it } from "vitest";

import {
  BlindSpotMethod,
  EntryType,
  PropertyCheckResult,
  Role,
  ShiftStatus,
} from "@/generated/prisma/enums";
import { NotVisibleError, db } from "@/lib/db/scoped";
import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Milestone 4 writes against a real Postgres.
 *
 * The point of these is not that the happy path stores a row — typecheck
 * almost gets you that. It is that the write refuses when it should: a shift
 * that belongs to another company, an area that belongs to another site, a
 * replay that would double-count, a soft delete a guard should not see undone.
 * Each of those is a rule expressed in `lib/db/scoped.ts` and nowhere else.
 */

async function tenants() {
  const a = await createTenant("alpha");
  const b = await createTenant("bravo");
  return { a, b };
}

function actorFor(t: Awaited<ReturnType<typeof createTenant>>, role: Role) {
  const user = role === Role.GUARD ? t.guard : t.owner;
  return { userId: user.id, companyId: t.company.id, role };
}

describe("clock in", () => {
  beforeEach(resetDatabase);

  it("sets clockInAt and writes a CLOCK_IN entry", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));

    const shift = await scoped.clockIn({
      shiftId: a.shift.id,
      isEventNight: true,
      clientId: "clock-in-key-1",
      at: new Date("2026-02-01T06:03:00.000Z"),
    });

    expect(shift.status).toBe(ShiftStatus.ACTIVE);
    expect(shift.isEventNight).toBe(true);
    expect(shift.clockInAt?.toISOString()).toBe("2026-02-01T06:03:00.000Z");

    const entries = await raw.entry.findMany({ where: { shiftId: a.shift.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe(EntryType.CLOCK_IN);
  });

  it("a replay does not move clockInAt forward or add a second entry", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const first = new Date("2026-02-01T06:03:00.000Z");
    const later = new Date("2026-02-01T09:41:00.000Z");

    await scoped.clockIn({
      shiftId: a.shift.id,
      isEventNight: false,
      clientId: "clock-in-key-1",
      at: first,
    });
    const replayed = await scoped.clockIn({
      shiftId: a.shift.id,
      isEventNight: false,
      clientId: "clock-in-key-1",
      at: later,
    });

    // The guard worked from 06:03. A retry three hours later must not erase
    // those hours by restamping the start of the shift.
    expect(replayed.clockInAt?.toISOString()).toBe(first.toISOString());
    const entries = await raw.entry.findMany({ where: { shiftId: a.shift.id } });
    expect(entries).toHaveLength(1);
  });

  it("refuses a shift belonging to another company", async () => {
    const { a, b } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));

    await expect(
      scoped.clockIn({
        shiftId: b.shift.id,
        isEventNight: false,
        clientId: "cross-company-key",
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    const shift = await raw.shift.findUniqueOrThrow({
      where: { id: b.shift.id },
    });
    expect(shift.clockInAt).toBeNull();
    expect(shift.status).toBe(ShiftStatus.SCHEDULED);
  });

  it("refuses another guard's shift inside the same company", async () => {
    const { a } = await tenants();
    const other = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "other@alpha.test",
        name: "other guard",
        role: Role.GUARD,
        assignments: { create: { siteId: a.site.id } },
      },
    });
    const otherShift = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: other.id,
        clientId: "alpha-shift-2",
        scheduledStart: new Date("2026-02-01T18:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T04:00:00.000Z"),
      },
    });

    // Readable (the handoff step needs it) but not writable.
    const scoped = db(actorFor(a, Role.GUARD));
    await expect(scoped.shift.findById(otherShift.id)).resolves.not.toBeNull();
    await expect(
      scoped.clockIn({
        shiftId: otherShift.id,
        isEventNight: false,
        clientId: "someone-elses-shift",
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);
  });
});

describe("entries", () => {
  beforeEach(resetDatabase);

  it("a replayed create never overwrites a server-side edit", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));

    await scoped.entry.upsert({
      shiftId: a.shift.id,
      clientId: "note-key-1",
      type: EntryType.NOTE,
      occurredAt: new Date("2026-02-01T07:00:00.000Z"),
      text: "Gate left open",
    });
    const created = await raw.entry.findUniqueOrThrow({
      where: { clientId: "note-key-1" },
    });
    await scoped.entry.update({
      id: created.id,
      text: "Gate left open, secured at 07:10",
      editedById: a.guard.id,
    });

    // The outbox retries the original create because the first response was
    // lost. If this applied, the correction would vanish with no revision.
    await scoped.entry.upsert({
      shiftId: a.shift.id,
      clientId: "note-key-1",
      type: EntryType.NOTE,
      occurredAt: new Date("2026-02-01T07:00:00.000Z"),
      text: "Gate left open",
    });

    const after = await raw.entry.findUniqueOrThrow({
      where: { clientId: "note-key-1" },
    });
    expect(after.text).toBe("Gate left open, secured at 07:10");
  });

  it("keeps the replaced text as a revision", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const entry = await scoped.entry.upsert({
      shiftId: a.shift.id,
      clientId: "note-key-2",
      type: EntryType.NOTE,
      occurredAt: new Date(),
      text: "original",
    });
    await scoped.entry.update({
      id: entry.id,
      text: "corrected",
      editedById: a.guard.id,
    });

    const revisions = await raw.entryRevision.findMany({
      where: { entryId: entry.id },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.text).toBe("original");
  });

  it("hides a soft-deleted entry from the guard and keeps it for the owner", async () => {
    const { a } = await tenants();
    const guardDb = db(actorFor(a, Role.GUARD));
    const ownerDb = db(actorFor(a, Role.OWNER));
    const entry = await guardDb.entry.upsert({
      shiftId: a.shift.id,
      clientId: "note-key-3",
      type: EntryType.NOTE,
      occurredAt: new Date(),
      text: "logged in error",
    });
    await guardDb.entry.softDelete({ id: entry.id, reason: "duplicate" });

    expect(await guardDb.entry.listForShift(a.shift.id)).toHaveLength(0);
    const forOwner = await ownerDb.entry.listForShift(a.shift.id);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0]?.deleteReason).toBe("duplicate");

    // The row itself survives. A security log that can be erased is not a log.
    const stored = await raw.entry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.deletedAt).not.toBeNull();
  });

  it("refuses to attach an entry to another company's shift", async () => {
    const { a, b } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    await expect(
      scoped.entry.upsert({
        shiftId: b.shift.id,
        clientId: "cross-company-note",
        type: EntryType.NOTE,
        occurredAt: new Date(),
        text: "should never land",
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);
    expect(await raw.entry.count({ where: { shiftId: b.shift.id } })).toBe(0);
  });
});

describe("incident codes", () => {
  beforeEach(resetDatabase);

  it("numbers incidents sequentially within a night", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const at = new Date("2026-02-01T08:00:00.000Z");

    const first = await scoped.incident.create({
      shiftId: a.shift.id,
      clientId: "incident-key-1",
      occurredAt: at,
      categoryKey: "trespass",
      text: "someone at the fence",
    });
    const second = await scoped.incident.create({
      shiftId: a.shift.id,
      clientId: "incident-key-2",
      occurredAt: at,
      categoryKey: "trespass",
      text: "again",
    });

    expect(first.code).toBe("AL-0201-01");
    expect(second.code).toBe("AL-0201-02");
  });

  it("does not re-issue a code after a soft delete", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const at = new Date("2026-02-01T08:00:00.000Z");

    const first = await scoped.incident.create({
      shiftId: a.shift.id,
      clientId: "incident-key-1",
      occurredAt: at,
      categoryKey: "trespass",
    });
    const entry = await raw.entry.findUniqueOrThrow({
      where: { clientId: "incident-key-1" },
    });
    await scoped.entry.softDelete({ id: entry.id, reason: "wrong site" });

    const second = await scoped.incident.create({
      shiftId: a.shift.id,
      clientId: "incident-key-2",
      occurredAt: at,
      categoryKey: "trespass",
    });

    // Gaps are correct. Two incidents sharing AL-0201-01 in one night's report
    // is the exact ambiguity the code exists to remove.
    expect(first.code).toBe("AL-0201-01");
    expect(second.code).toBe("AL-0201-02");
  });

  it("issues distinct codes when two incidents are logged concurrently", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const at = new Date("2026-02-01T08:00:00.000Z");

    // Without the advisory lock both transactions read the same empty set and
    // both write -01. This is the test that fails if the lock is removed.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        scoped.incident.create({
          shiftId: a.shift.id,
          clientId: `concurrent-key-${i}`,
          occurredAt: at,
          categoryKey: "trespass",
        }),
      ),
    );

    const codes = results.map((r) => r.code).sort();
    expect(new Set(codes).size).toBe(5);
    expect(codes).toEqual([
      "AL-0201-01",
      "AL-0201-02",
      "AL-0201-03",
      "AL-0201-04",
      "AL-0201-05",
    ]);
  });

  it("dates the code in the site's timezone, not UTC", async () => {
    const { a } = await tenants();
    await raw.site.update({
      where: { id: a.site.id },
      data: { timezone: "America/Los_Angeles" },
    });
    const scoped = db(actorFor(a, Role.GUARD));

    // 02:00 UTC on the 2nd is 18:00 on the 1st in Los Angeles — still the same
    // night at the property, and a graveyard shift lives entirely in this gap.
    const incident = await scoped.incident.create({
      shiftId: a.shift.id,
      clientId: "tz-key-1",
      occurredAt: new Date("2026-02-02T02:00:00.000Z"),
      categoryKey: "trespass",
    });
    expect(incident.code).toBe("AL-0201-01");
  });

  it("a replay returns the same incident instead of burning a sequence", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const at = new Date("2026-02-01T08:00:00.000Z");
    const args = {
      shiftId: a.shift.id,
      clientId: "incident-key-1",
      occurredAt: at,
      categoryKey: "trespass",
    };

    const first = await scoped.incident.create(args);
    const replayed = await scoped.incident.create(args);

    expect(replayed.id).toBe(first.id);
    expect(replayed.code).toBe(first.code);
    expect(await raw.incident.count()).toBe(1);
  });
});

describe("clock-in checklists", () => {
  beforeEach(resetDatabase);

  it("refuses an area that belongs to another site", async () => {
    const { a, b } = await tenants();
    const foreignArea = await raw.area.create({
      data: { siteId: b.site.id, name: "Bravo loading dock", order: 1 },
    });
    const scoped = db(actorFor(a, Role.GUARD));

    await expect(
      scoped.propertyCheck.submit({
        shiftId: a.shift.id,
        areaId: foreignArea.id,
        result: PropertyCheckResult.CLEAR,
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);
    expect(await raw.propertyCheck.count()).toBe(0);
  });

  it("re-answering an area corrects the record instead of appending", async () => {
    const { a } = await tenants();
    const area = await raw.area.create({
      data: { siteId: a.site.id, name: "Loading dock", order: 1 },
    });
    const scoped = db(actorFor(a, Role.GUARD));

    await scoped.propertyCheck.submit({
      shiftId: a.shift.id,
      areaId: area.id,
      result: PropertyCheckResult.CLEAR,
    });
    await scoped.propertyCheck.submit({
      shiftId: a.shift.id,
      areaId: area.id,
      result: PropertyCheckResult.DAMAGE,
      note: "roll door dented",
    });

    const checks = await raw.propertyCheck.findMany({
      where: { shiftId: a.shift.id },
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]?.result).toBe(PropertyCheckResult.DAMAGE);
    expect(checks[0]?.note).toBe("roll door dented");
  });

  it("records who verified a camera-room blind spot check", async () => {
    const { a } = await tenants();
    const spot = await raw.blindSpot.create({
      data: { siteId: a.site.id, name: "North stairwell", order: 1 },
    });
    const scoped = db(actorFor(a, Role.GUARD));

    const check = await scoped.blindSpotCheck.submit({
      shiftId: a.shift.id,
      blindSpotId: spot.id,
      method: BlindSpotMethod.CAMERA_ROOM,
      verifiedById: a.owner.id,
    });

    // Recording who confirmed is the whole difference between a camera-room
    // check and an unexplained skip.
    expect(check.verifiedById).toBe(a.owner.id);
  });
});

describe("packages", () => {
  beforeEach(resetDatabase);

  it("a second delivery does not rewrite who signed for it", async () => {
    const { a } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));
    const pkg = await scoped.packageInfo.create({
      shiftId: a.shift.id,
      clientId: "package-key-1",
      occurredAt: new Date("2026-02-01T09:00:00.000Z"),
      carrier: "UPS",
      recipientName: "Unit 402",
    });

    await scoped.packageInfo.deliver({
      packageId: pkg.id,
      deliveredTo: "R. Nkemdirim",
      at: new Date("2026-02-01T10:00:00.000Z"),
    });
    await scoped.packageInfo.deliver({
      packageId: pkg.id,
      deliveredTo: "someone else",
      at: new Date("2026-02-01T11:00:00.000Z"),
    });

    const stored = await raw.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.deliveredTo).toBe("R. Nkemdirim");
    expect(stored.deliveredAt?.toISOString()).toBe("2026-02-01T10:00:00.000Z");
  });

  it("refuses to deliver another company's package", async () => {
    const { a, b } = await tenants();
    const bravo = db(actorFor(b, Role.GUARD));
    const pkg = await bravo.packageInfo.create({
      shiftId: b.shift.id,
      clientId: "bravo-package-1",
      occurredAt: new Date(),
      carrier: "FedEx",
    });

    const alpha = db(actorFor(a, Role.OWNER));
    await expect(
      alpha.packageInfo.deliver({
        packageId: pkg.id,
        deliveredTo: "attacker",
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    const stored = await raw.package.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(stored.deliveredAt).toBeNull();
  });
});

describe("handoff", () => {
  beforeEach(resetDatabase);

  it("writes an entry on both shifts in one transaction", async () => {
    const { a } = await tenants();
    const outgoingGuard = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "night@alpha.test",
        name: "night guard",
        role: Role.GUARD,
        assignments: { create: { siteId: a.site.id } },
      },
    });
    const outgoing = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: outgoingGuard.id,
        clientId: "alpha-shift-night",
        scheduledStart: new Date("2026-01-31T20:00:00.000Z"),
        scheduledEnd: new Date("2026-02-01T06:00:00.000Z"),
        status: ShiftStatus.ACTIVE,
        handoffNote: "camera 4 still down",
      },
    });

    const scoped = db(actorFor(a, Role.GUARD));
    await scoped.acknowledgeHandoff({
      shiftId: a.shift.id,
      fromShiftId: outgoing.id,
      clientId: "handoff-key-1",
      at: new Date("2026-02-01T06:05:00.000Z"),
    });

    const received = await raw.entry.findFirstOrThrow({
      where: { shiftId: a.shift.id, type: EntryType.HANDOFF_RECEIVED },
    });
    const given = await raw.entry.findFirstOrThrow({
      where: { shiftId: outgoing.id, type: EntryType.HANDOFF_GIVEN },
    });
    // Neither guard's report may be missing half the story.
    expect(received.text).toBe("camera 4 still down");
    expect(given.text).toBe("camera 4 still down");

    const incoming = await raw.shift.findUniqueOrThrow({
      where: { id: a.shift.id },
    });
    expect(incoming.handoffFromShiftId).toBe(outgoing.id);
  });

  it("refuses a handoff source from another company", async () => {
    const { a, b } = await tenants();
    const scoped = db(actorFor(a, Role.GUARD));

    await expect(
      scoped.acknowledgeHandoff({
        shiftId: a.shift.id,
        fromShiftId: b.shift.id,
        clientId: "handoff-key-2",
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(await raw.entry.count()).toBe(0);
    const incoming = await raw.shift.findUniqueOrThrow({
      where: { id: a.shift.id },
    });
    expect(incoming.handoffFromShiftId).toBeNull();
  });
});

/**
 * `visible.shift` resolves to every shift at a site the actor can see, because
 * acknowledging a handoff means reading the outgoing guard's shift. That read
 * rule was doing duty as the write rule on every path except `clockIn`, so a
 * guard could file, rewrite and strike entries inside a colleague's shift, and
 * the delivered report names the shift's guard once in the header with no
 * per-entry author. These pin the write rule on every path that has one.
 */
describe("a colleague's shift at the same site is readable, never writable", () => {
  beforeEach(resetDatabase);

  async function sameSiteColleague() {
    const a = await createTenant("alpha");
    const other = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "colleague@alpha.test",
        name: "colleague",
        role: Role.GUARD,
        assignments: { create: { siteId: a.site.id } },
      },
    });
    const theirShift = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: other.id,
        clientId: "alpha-colleague-shift",
        scheduledStart: new Date("2026-02-01T18:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T04:00:00.000Z"),
        clockInAt: new Date("2026-02-01T18:01:00.000Z"),
        status: ShiftStatus.ACTIVE,
      },
    });
    // The read has to keep working, or the handoff step breaks. Assert it
    // here so a fix that simply narrows `visible.shift` fails these too.
    const scoped = db(actorFor(a, Role.GUARD));
    await expect(scoped.shift.findById(theirShift.id)).resolves.not.toBeNull();
    return { a, other, theirShift, scoped };
  }

  it("refuses to file an entry on it", async () => {
    const { theirShift, scoped } = await sameSiteColleague();

    await expect(
      scoped.entry.upsert({
        shiftId: theirShift.id,
        clientId: "planted-note",
        type: EntryType.NOTE,
        occurredAt: new Date("2026-02-01T20:00:00.000Z"),
        text: "Perimeter clear, nothing seen.",
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    const entries = await raw.entry.findMany({
      where: { shiftId: theirShift.id },
    });
    expect(entries).toHaveLength(0);
  });

  it("refuses to rewrite an entry on it", async () => {
    const { a, other, theirShift, scoped } = await sameSiteColleague();
    const theirs = await raw.entry.create({
      data: {
        shiftId: theirShift.id,
        clientId: "their-own-note",
        type: EntryType.NOTE,
        occurredAt: new Date("2026-02-01T20:00:00.000Z"),
        text: "Door forced on the north stairwell.",
      },
    });

    await expect(
      scoped.entry.update({
        id: theirs.id,
        text: "Nothing to report.",
        editedById: a.guard.id,
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    const after = await raw.entry.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.text).toBe("Door forced on the north stairwell.");
    expect(other.id).toBe(theirShift.guardId);
  });

  it("refuses to strike an entry off it", async () => {
    const { theirShift, scoped } = await sameSiteColleague();
    const theirs = await raw.entry.create({
      data: {
        shiftId: theirShift.id,
        clientId: "their-second-note",
        type: EntryType.NOTE,
        occurredAt: new Date("2026-02-01T21:00:00.000Z"),
        text: "Vehicle parked across the fire lane.",
      },
    });

    await expect(
      scoped.entry.softDelete({ id: theirs.id, reason: "duplicate" }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    const after = await raw.entry.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.deletedAt).toBeNull();
  });

  it("refuses to raise an incident on it", async () => {
    const { theirShift, scoped } = await sameSiteColleague();

    await expect(
      scoped.incident.create({
        shiftId: theirShift.id,
        clientId: "planted-incident",
        occurredAt: new Date("2026-02-01T22:00:00.000Z"),
        categoryKey: "SUSPICIOUS_PERSON",
        text: "Nothing happened.",
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(
      await raw.incident.count({ where: { entry: { shiftId: theirShift.id } } }),
    ).toBe(0);
  });

  it("refuses to log a package on it", async () => {
    const { theirShift, scoped } = await sameSiteColleague();

    await expect(
      scoped.packageInfo.create({
        shiftId: theirShift.id,
        clientId: "planted-package",
        occurredAt: new Date("2026-02-01T22:30:00.000Z"),
        carrier: "UPS",
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(await raw.entry.count({ where: { shiftId: theirShift.id } })).toBe(0);
  });

  it("refuses to submit a property check on it", async () => {
    const { a, theirShift, scoped } = await sameSiteColleague();
    const area = await raw.area.create({
      data: { siteId: a.site.id, name: "Lobby", order: 1 },
    });

    await expect(
      scoped.propertyCheck.submit({
        shiftId: theirShift.id,
        areaId: area.id,
        result: PropertyCheckResult.CLEAR,
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(await raw.propertyCheck.count({ where: { shiftId: theirShift.id } })).toBe(
      0,
    );
  });

  it("refuses to submit a blind spot check on it", async () => {
    const { a, theirShift, scoped } = await sameSiteColleague();
    const spot = await raw.blindSpot.create({
      data: { siteId: a.site.id, name: "Loading dock camera", order: 1 },
    });

    await expect(
      scoped.blindSpotCheck.submit({
        shiftId: theirShift.id,
        blindSpotId: spot.id,
        method: BlindSpotMethod.PATROL,
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(await raw.blindSpotCheck.count({ where: { shiftId: theirShift.id } })).toBe(
      0,
    );
  });

  it("refuses to acknowledge a handoff into it", async () => {
    const { a, theirShift, scoped } = await sameSiteColleague();

    await expect(
      scoped.acknowledgeHandoff({
        shiftId: theirShift.id,
        fromShiftId: a.shift.id,
        clientId: "planted-handoff",
        at: new Date("2026-02-01T18:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    const after = await raw.shift.findUniqueOrThrow({ where: { id: theirShift.id } });
    expect(after.handoffFromShiftId).toBeNull();
  });

  it("refuses a blind spot verified by somebody outside the company", async () => {
    const { a } = await sameSiteColleague();
    const outsider = await createTenant("bravo");
    const spot = await raw.blindSpot.create({
      data: { siteId: a.site.id, name: "Rear gate camera", order: 2 },
    });
    const scopedOwn = db(actorFor(a, Role.GUARD));

    await expect(
      scopedOwn.blindSpotCheck.submit({
        shiftId: a.shift.id,
        blindSpotId: spot.id,
        method: BlindSpotMethod.CAMERA_ROOM,
        verifiedById: outsider.owner.id,
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(await raw.blindSpotCheck.count({ where: { shiftId: a.shift.id } })).toBe(0);
  });
});
