import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import { db, visible, type Actor } from "@/lib/db/scoped";
import { siteRecipients } from "@/lib/db/recipients";
import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Section 19: "a query for a shift belonging to company B with a session from
 * company A returns not-found (write this as a real test against a test DB)."
 *
 * Written against a real Postgres through the same `lib/db/scoped` module the
 * app uses. A mocked client would only prove the mock returns what it was told
 * to; the thing under test is whether the generated SQL actually carries the
 * company filter.
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

const actorFor = (tenant: typeof a, who: "owner" | "guard"): Actor => ({
  userId: tenant[who].id,
  companyId: tenant.company.id,
  role: who === "owner" ? Role.OWNER : Role.GUARD,
});

describe("company scoping", () => {
  it("is set up so that the cross-company read could succeed if unscoped", async () => {
    // The control. Without this the test below passes just as happily against
    // a row that does not exist, which would prove nothing at all.
    const unscoped = await raw.shift.findUnique({ where: { id: b.shift.id } });
    expect(unscoped).not.toBeNull();
    expect(unscoped?.siteId).toBe(b.site.id);
    expect(a.company.id).not.toBe(b.company.id);
  });

  it("returns not-found for company B's shift read with a company A session", async () => {
    const found = await db(actorFor(a, "owner")).shift.findById(b.shift.id);
    expect(found).toBeNull();
  });

  it("returns not-found at every privilege level, not just the lowest", async () => {
    // An OWNER is the most privileged role there is. Tenancy is not a
    // permission that privilege can outrank, so this must fail too.
    for (const role of [Role.GUARD, Role.SUPERVISOR, Role.ADMIN, Role.OWNER]) {
      const actor: Actor = {
        userId: a.owner.id,
        companyId: a.company.id,
        role,
      };
      expect(await db(actor).shift.findById(b.shift.id)).toBeNull();
      expect(await db(actor).site.findById(b.site.id)).toBeNull();
      expect(await db(actor).user.findById(b.guard.id)).toBeNull();
    }
  });

  it("still finds the actor's own company rows", async () => {
    const actor = actorFor(a, "owner");
    expect((await db(actor).shift.findById(a.shift.id))?.id).toBe(a.shift.id);
    expect((await db(actor).site.findById(a.site.id))?.id).toBe(a.site.id);
    expect((await db(actor).user.findById(a.guard.id))?.id).toBe(a.guard.id);
  });

  it("never lists another company's rows", async () => {
    const sites = await db(actorFor(a, "owner")).site.findMany();
    const users = await db(actorFor(a, "owner")).user.findMany();
    expect(sites.map((s) => s.id)).toEqual([a.site.id]);
    expect(users.every((u) => u.companyId === a.company.id)).toBe(true);
    expect(users.map((u) => u.id)).not.toContain(b.guard.id);
  });
});

describe("site scope within a company", () => {
  it("hides an unassigned site from a GUARD but not from an ADMIN", async () => {
    const second = await raw.site.create({
      data: {
        companyId: a.company.id,
        name: "alpha second site",
        code: "A2",
        address: "2 Test Street",
      },
    });

    const guard = actorFor(a, "guard");
    const admin: Actor = { ...actorFor(a, "owner"), role: Role.ADMIN };

    expect(await db(guard).site.findById(second.id)).toBeNull();
    expect((await db(admin).site.findById(second.id))?.id).toBe(second.id);

    // And the guard can still see the one they are assigned to, so the null
    // above is the assignment filter working rather than the query being broken.
    expect((await db(guard).site.findById(a.site.id))?.id).toBe(a.site.id);

    await raw.site.delete({ where: { id: second.id } });
  });

  it("scopes a guard's shifts to their assigned sites, not to themselves", async () => {
    // Section 8 scopes a guard's *reports* to their own, not their shifts:
    // acknowledging a handoff means reading the outgoing guard's shift. This
    // asserts that distinction rather than letting a future "tighten it to
    // guardId" change slip through as an improvement.
    const colleague = await raw.user.create({
      data: {
        companyId: a.company.id,
        email: "colleague@alpha.test",
        name: "alpha colleague",
        role: Role.GUARD,
        assignments: { create: { siteId: a.site.id } },
      },
    });
    const theirShift = await raw.shift.create({
      data: {
        siteId: a.site.id,
        guardId: colleague.id,
        clientId: "alpha-shift-colleague",
        scheduledStart: new Date("2026-02-02T06:00:00.000Z"),
        scheduledEnd: new Date("2026-02-02T16:00:00.000Z"),
      },
    });

    const found = await db(actorFor(a, "guard")).shift.findById(theirShift.id);
    expect(found?.id).toBe(theirShift.id);

    await raw.shift.delete({ where: { id: theirShift.id } });
    await raw.user.delete({ where: { id: colleague.id } });
  });
});

describe("siteRecipients", () => {
  it("is set up so that an unscoped read would find company B's recipient", async () => {
    // The control. Without a real row at B's site, "A cannot see it" is true
    // for free and the test below proves nothing.
    await raw.recipient.create({
      data: {
        siteId: b.site.id,
        name: "Bravo Ops",
        email: "ops@bravo.test",
        roleLabel: "Operations Manager",
        required: true,
        status: "VERIFIED",
      },
    });
    const unscoped = await raw.recipient.findMany({ where: { siteId: b.site.id } });
    expect(unscoped).toHaveLength(1);
  });

  it("returns null for company B's site with a company A session", async () => {
    expect(await siteRecipients(actorFor(a, "owner"), b.site.id)).toBeNull();
  });

  it("returns null rather than an empty list, so the page 404s instead of\n     rendering an add-recipient form pointed at another company's site", async () => {
    const result = await siteRecipients(actorFor(a, "owner"), b.site.id);
    // The distinction matters: `{ rows: [] }` is a legitimate state for one of
    // your own sites, and the page renders a working form for it.
    expect(result).not.toEqual({ site: expect.anything(), rows: [] });
    expect(result).toBeNull();
  });

  it("returns the site and its recipients for the actor's own site", async () => {
    await raw.recipient.create({
      data: {
        siteId: a.site.id,
        name: "Alpha Ops",
        email: "ops@alpha.test",
        roleLabel: "Operations Manager",
        required: true,
        status: "VERIFIED",
      },
    });
    const result = await siteRecipients(actorFor(a, "owner"), a.site.id);
    expect(result?.site.id).toBe(a.site.id);
    expect(result?.rows.map((r) => r.email)).toEqual(["ops@alpha.test"]);
  });

  it("never leaks another site's recipients into the list", async () => {
    const result = await siteRecipients(actorFor(a, "owner"), a.site.id);
    expect(result?.rows.every((r) => r.siteId === a.site.id)).toBe(true);
    expect(result?.rows.map((r) => r.email)).not.toContain("ops@bravo.test");
  });
});

describe("visible where-fragments", () => {
  it("always pins to companyId, for every role", () => {
    for (const role of [Role.GUARD, Role.SUPERVISOR, Role.ADMIN, Role.OWNER]) {
      const actor: Actor = { userId: "u", companyId: "c1", role };
      expect(visible.site(actor)).toMatchObject({ companyId: "c1" });
      expect(visible.user(actor)).toMatchObject({ companyId: "c1" });
      // Shift/entry/report reach company through `site`, so assert the chain
      // is present rather than a top-level companyId that does not exist there.
      expect(JSON.stringify(visible.shift(actor))).toContain("c1");
      expect(JSON.stringify(visible.entry(actor))).toContain("c1");
      expect(JSON.stringify(visible.report(actor))).toContain("c1");
    }
  });
});
