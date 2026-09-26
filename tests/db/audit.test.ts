import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";
import {
  auditActionsPresent,
  auditActors,
  canViewAudit,
  listAuditEvents,
  record,
} from "@/lib/db/audit";
import type { Actor } from "@/lib/db/scoped";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * The audit log, against a real Postgres.
 *
 * Two claims are worth proving and neither is provable with a mock. First,
 * that the log is company-scoped in the SQL rather than in a filter someone
 * can forget: an audit trail that leaks across tenants is worse than none,
 * because it is trusted. Second, that `record()` genuinely swallows a failure
 * — that is a deliberate silent gap and a reader should be able to see it
 * asserted rather than take the comment's word for it.
 */
let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;

const actorFor = (
  tenant: Awaited<ReturnType<typeof createTenant>>,
  who: "owner" | "guard",
): Actor => ({
  userId: tenant[who].id,
  companyId: tenant.company.id,
  role: who === "owner" ? Role.OWNER : Role.GUARD,
});

beforeAll(async () => {
  await resetDatabase();
  a = await createTenant("audit-a");
  b = await createTenant("audit-b");

  await record({
    companyId: a.company.id,
    actorId: a.guard.id,
    action: "shift.start",
    entityType: "Shift",
    entityId: a.shift.id,
  });
  await record({
    companyId: a.company.id,
    actorId: a.owner.id,
    action: "entry.delete",
    entityType: "Entry",
    entityId: "entry-a-1",
    metadata: { reason: "duplicate of 14:02" },
  });
  await record({
    companyId: b.company.id,
    actorId: b.guard.id,
    action: "shift.start",
    entityType: "Shift",
    entityId: b.shift.id,
  });
});

afterAll(async () => {
  await raw.$disconnect();
});

describe("listAuditEvents", () => {
  it("returns only this company's events", async () => {
    const { rows, total } = await listAuditEvents(actorFor(a, "owner"));
    expect(total).toBe(2);
    expect(rows.map((row) => row.action).sort()).toEqual([
      "entry.delete",
      "shift.start",
    ]);
    // The sibling tenant's shift id must not appear anywhere in the page.
    expect(rows.some((row) => row.entityId === b.shift.id)).toBe(false);
  });

  it("does not leak a sibling company's event through a filter", async () => {
    // Asking for the *other* tenant's actor must not widen the scope. A
    // filter applied after the company clause is safe; one applied instead of
    // it is the bug this catches.
    const { rows, total } = await listAuditEvents(actorFor(a, "owner"), {
      actorId: b.guard.id,
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it("filters by action", async () => {
    const { rows, total } = await listAuditEvents(actorFor(a, "owner"), {
      action: "entry.delete",
    });
    expect(total).toBe(1);
    expect(rows[0]?.entityId).toBe("entry-a-1");
  });

  it("filters by date range, inclusive of both ends", async () => {
    const now = new Date();
    const wide = await listAuditEvents(actorFor(a, "owner"), {
      from: new Date(now.getTime() - 60_000),
      to: new Date(now.getTime() + 60_000),
    });
    expect(wide.total).toBe(2);

    const past = await listAuditEvents(actorFor(a, "owner"), {
      to: new Date(now.getTime() - 60_000),
    });
    expect(past.total).toBe(0);
  });

  it("carries a human label and the metadata detail", async () => {
    const { rows } = await listAuditEvents(actorFor(a, "owner"), {
      action: "entry.delete",
    });
    expect(rows[0]?.label).not.toBe("entry.delete");
    expect(rows[0]?.metadata).toMatchObject({ reason: "duplicate of 14:02" });
  });
});

describe("record", () => {
  it("does not throw when the write is impossible", async () => {
    // The audited action must win. A guard is not blocked from clocking in
    // because the log is unavailable, and a webhook that 500s on an audit
    // failure gets retried by the provider and double-applies its status.
    await expect(
      record({
        companyId: "company-that-does-not-exist",
        actorId: null,
        action: "shift.start",
        entityType: "Shift",
        entityId: "x",
      }),
    ).resolves.toBeUndefined();

    // And the failure really was a failure, not a silently accepted row.
    const orphans = await raw.auditEvent.count({
      where: { companyId: "company-that-does-not-exist" },
    });
    expect(orphans).toBe(0);
  });

  it("accepts a null actor, because recipients have no account", async () => {
    await record({
      companyId: a.company.id,
      actorId: null,
      action: "recipient.verify",
      entityType: "Recipient",
      entityId: "recipient-a-1",
      metadata: { email: "ops@client.test" },
    });

    const { rows } = await listAuditEvents(actorFor(a, "owner"), {
      action: "recipient.verify",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorName).toBeNull();
  });
});

describe("filter sources", () => {
  it("lists only this company's people", async () => {
    const actors = await auditActors(actorFor(a, "owner"));
    const ids = actors.map((person) => person.id);
    expect(ids).toContain(a.guard.id);
    expect(ids).toContain(a.owner.id);
    expect(ids).not.toContain(b.guard.id);
  });

  it("lists only actions this company has actually generated", async () => {
    const actions = await auditActionsPresent(actorFor(a, "owner"));
    // Offering every action in the union would give a supervisor filters that
    // always return nothing, which reads as a broken page.
    expect(actions).toContain("entry.delete");
    expect(actions).not.toContain("report.send");
  });
});

describe("canViewAudit", () => {
  it("admits owners and admins, refuses guards and supervisors", () => {
    expect(canViewAudit(actorFor(a, "owner"))).toBe(true);
    expect(canViewAudit(actorFor(a, "guard"))).toBe(false);
    expect(canViewAudit({ ...actorFor(a, "guard"), role: Role.SUPERVISOR })).toBe(
      false,
    );
    expect(canViewAudit({ ...actorFor(a, "guard"), role: Role.ADMIN })).toBe(true);
  });
});
