import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Role, SubscriptionStatus } from "@/generated/prisma/enums";
import { signUpSchema, type SignUpInput } from "@/lib/auth/sign-up-token";
import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";
import {
  companySlugFromName,
  createCompanyFromSignUp,
  trialPlanId,
} from "@/lib/db/sign-up";
import { DEFAULT_ENTRY_TYPES } from "@/lib/sites/defaults";
import { raw, resetDatabase } from "./helpers";

/**
 * Sign-up is the only path that creates a tenant, and every row it writes is
 * one nothing else can repair: a company with no owner is unreachable forever,
 * and an owner with no site opens the app to a dead end.
 *
 * Against a real Postgres rather than a mock, because the two things most
 * likely to break are the unique constraint on `Company.slug` and the
 * all-or-nothing behaviour of the transaction, and neither exists in a mock.
 */

const INPUT: SignUpInput = signUpSchema.parse({
  companyName: "Meridian Protective Services",
  name: "Dana Whitfield",
  email: "dana@meridian.test",
  siteName: "Westside Hotel — Sunset Strip",
  siteAddress: "8400 Sunset Boulevard, West Hollywood, CA",
  timezone: "America/New_York",
});

const withEmail = (email: string): SignUpInput => ({ ...INPUT, email });

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await raw.$disconnect();
});

describe("createCompanyFromSignUp", () => {
  it("creates a company, an owner and a working first site", async () => {
    const result = await createCompanyFromSignUp(INPUT);
    expect(result.created).toBe(true);

    const user = await raw.user.findUniqueOrThrow({
      where: { id: result.userId },
      include: { assignments: true },
    });
    expect(user.email).toBe("dana@meridian.test");
    expect(user.name).toBe("Dana Whitfield");
    expect(user.role).toBe(Role.OWNER);
    // They arrived by clicking a link sent to this address, which is the same
    // proof the magic-link flow accepts. Asking them to verify again would be
    // asking twice for the same thing.
    expect(user.emailVerified).toBeInstanceOf(Date);
    expect(user.companyId).toBe(result.companyId);

    const site = await raw.site.findFirstOrThrow({
      where: { companyId: result.companyId },
    });
    expect(site.name).toBe("Westside Hotel — Sunset Strip");
    expect(site.address).toBe("8400 Sunset Boulevard, West Hollywood, CA");
    expect(site.code).toBe("WHSS");
    // The browser's zone, not the server's. An entry logged at 11pm has to
    // file against the night the guard worked.
    expect(site.timezone).toBe("America/New_York");

    // Grants nothing (an OWNER already sees every site), written so the site
    // does not look unstaffed on day one.
    expect(user.assignments.map((a) => a.siteId)).toEqual([site.id]);
  });

  it("gives the first site something to tap", async () => {
    const result = await createCompanyFromSignUp(INPUT);
    const site = await raw.site.findFirstOrThrow({
      where: { companyId: result.companyId },
    });
    const types = await raw.siteEntryType.findMany({
      where: { siteId: site.id },
      orderBy: { order: "asc" },
    });

    // A site with no entry types does not throw anywhere — `siteEntryTypeId`
    // is optional throughout — so the failure would be a guard opening the
    // incident sheet to an empty list. Same definition the seed uses.
    expect(types.map((t) => t.key)).toEqual(
      DEFAULT_ENTRY_TYPES.map((t) => t.key),
    );
    expect(types.map((t) => t.label)).toEqual(
      DEFAULT_ENTRY_TYPES.map((t) => t.label),
    );
  });

  it("starts them on a trial that the billing layer can actually read", async () => {
    const before = Date.now();
    const result = await createCompanyFromSignUp(INPUT);
    const company = await raw.company.findUniqueOrThrow({
      where: { id: result.companyId },
    });

    expect(company.subscriptionStatus).toBe(SubscriptionStatus.TRIALING);
    // `inTrial` reads the status and this date, never the plan, so trialing
    // with no plan chosen is a supported state rather than a hole.
    expect(company.planId).toBeNull();
    expect(company.trialEndsAt).not.toBeNull();

    const days = Math.round(
      ((company.trialEndsAt?.getTime() ?? 0) - before) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(TRIAL_DAYS);
  });

  it("carries a plan through from the pricing card they clicked", async () => {
    const plan = PLANS[0]?.id ?? "";
    const result = await createCompanyFromSignUp(INPUT, { planId: plan });
    const company = await raw.company.findUniqueOrThrow({
      where: { id: result.companyId },
    });

    expect(company.planId).toBe(plan);
    // Still a trial. Picking a tier on the marketing page is a preference,
    // not a purchase.
    expect(company.subscriptionStatus).toBe(SubscriptionStatus.TRIALING);
  });

  it("records who created the company, against the company", async () => {
    const result = await createCompanyFromSignUp(INPUT);
    const events = await raw.auditEvent.findMany({
      where: { companyId: result.companyId, action: "company.create" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe(result.userId);
    expect(events[0]?.entityId).toBe(result.companyId);
  });
});

describe("createCompanyFromSignUp, clicked twice", () => {
  it("returns the existing account instead of a second company", async () => {
    // Mail clients prefetch, people double-tap, links get forwarded. The
    // second click has to be a sign-in, not a new tenant.
    const first = await createCompanyFromSignUp(INPUT);
    const second = await createCompanyFromSignUp(INPUT);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.companyId).toBe(first.companyId);

    expect(await raw.company.count()).toBe(1);
    expect(await raw.user.count()).toBe(1);
    expect(await raw.site.count()).toBe(1);
  });

  it("does not write a second company.create on the replay", async () => {
    await createCompanyFromSignUp(INPUT);
    await createCompanyFromSignUp(INPUT);

    expect(await raw.auditEvent.count({ where: { action: "company.create" } }))
      .toBe(1);
  });

  it("matches the existing account however the address is cased", async () => {
    // `signUpSchema` lowercases on parse, so both tokens carry one form. If
    // that ever stopped, this would create a second tenant for one person.
    const first = await createCompanyFromSignUp(INPUT);
    const again = await createCompanyFromSignUp(
      signUpSchema.parse({ ...INPUT, email: "Dana@Meridian.TEST" }),
    );

    expect(again.created).toBe(false);
    expect(again.userId).toBe(first.userId);
  });
});

describe("createCompanyFromSignUp, name already taken", () => {
  it("still creates the company rather than failing on the unique slug", async () => {
    // `Company.slug` is the one field a new company can collide on, and two
    // firms genuinely can share a name.
    const a = await createCompanyFromSignUp(withEmail("a@one.test"));
    const b = await createCompanyFromSignUp(withEmail("b@two.test"));
    const c = await createCompanyFromSignUp(withEmail("c@three.test"));

    const slugs = await raw.company.findMany({ select: { slug: true } });
    const values = slugs.map((s) => s.slug).sort();

    expect(new Set([a.companyId, b.companyId, c.companyId]).size).toBe(3);
    expect(new Set(values).size).toBe(3);
    expect(values).toEqual([
      "meridian-protective-services",
      "meridian-protective-services-2",
      "meridian-protective-services-3",
    ]);
  });

  it("keeps each company's site and owner on its own tenant", async () => {
    const a = await createCompanyFromSignUp(withEmail("a@one.test"));
    const b = await createCompanyFromSignUp(withEmail("b@two.test"));

    const sitesForA = await raw.site.findMany({
      where: { companyId: a.companyId },
    });
    expect(sitesForA).toHaveLength(1);
    expect(sitesForA[0]?.companyId).toBe(a.companyId);

    const ownerB = await raw.user.findUniqueOrThrow({ where: { id: b.userId } });
    expect(ownerB.companyId).toBe(b.companyId);
    expect(ownerB.companyId).not.toBe(a.companyId);
  });
});

describe("companySlugFromName", () => {
  it("makes a URL-safe slug", () => {
    expect(companySlugFromName("Meridian Protective Services")).toBe(
      "meridian-protective-services",
    );
    expect(companySlugFromName("  A&B  Security, Inc.  ")).toBe("a-b-security-inc");
  });

  it("never returns an empty string", () => {
    // A name in a non-Latin script slugs to nothing, and two empty slugs
    // would collide on a unique column.
    expect(companySlugFromName("警備")).toBe("company");
    expect(companySlugFromName("!!!")).toBe("company");
  });

  it("stays inside a sane length", () => {
    expect(companySlugFromName("a".repeat(200)).length).toBeLessThanOrEqual(48);
  });
});

describe("trialPlanId", () => {
  it("accepts a plan the pricing page actually sells", () => {
    const plan = PLANS[0]?.id ?? "";
    expect(trialPlanId(plan)).toBe(plan);
  });

  it("ignores anything else rather than failing the sign-up", () => {
    // `?plan=` comes off a link anyone can edit. Null is a real supported
    // state, so a junk value costs them nothing.
    expect(trialPlanId("enterprise-unlimited-free")).toBeNull();
    expect(trialPlanId("")).toBeNull();
    expect(trialPlanId(null)).toBeNull();
    expect(trialPlanId(undefined)).toBeNull();
  });
});
