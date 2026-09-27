import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/db/scoped";
import { inviteUser, listTeam } from "@/lib/db/team";
import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * Invite is the only way an account exists outside the seed, so the rules on
 * it are the rules on who can be inside a tenant at all.
 *
 * Run against a real Postgres rather than a mocked client for the same reason
 * `company-scoping.test.ts` is: the cross-tenant cases turn on whether the
 * generated SQL actually carries the company filter, and a mock would only
 * confirm it returns what it was told to.
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

const actorFor = (
  tenant: Awaited<ReturnType<typeof createTenant>>,
  role: Role,
): Actor => ({
  userId: tenant.owner.id,
  companyId: tenant.company.id,
  role,
});

describe("inviteUser", () => {
  it("creates the account in the inviter's company, never one named in input", async () => {
    const result = await inviteUser(actorFor(a, Role.OWNER), {
      email: "New.Hire@Alpha.test",
      name: "  New Hire  ",
      role: Role.GUARD,
      siteIds: [a.site.id],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const created = await raw.user.findUnique({
      where: { id: result.userId },
      include: { assignments: true },
    });
    expect(created?.companyId).toBe(a.company.id);
    // Normalised on the way in: the unique index is case-sensitive, so
    // "New.Hire@Alpha.test" and "new.hire@alpha.test" would otherwise be two
    // accounts for one person.
    expect(created?.email).toBe("new.hire@alpha.test");
    expect(created?.name).toBe("New Hire");
    expect(created?.role).toBe(Role.GUARD);
    expect(created?.assignments.map((x) => x.siteId)).toEqual([a.site.id]);
    // No PIN yet is what "invited but not set up" actually means.
    expect(created?.pinHash).toBeNull();
  });

  it("writes one audit row naming who let them in", async () => {
    const result = await inviteUser(actorFor(a, Role.OWNER), {
      email: "audited@alpha.test",
      name: "Audited",
      role: Role.GUARD,
      siteIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const events = await raw.auditEvent.findMany({
      where: { action: "user.invite", entityId: result.userId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.companyId).toBe(a.company.id);
    expect(events[0]?.actorId).toBe(a.owner.id);
  });

  it("refuses a role above the inviter's own", async () => {
    // The escalation that matters: an admin minting an owner at an address
    // they control has company settings and deletion a minute later, and the
    // audit trail reads like onboarding.
    const result = await inviteUser(actorFor(a, Role.ADMIN), {
      email: "escalation@alpha.test",
      name: "Escalation",
      role: Role.OWNER,
      siteIds: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/above your own role/);
    await expect(
      raw.user.findUnique({ where: { email: "escalation@alpha.test" } }),
    ).resolves.toBeNull();
  });

  it("allows a role equal to the inviter's own", async () => {
    // The control for the rule above. Without it, a rule that refused
    // everything would pass the escalation test just as happily.
    const result = await inviteUser(actorFor(a, Role.ADMIN), {
      email: "peer@alpha.test",
      name: "Peer",
      role: Role.ADMIN,
      siteIds: [],
    });
    expect(result.ok).toBe(true);
  });

  it("drops a site id belonging to another company", async () => {
    const result = await inviteUser(actorFor(a, Role.OWNER), {
      email: "crosssite@alpha.test",
      name: "Cross Site",
      role: Role.GUARD,
      siteIds: [b.site.id, a.site.id],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const assignments = await raw.siteAssignment.findMany({
      where: { userId: result.userId },
    });
    expect(assignments.map((x) => x.siteId)).toEqual([a.site.id]);
  });

  it("is set up so the cross-company site assignment could have succeeded", async () => {
    // Control for the test above: prove B's site is real and is not A's, so a
    // passing result means the filter worked rather than that the id was junk.
    const other = await raw.site.findUnique({ where: { id: b.site.id } });
    expect(other).not.toBeNull();
    expect(other?.companyId).toBe(b.company.id);
    expect(b.site.id).not.toBe(a.site.id);
  });

  it("names the person when the address is already in this company", async () => {
    const result = await inviteUser(actorFor(a, Role.OWNER), {
      email: a.guard.email,
      name: "Duplicate",
      role: Role.GUARD,
      siteIds: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(a.guard.name);
  });

  it("does not name the person or the company when the address is in another one", async () => {
    // `User.email` is globally unique, so this address genuinely cannot be
    // added. The refusal says so without turning an authenticated admin into a
    // way to look up which firm a named guard works for.
    const result = await inviteUser(actorFor(a, Role.OWNER), {
      email: b.guard.email,
      name: "Poacher",
      role: Role.GUARD,
      siteIds: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(b.guard.name);
    expect(result.error).not.toContain(b.company.name);
    expect(result.error).toMatch(/already in use/);
  });

  it("rejects a blank name before touching the database", async () => {
    const before = await raw.user.count({ where: { companyId: a.company.id } });
    const result = await inviteUser(actorFor(a, Role.OWNER), {
      email: "blank@alpha.test",
      name: "   ",
      role: Role.GUARD,
      siteIds: [],
    });
    expect(result.ok).toBe(false);
    await expect(
      raw.user.count({ where: { companyId: a.company.id } }),
    ).resolves.toBe(before);
  });
});

describe("listTeam", () => {
  it("returns only the actor's own company", async () => {
    const rows = await listTeam(actorFor(a, Role.OWNER));
    const emails = rows.map((row) => row.email);

    expect(emails).toContain(a.owner.email);
    expect(emails).toContain(a.guard.email);
    expect(emails).not.toContain(b.owner.email);
    expect(emails).not.toContain(b.guard.email);
  });

  it("puts people who cannot sign in yet first", async () => {
    const rows = await listTeam(actorFor(a, Role.OWNER));
    const firstSettled = rows.findIndex((row) => !row.awaitingSetup);
    const lastAwaiting = rows.map((row) => row.awaitingSetup).lastIndexOf(true);

    // Everyone awaiting setup sorts before everyone who is not. Written as a
    // boundary rather than a fixed array so adding a fixture does not rewrite
    // the test.
    if (firstSettled !== -1) expect(lastAwaiting).toBeLessThan(firstSettled);
  });

  it("marks someone with a PIN as set up", async () => {
    // The discriminator for the flag above: without a row on each side,
    // `awaitingSetup` could be hardcoded true and every assertion still passes.
    await raw.user.update({
      where: { id: a.guard.id },
      data: { pinHash: "$argon2id$not-a-real-hash" },
    });

    const rows = await listTeam(actorFor(a, Role.OWNER));
    expect(rows.find((row) => row.id === a.guard.id)?.awaitingSetup).toBe(false);
    expect(rows.find((row) => row.id === a.owner.id)?.awaitingSetup).toBe(true);
  });

  it("flags the actor's own row", async () => {
    const rows = await listTeam(actorFor(a, Role.OWNER));
    expect(rows.filter((row) => row.isSelf).map((row) => row.id)).toEqual([a.owner.id]);
  });
});
