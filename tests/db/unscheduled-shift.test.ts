import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Role, ShiftStatus } from "@/generated/prisma/enums";
import { NotVisibleError, db, type Actor } from "@/lib/db/scoped";
import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * The path a guard takes when nobody scheduled them.
 *
 * This exists because the dashboard used to answer "No shifts scheduled for
 * you." and offer no control at all, so a guard standing at the post could not
 * start work. The scheduled `Shift` row was a precondition the real job does
 * not have.
 *
 * Against real Postgres, because both properties under test are database
 * properties: the unique index on `clientId` is what makes the double-tap
 * idempotent, and the scoping filter is what stops a guard opening a shift at
 * another company's site. A mock would assert neither.
 */

let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  await resetDatabase();
  a = await createTenant("alpha");
  b = await createTenant("bravo");
});

afterAll(async () => {
  await raw.$disconnect();
});

const guardOf = (tenant: typeof a): Actor => ({
  userId: tenant.guard.id,
  companyId: tenant.company.id,
  role: Role.GUARD,
});

describe("opening an unscheduled shift", () => {
  it("creates a shift the guard can then clock into", async () => {
    const shift = await db(guardOf(a)).openUnscheduledShift({
      siteId: a.site.id,
      clientId: "unscheduled-basic",
      at: new Date("2026-03-01T22:00:00Z"),
    });

    expect(shift.siteId).toBe(a.site.id);
    expect(shift.guardId).toBe(a.guard.id);
    expect(shift.status).toBe(ShiftStatus.SCHEDULED);
    // The window is the claim being made, not null: the report later shows
    // scheduled against actual like any other shift.
    expect(shift.scheduledEnd.getTime()).toBeGreaterThan(
      shift.scheduledStart.getTime(),
    );
  });

  it("is idempotent on the client id, so a double tap is one shift", async () => {
    const actor = guardOf(a);
    const at = new Date("2026-03-02T22:00:00Z");
    const first = await db(actor).openUnscheduledShift({
      siteId: a.site.id,
      clientId: "unscheduled-retry",
      at,
    });
    // The realistic failure: the first tap looks dead on a car-park signal, so
    // the guard taps again. A second row here would split the night in two.
    const second = await db(actor).openUnscheduledShift({
      siteId: a.site.id,
      clientId: "unscheduled-retry",
      at: new Date(at.getTime() + 90_000),
    });

    expect(second.id).toBe(first.id);
    expect(second.scheduledStart.toISOString()).toBe(
      first.scheduledStart.toISOString(),
    );

    const rows = await raw.shift.count({
      where: { clientId: "unscheduled-retry" },
    });
    expect(rows).toBe(1);
  });

  it("refuses a site in another company", async () => {
    // Control: the site really exists, so a pass here cannot come from the row
    // simply being absent.
    expect(await raw.site.findUnique({ where: { id: b.site.id } })).not.toBeNull();

    await expect(
      db(guardOf(a)).openUnscheduledShift({
        siteId: b.site.id,
        clientId: "unscheduled-cross-company",
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);

    expect(
      await raw.shift.count({ where: { clientId: "unscheduled-cross-company" } }),
    ).toBe(0);
  });

  it("refuses a site in the same company the guard is not assigned to", async () => {
    const other = await raw.site.create({
      data: {
        companyId: a.company.id,
        name: "alpha second site",
        code: "A2",
        address: "2 Test Street",
      },
    });

    await expect(
      db(guardOf(a)).openUnscheduledShift({
        siteId: other.id,
        clientId: "unscheduled-unassigned",
        at: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotVisibleError);
  });

  it("only offers sites the guard is assigned to", async () => {
    const sites = await db(guardOf(a)).shift.assignedSitesForActor();
    expect(sites.map((s) => s.id)).toEqual([a.site.id]);
  });
});
