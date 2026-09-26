import { describe, expect, it } from "vitest";

import {
  ALWAYS_INCLUDED,
  ENTITLEMENT_LABELS,
  EVIDENCE_FLOOR_MONTHS,
  PLANS,
  RECOMMENDED,
  type Audience,
  type Entitlement,
  hasEntitlement,
  monthlyTotal,
  planById,
  plansFor,
} from "@/lib/billing/plans";

const EVERY_ENTITLEMENT: Entitlement[] = [
  "client_portal",
  "custom_templates",
  "push_alerts",
  "white_label",
  "vendor_roster",
  "report_schedule",
  "compliance_dashboard",
  "missing_report_alerts",
  "cross_vendor_search",
  "procurement_export",
  "sso",
  "api_access",
  "audit_export",
  "delivery_attestation",
];

/**
 * These are not "does the object have the right keys" tests. Each pins a
 * decision that is cheap to reverse by accident and expensive to discover in
 * production or, worse, in a deposition.
 */
describe("plans", () => {
  it("never gates anything on the recording path", () => {
    // With no subscription at all, every entitlement is false -- and none of
    // them corresponds to an act of recording. If somebody later adds
    // `Entitlement = "incident_capture"`, this test is the thing they have to
    // deliberately delete in order to ship it.
    for (const want of EVERY_ENTITLEMENT) {
      expect(hasEntitlement(null, want)).toBe(false);
    }

    const promised = ALWAYS_INCLUDED.join(" ").toLowerCase();
    expect(promised).toContain("clocking in");
    expect(promised).toContain("incident capture");
    expect(promised).toContain("email delivery");
  });

  it("never charges to invite a vendor, on either side", () => {
    // Strategic and ethical at once: a client who adds their fourth guard
    // company is doing the thing we want, and every invited vendor is an
    // operator now using Transient nightly. Charging for it would be putting
    // a turnstile on our own funnel.
    expect(ALWAYS_INCLUDED.join(" ").toLowerCase()).toContain("inviting a vendor");
    for (const e of EVERY_ENTITLEMENT) {
      expect(e).not.toMatch(/invite/);
    }
  });

  it("keeps both audiences populated and non-overlapping", () => {
    const operator = plansFor("operator");
    const client = plansFor("client");
    expect(operator.length).toBeGreaterThan(0);
    expect(client.length).toBeGreaterThan(0);
    expect(operator.length + client.length).toBe(PLANS.length);

    // Units must match the audience. An operator billed per property, or a
    // client billed per site, would mean the meter and the story disagree.
    for (const p of operator) expect(p.unit).toBe("active site");
    for (const p of client) expect(p.unit).toBe("covered property");
  });

  it("gives each audience only entitlements that make sense for it", () => {
    // The client line must not be a cheap backdoor into the operator product.
    // White-labeling the guard company's own brand is meaningless to a hotel
    // buying oversight, and shipping it there would be exactly that backdoor.
    for (const p of plansFor("client")) {
      expect(p.entitlements).not.toContain("white_label");
      expect(p.entitlements).not.toContain("custom_templates");
    }
    // And the operator line does not get cross-vendor oversight tools, which
    // only mean anything to somebody supervising vendors they do not employ.
    for (const p of plansFor("operator")) {
      expect(p.entitlements).not.toContain("compliance_dashboard");
      expect(p.entitlements).not.toContain("cross_vendor_search");
    }
  });

  it("holds every plan at or above the evidence retention floor", () => {
    for (const plan of PLANS) {
      expect(plan.retentionMonths).toBeGreaterThanOrEqual(EVIDENCE_FLOOR_MONTHS);
    }
  });

  it.each<Audience>(["operator", "client"])(
    "orders %s plans so each is a superset of the last",
    (audience) => {
      // Catches the packaging mistake where a mid tier quietly loses something
      // the cheaper tier had. Customers notice immediately and trust does not
      // come back.
      const tiers = plansFor(audience);
      for (let i = 1; i < tiers.length; i += 1) {
        const lower = new Set(tiers[i - 1]!.entitlements);
        const higher = new Set(tiers[i]!.entitlements);
        for (const e of lower) expect(higher.has(e)).toBe(true);
        expect(tiers[i]!.retentionMonths).toBeGreaterThanOrEqual(
          tiers[i - 1]!.retentionMonths,
        );
      }
    },
  );

  it("quotes no number for the top tier of either line", () => {
    expect(planById("enterprise").pricePerUnitMonth).toBeNull();
    expect(planById("institution").pricePerUnitMonth).toBeNull();
    expect(monthlyTotal(planById("enterprise"), 40)).toBeNull();
    expect(monthlyTotal(planById("institution"), 40)).toBeNull();
  });

  it("charges the plan minimum when a buyer has fewer units than that", () => {
    const essential = planById("essential"); // $39, min 3 sites
    expect(monthlyTotal(essential, 1)).toBe(117);
    expect(monthlyTotal(essential, 3)).toBe(117);
    expect(monthlyTotal(essential, 10)).toBe(390);

    // The client line's entry tier has no minimum beyond one property, because
    // a single hotel is a real buyer and a 3-property floor would exclude them.
    const oversight = planById("oversight"); // $149, min 1 property
    expect(monthlyTotal(oversight, 1)).toBe(149);
  });

  it("makes Portfolio cheaper per property than Oversight", () => {
    // Volume has to actually pay off, or the tier is a price rise dressed as
    // an upgrade.
    const oversight = planById("oversight");
    const portfolio = planById("portfolio");
    expect(portfolio.pricePerUnitMonth!).toBeLessThan(oversight.pricePerUnitMonth!);
    expect(portfolio.minUnits).toBeGreaterThan(oversight.minUnits);
  });

  it("resolves entitlements per plan, not globally", () => {
    expect(hasEntitlement("essential", "client_portal")).toBe(false);
    expect(hasEntitlement("operations", "client_portal")).toBe(true);
    expect(hasEntitlement("operations", "sso")).toBe(false);
    expect(hasEntitlement("assurance", "sso")).toBe(true);
    expect(hasEntitlement("assurance", "white_label")).toBe(false);
    expect(hasEntitlement("enterprise", "white_label")).toBe(true);

    expect(hasEntitlement("oversight", "compliance_dashboard")).toBe(false);
    expect(hasEntitlement("portfolio", "compliance_dashboard")).toBe(true);
    expect(hasEntitlement("portfolio", "sso")).toBe(false);
    expect(hasEntitlement("institution", "sso")).toBe(true);
  });

  it("has no free tier, on either side", () => {
    // Deliberate, and a rule rather than an observation about today's numbers.
    // A $0 plan here would mean holding somebody's legal record for nothing,
    // which ends exactly one way: we eventually need the money back, and the
    // only leverage is the evidence. Charging from the first site keeps the
    // retention promise in `ALWAYS_INCLUDED` something we can actually afford
    // to keep. The trial is time-boxed instead, which expires without ever
    // putting a record behind a card.
    for (const plan of PLANS) {
      expect(plan.pricePerUnitMonth, `${plan.id} is free`).not.toBe(0);
      if (plan.pricePerUnitMonth !== null) {
        expect(plan.pricePerUnitMonth, `${plan.id} price`).toBeGreaterThan(0);
      }
    }
  });

  it("names every entitlement it can render in a comparison table", () => {
    // The table is generated from each plan's entitlements, so an unlabelled
    // one renders a blank row: a capability a buyer is paying for, shown as
    // nothing. `Record<Entitlement, string>` makes tsc catch it, and this
    // catches the empty-string version tsc cannot see.
    for (const entitlement of EVERY_ENTITLEMENT) {
      const label = ENTITLEMENT_LABELS[entitlement];
      expect(label, `${entitlement} has no label`).toBeTruthy();
      expect(label.trim().length, `${entitlement} label`).toBeGreaterThan(3);
    }
  });

  it("recommends a real, buyable plan on each side", () => {
    // The badge is the only plan we actively point people at. Pointing it at
    // a quote-only tier would send every small operator into a sales process
    // they do not need, and pointing it at the wrong audience's plan would be
    // invisible on the page while being obviously wrong to the buyer.
    for (const audience of ["operator", "client"] as const) {
      const plan = planById(RECOMMENDED[audience]);
      expect(plan.audience, `${audience} recommendation`).toBe(audience);
      expect(
        plan.pricePerUnitMonth,
        `${audience} recommendation is quote-only`,
      ).not.toBe(null);
    }
  });

  it("throws on an unknown plan instead of silently granting nothing", () => {
    // Failing closed but loudly. A typo'd plan id that quietly returned false
    // would look exactly like a downgrade to the user.
    expect(() => planById("pro" as never)).toThrow(/unknown plan/);
  });
});
