import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addOneOffDelivery,
  averageEndFlowMs,
  endFlowDuration,
  endOfShiftData,
  recipientsForSend,
  startEndFlow,
  summaryTemplate,
} from "@/lib/db/shift-end";
import { formatClock } from "@/lib/time";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Section 9.4's data layer, against a real database.
 *
 * The things worth pinning here are all *timing and identity* rules that look
 * like nothing in a diff: a stamp that must not be re-written, a duration that
 * must refuse to guess, and a uniqueness rule that Postgres will not enforce
 * for you because of how it treats NULL.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

async function reportFor(shiftId: string, generatedById: string, version = 1) {
  return raw.report.create({
    data: { shiftId, generatedById, version, status: "READY" },
  });
}

describe("startEndFlow", () => {
  it("stamps the clock on first entry", async () => {
    const { shift } = await createTenant("sef-a");
    const now = new Date("2026-02-01T14:00:00.000Z");

    await startEndFlow(shift.id, now);

    const after = await raw.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(after.endFlowStartedAt?.toISOString()).toBe(now.toISOString());
  });

  it("does not reset when the guard goes back to step 1", async () => {
    const { shift } = await createTenant("sef-b");
    const first = new Date("2026-02-01T14:00:00.000Z");
    const later = new Date("2026-02-01T14:09:00.000Z");

    await startEndFlow(shift.id, first);
    await startEndFlow(shift.id, later);

    const after = await raw.shift.findUniqueOrThrow({ where: { id: shift.id } });
    // If this ever equals `later`, the end-of-shift time the product is sold
    // on has quietly become "time since the last edit".
    expect(after.endFlowStartedAt?.toISOString()).toBe(first.toISOString());
  });
});

describe("endFlowDuration", () => {
  it("measures start to completion", () => {
    const ms = endFlowDuration({
      endFlowStartedAt: new Date("2026-02-01T14:00:00.000Z"),
      endFlowCompletedAt: new Date("2026-02-01T14:02:51.000Z"),
    });
    expect(ms).toBe(171_000);
  });

  it("returns null for a flow that was opened and abandoned", () => {
    expect(
      endFlowDuration({
        endFlowStartedAt: new Date("2026-02-01T14:00:00.000Z"),
        endFlowCompletedAt: null,
      }),
    ).toBeNull();
  });

  it("returns null rather than a negative duration on clock skew", () => {
    expect(
      endFlowDuration({
        endFlowStartedAt: new Date("2026-02-01T14:05:00.000Z"),
        endFlowCompletedAt: new Date("2026-02-01T14:00:00.000Z"),
      }),
    ).toBeNull();
  });
});

describe("averageEndFlowMs", () => {
  it("averages only finished flows, and only this guard's", async () => {
    const { site, guard } = await createTenant("sef-c");
    const other = await raw.user.create({
      data: {
        companyId: site.companyId,
        email: "other@sef-c.test",
        name: "Other guard",
        role: "GUARD",
      },
    });

    const make = async (
      guardId: string,
      clientId: string,
      started: string,
      completed: string | null,
    ) =>
      raw.shift.create({
        data: {
          siteId: site.id,
          guardId,
          clientId,
          scheduledStart: new Date("2026-02-01T06:00:00.000Z"),
          scheduledEnd: new Date("2026-02-01T16:00:00.000Z"),
          endFlowStartedAt: new Date(started),
          endFlowCompletedAt: completed ? new Date(completed) : null,
        },
      });

    // 120s and 180s -> 150s.
    await make(guard.id, "c-1", "2026-02-01T14:00:00Z", "2026-02-01T14:02:00Z");
    await make(guard.id, "c-2", "2026-02-02T14:00:00Z", "2026-02-02T14:03:00Z");
    // Abandoned: must not count, and must not be measured to now.
    await make(guard.id, "c-3", "2026-02-03T14:00:00Z", null);
    // Someone else's very slow night must not move this guard's number.
    await make(other.id, "c-4", "2026-02-03T14:00:00Z", "2026-02-03T15:00:00Z");

    const result = await averageEndFlowMs(guard.id, new Date("2026-01-01T00:00:00Z"));
    expect(result).toEqual({ averageMs: 150_000, shifts: 2 });
  });

  it("is null rather than zero when the guard has finished none", async () => {
    const { guard } = await createTenant("sef-d");
    expect(
      await averageEndFlowMs(guard.id, new Date("2026-01-01T00:00:00Z")),
    ).toBeNull();
  });
});

describe("summaryTemplate", () => {
  const base = {
    siteName: "Westhaven",
    siteTimezone: "America/Los_Angeles",
    packageCount: 0,
    blindSpots: { checked: 0, total: 0 },
    handoff: { fromName: null, at: null },
  };

  it("says nothing happened when nothing happened", () => {
    const text = summaryTemplate({ ...base, incidents: [] }, formatClock);
    expect(text).toBe("Routine shift at Westhaven. Nothing to report.");
  });

  it("uses the singular for one incident", () => {
    const text = summaryTemplate(
      { ...base, incidents: [incident("low")] },
      formatClock,
    );
    expect(text).toContain("1 incident (1 low)");
    expect(text).not.toContain("1 incidents");
  });

  it("breaks several incidents down by severity", () => {
    const text = summaryTemplate(
      {
        ...base,
        incidents: [incident("high"), incident("low"), incident("high")],
        packageCount: 2,
        blindSpots: { checked: 3, total: 4 },
      },
      formatClock,
    );
    expect(text).toContain("3 incidents (2 high, 1 low)");
    expect(text).toContain("2 packages received.");
    expect(text).toContain("Blind spots checked 3/4.");
  });

  it("calls an ungraded incident ungraded rather than inventing a severity", () => {
    const text = summaryTemplate({ ...base, incidents: [incident(null)] }, formatClock);
    expect(text).toContain("1 ungraded");
  });

  it("renders the handoff time in the site's zone, not the server's", () => {
    const text = summaryTemplate(
      {
        ...base,
        incidents: [],
        // 06:00 UTC is 22:00 the previous day in Los Angeles.
        handoff: { fromName: "Dana", at: new Date("2026-02-01T06:00:00.000Z") },
      },
      formatClock,
    );
    expect(text).toContain("Handoff from Dana at 22:00.");
  });

  function incident(severity: string | null) {
    return {
      id: "i",
      entryId: "e",
      code: "WH-0201-01",
      text: "Something happened",
      severity: (severity ? severity.toUpperCase() : null) as never,
      ongoingSince: null,
      status: "OPEN" as never,
      resolvedAt: null,
    };
  }
});

describe("addOneOffDelivery", () => {
  it("adds an address that is not already on the report", async () => {
    const { shift, guard } = await createTenant("sef-e");
    const report = await reportFor(shift.id, guard.id);

    expect(await addOneOffDelivery(report.id, "regional@client.test")).toBe(true);

    const rows = await raw.reportDelivery.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipientId).toBeNull();
  });

  it("refuses an address that is already CC'd", async () => {
    const { shift, guard } = await createTenant("sef-f");
    const report = await reportFor(shift.id, guard.id);

    expect(await addOneOffDelivery(report.id, "dup@client.test")).toBe(true);
    expect(await addOneOffDelivery(report.id, "dup@client.test")).toBe(false);

    const rows = await raw.reportDelivery.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
  });

  it("refuses an address that is already a configured recipient", async () => {
    const { site, shift, guard } = await createTenant("sef-g");
    const recipient = await raw.recipient.create({
      data: {
        siteId: site.id,
        name: "Property manager",
        email: "pm@client.test",
        roleLabel: "Property manager",
        required: true,
      },
    });
    const report = await reportFor(shift.id, guard.id);
    await raw.reportDelivery.create({
      data: { reportId: report.id, recipientId: recipient.id, email: recipient.email },
    });

    expect(await addOneOffDelivery(report.id, "pm@client.test")).toBe(false);
    const rows = await raw.reportDelivery.findMany({ where: { reportId: report.id } });
    expect(rows).toHaveLength(1);
  });

  it("lets the same address be CC'd on a different version", async () => {
    const { shift, guard } = await createTenant("sef-h");
    const v1 = await reportFor(shift.id, guard.id, 1);
    const v2 = await reportFor(shift.id, guard.id, 2);

    expect(await addOneOffDelivery(v1.id, "same@client.test")).toBe(true);
    // A correction is a genuinely separate send. The uniqueness is per report,
    // not per shift, precisely so a v2 reaches the same people.
    expect(await addOneOffDelivery(v2.id, "same@client.test")).toBe(true);
  });
});

describe("the (reportId, email) constraint", () => {
  it("blocks a duplicate CC that skips the helper entirely", async () => {
    const { shift, guard } = await createTenant("sef-i");
    const report = await reportFor(shift.id, guard.id);

    await raw.reportDelivery.create({
      data: { reportId: report.id, email: "race@client.test" },
    });

    // The point of the constraint: both rows have a NULL recipientId, so the
    // (reportId, recipientId) unique cannot see the collision -- Postgres
    // treats every NULL as distinct.
    await expect(
      raw.reportDelivery.create({
        data: { reportId: report.id, email: "race@client.test" },
      }),
    ).rejects.toThrow();
  });
});

describe("recipientsForSend", () => {
  it("returns configured recipients required-first and past CCs on this shift", async () => {
    const { site, shift, guard } = await createTenant("sef-j");
    await raw.recipient.createMany({
      data: [
        {
          siteId: site.id,
          name: "Zoe optional",
          email: "zoe@client.test",
          roleLabel: "Ops",
          required: false,
        },
        {
          siteId: site.id,
          name: "Adam required",
          email: "adam@client.test",
          roleLabel: "Property manager",
          required: true,
        },
      ],
    });
    const v1 = await reportFor(shift.id, guard.id, 1);
    await addOneOffDelivery(v1.id, "cc@client.test");

    const result = await recipientsForSend(shift.id, site.id);
    expect(result.configured.map((r) => r.email)).toEqual([
      "adam@client.test",
      "zoe@client.test",
    ]);
    // The guard added this on v1; they should not have to remember it for v2.
    expect(result.oneOffs).toEqual(["cc@client.test"]);
  });

  it("does not leak a CC from another shift at the same site", async () => {
    const { site, shift, guard } = await createTenant("sef-k");
    const otherShift = await raw.shift.create({
      data: {
        siteId: site.id,
        guardId: guard.id,
        clientId: "sef-k-other",
        scheduledStart: new Date("2026-02-02T06:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T16:00:00.000Z"),
      },
    });
    const otherReport = await reportFor(otherShift.id, guard.id);
    await addOneOffDelivery(otherReport.id, "lastnight@client.test");

    const result = await recipientsForSend(shift.id, site.id);
    expect(result.oneOffs).toEqual([]);
  });
});

describe("endOfShiftData", () => {
  it("counts entries by type and separates ongoing incidents", async () => {
    const { shift } = await createTenant("sef-l");

    await raw.entry.create({
      data: {
        shiftId: shift.id,
        type: "NOTE",
        text: "All quiet",
        occurredAt: new Date("2026-02-01T08:00:00Z"),
        clientId: "sef-l-note",
      },
    });
    const incidentEntry = await raw.entry.create({
      data: {
        shiftId: shift.id,
        type: "INCIDENT",
        text: "Man asleep in the lobby",
        occurredAt: new Date("2026-02-01T09:00:00Z"),
        clientId: "sef-l-inc",
      },
    });
    await raw.incident.create({
      data: {
        entryId: incidentEntry.id,
        code: "SE-0201-01",
        categoryKey: "transient",
        severity: "MEDIUM",
        ongoingSince: new Date("2026-02-01T09:00:00Z"),
        status: "OPEN",
      },
    });

    const data = await endOfShiftData(shift.id);
    expect(data).not.toBeNull();
    expect(data?.counts["NOTE"]).toBe(1);
    expect(data?.counts["INCIDENT"]).toBe(1);
    expect(data?.incidents).toHaveLength(1);
    // The entry's text is the incident's title; there is no separate field.
    expect(data?.incidents[0]?.text).toBe("Man asleep in the lobby");
    expect(data?.incidents[0]?.resolvedAt).toBeNull();
  });

  it("ignores soft-deleted entries", async () => {
    const { shift } = await createTenant("sef-m");
    await raw.entry.create({
      data: {
        shiftId: shift.id,
        type: "NOTE",
        text: "Logged by mistake",
        occurredAt: new Date("2026-02-01T08:00:00Z"),
        clientId: "sef-m-note",
        deletedAt: new Date("2026-02-01T08:05:00Z"),
      },
    });

    const data = await endOfShiftData(shift.id);
    // A deleted entry still shows on the timeline to a supervisor, but it must
    // not be counted in a summary the client receives.
    expect(data?.counts["NOTE"]).toBeUndefined();
  });

  it("counts photos that are not attached to an incident", async () => {
    const { shift } = await createTenant("sef-n");
    const entry = await raw.entry.create({
      data: {
        shiftId: shift.id,
        type: "NOTE",
        text: "Gate photo",
        occurredAt: new Date("2026-02-01T08:00:00Z"),
        clientId: "sef-n-note",
      },
    });
    await raw.media.createMany({
      data: [
        {
          shiftId: shift.id,
          entryId: entry.id,
          storageKeyOriginal: "k1",
          capturedAt: new Date("2026-02-01T08:00:00Z"),
          clientId: "sef-n-m1",
        },
        {
          shiftId: shift.id,
          entryId: null,
          storageKeyOriginal: "k2",
          capturedAt: new Date("2026-02-01T08:10:00Z"),
          clientId: "sef-n-m2",
        },
      ],
    });

    const data = await endOfShiftData(shift.id);
    expect(data?.unattachedPhotos).toBe(2);
  });
});
