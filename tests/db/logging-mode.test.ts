import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { enqueue } from "@/lib/db/jobs";
import { buildReport } from "@/lib/jobs/handlers/build-report";
import { runJobs } from "@/lib/jobs/runner";
import { capabilitiesFor, producesReport } from "@/lib/sites/logging-mode";

import { createTenant, raw, resetDatabase } from "./helpers";

/**
 * A site that asked for verbal handover must not produce a document.
 *
 * This is the one rule in the product where being wrong is not a bug report,
 * it is us sending a record about somebody's school to a list that school
 * declined. So it is tested at the layer that can actually do the damage --
 * the job handler -- and not only at the screen that offers the button.
 *
 * Everything here runs against real Postgres. A mocked Prisma would let the
 * refusal pass while the real query happily returned a site whose mode nobody
 * had selected.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

async function tenantWithMode(slug: string, mode: "FULL" | "LIGHT" | "VERBAL") {
  const tenant = await createTenant(slug);
  await raw.site.update({
    where: { id: tenant.site.id },
    data: { loggingMode: mode },
  });
  await raw.shift.update({
    where: { id: tenant.shift.id },
    data: {
      clockInAt: new Date("2026-02-01T06:02:00.000Z"),
      clockOutAt: new Date("2026-02-01T16:04:00.000Z"),
    },
  });
  return tenant;
}

describe("the capability table", () => {
  it("only FULL and LIGHT produce anything sendable", () => {
    expect(producesReport("FULL")).toBe(true);
    expect(producesReport("LIGHT")).toBe(true);
    expect(producesReport("VERBAL")).toBe(false);
  });

  it("VERBAL has no recipient list to send to, which is the same fact twice", () => {
    const verbal = capabilitiesFor("VERBAL");
    expect(verbal.report).toBe("none");
    expect(verbal.recipients).toBe(false);
    // If these two ever disagree, one screen will offer a recipient list for a
    // site that can never send to it.
    expect(verbal.recipients).toBe(producesReport("VERBAL"));
  });

  it("LIGHT keeps the timeline it was sold on and only drops the document", () => {
    const light = capabilitiesFor("LIGHT");
    expect(light.report).toBe("email");
    expect(light.photos).toBe(true);
    expect(light.incidents).toBe(true);
    expect(light.maxEntries).toBeNull();
  });
});

describe("the build handler", () => {
  it("refuses a VERBAL site and writes no report row", async () => {
    const tenant = await tenantWithMode("verbalrefuse", "VERBAL");

    const result = await buildReport({
      shiftId: tenant.shift.id,
      requestedById: tenant.owner.id,
    });

    expect(result.result).toBe("not-permitted");
    expect(result.reportId).toBeNull();
    // Not "a report that was never sent" -- no report at all. A DRAFT row is
    // still a record we generated about that site.
    expect(await raw.report.count({ where: { shiftId: tenant.shift.id } })).toBe(0);
  });

  it("refuses through the queue too, and does not burn retries doing it", async () => {
    const tenant = await tenantWithMode("verbalqueue", "VERBAL");

    await enqueue("GENERATE_REPORT", {
      shiftId: tenant.shift.id,
      requestedById: tenant.owner.id,
    });
    const summary = await runJobs({ limit: 5 });

    // Succeeded, not failed. A refusal is a correct outcome, and marking it
    // FAILED would retry it five times and then show a supervisor an error
    // about a report they never asked for.
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(await raw.report.count({ where: { shiftId: tenant.shift.id } })).toBe(0);
  });

  it("still builds for a FULL site, so the refusal is not just breaking builds", async () => {
    const tenant = await tenantWithMode("fullbuilds", "FULL");

    const result = await buildReport({
      shiftId: tenant.shift.id,
      requestedById: tenant.owner.id,
    });

    expect(result.result).toBe("built");
    expect(result.reportId).toBeTruthy();
    expect(await raw.report.count({ where: { shiftId: tenant.shift.id } })).toBe(1);
  }, 60_000);

  it("a retry continues the same version instead of opening a new one", async () => {
    const tenant = await tenantWithMode("retryversion", "FULL");
    const payload = { shiftId: tenant.shift.id, requestedById: tenant.owner.id };

    await buildReport(payload);
    const first = await raw.report.findFirstOrThrow({
      where: { shiftId: tenant.shift.id },
    });
    await raw.report.update({
      where: { id: first.id },
      data: { status: "FAILED" },
    });

    await buildReport(payload);

    const all = await raw.report.findMany({ where: { shiftId: tenant.shift.id } });
    expect(all).toHaveLength(1);
    expect(all[0]!.version).toBe(1);
    expect(all[0]!.id).toBe(first.id);
  }, 90_000);
});
