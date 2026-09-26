/**
 * Plans for both sides of this market, and the rules about what a plan may
 * never withhold.
 *
 * ## There are two buyers, and they are not the same product
 *
 * **Operators** are contract guard companies. They run guards across many
 * client sites and they buy Transient to prove their service is being
 * delivered, especially at renewal.
 *
 * **Clients** are the organisations that hire those companies: school
 * districts, hospitals, hotels, campuses, property managers. They buy
 * Transient to make every vendor report into one standard and to hold the
 * delivery record themselves instead of in a procurement inbox.
 *
 * These overlap on a building and stay distinct on the thing being bought.
 * An operator is paying to run the work. A client is paying for oversight
 * across vendors they do not employ. When a hotel and the firm guarding it
 * both pay us for the same address, that is two products, not double billing,
 * and the pricing page says so in those words rather than hiding it.
 *
 * One case that looks two-sided and is not: an in-house security team, like a
 * hospital that employs its own officers. They are an operator. They are
 * running the work, so they buy the operator line.
 *
 * ## The meters
 *
 * Operator: **active site-month.** Every obvious competitor prices per guard,
 * which is wrong here specifically. Guard rotations turn over constantly and a
 * per-seat bill is a standing incentive to share one login across a crew. A
 * shared login destroys attribution, and attribution is the entire thing a
 * client is paying for when they ask who walked the dock at 02:40. Per-guard
 * pricing would charge for the audit trail while paying operators to corrupt
 * it. So: per active site, unlimited guards on it. A site is active in a month
 * if at least one shift was clocked in against it; a dark site is not billed,
 * which makes seasonal and event work honest rather than something to hide by
 * deleting the site.
 *
 * Client: **covered property-month.** Never per vendor. Charging a hospital to
 * add its fourth guard company would tax them for the exact behaviour we want,
 * and every vendor invited into a client's workspace is an operator who now
 * uses Transient nightly and can buy their own workspace later. Vendor invites
 * are our cheapest acquisition channel, so putting a price on one would be
 * charging admission to our own funnel.
 *
 * Officer Reports is the public precedent that a per-site meter sells in this
 * category at all (per-site, unlimited officers, monthly, no contract), at
 * roughly $40/site/mo mobile and $60-70/site/mo static. Those anchor the
 * operator line below. There is no comparable public anchor for the client
 * line; see ASSUMPTIONS.md, which records that honestly rather than implying a
 * benchmark exists.
 *
 * ## What no plan may withhold
 *
 * The rule that decided every row of `ALWAYS_INCLUDED`:
 *
 *   The pricing system must never be the reason the record is incomplete.
 *
 * A guard on a lapsed subscription still clocks in, still logs, still captures
 * an incident with photos, and the report still generates and still sends. If
 * money is owed we restrict who can pull history out, and we say so loudly in
 * the app. We do not quietly drop the night a building actually burned.
 * Anything else makes billing state a variable in a legal record, and "their
 * card expired" is not a defensible answer to why February is missing.
 */

export type Audience = "operator" | "client";

export type PlanId =
  // Operator line: contract guard companies.
  | "essential"
  | "operations"
  | "assurance"
  | "enterprise"
  // Client line: the organisations that hire them.
  | "oversight"
  | "portfolio"
  | "institution";

export type Plan = {
  id: PlanId;
  audience: Audience;
  name: string;
  /** USD per billable unit per month. Null means quote-only. */
  pricePerUnitMonth: number | null;
  /** What one billable unit is, for this audience. */
  unit: "active site" | "covered property";
  /** Smallest number of units this plan can be bought for. */
  minUnits: number;
  /** One line on who this is actually for. */
  fit: string;
  /** How long a completed report stays retrievable in the product. */
  retentionMonths: number;
  /** Ordered, concrete, no filler. Rendered as the plan's feature list. */
  includes: readonly string[];
  /** Capabilities this plan unlocks, checked by `hasEntitlement`. */
  entitlements: readonly Entitlement[];
};

/**
 * The gated capabilities. Deliberately short.
 *
 * Every one is an administrative convenience, an integration, or a
 * distribution channel. None is an act of recording. Read the list and notice
 * what is absent: nothing here governs logging, photo capture, incident
 * creation, report generation, or delivery, and nothing here governs inviting
 * a vendor. Those live in `ALWAYS_INCLUDED` and no flag can switch them off.
 */
export type Entitlement =
  // --- Operator side ---
  /** Read-only logins the operator grants to their own client. */
  | "client_portal"
  /** Per-site report templates beyond the built-in defaults. */
  | "custom_templates"
  /** Web Push to supervisors on incident severity. */
  | "push_alerts"
  /** Reseller white-labeling: the guard company's brand, not ours. */
  | "white_label"
  // --- Client side ---
  /** Roster of vendors and which sites each is responsible for. */
  | "vendor_roster"
  /** Required report schedule per site, and what counts as on time. */
  | "report_schedule"
  /** Who is filing on time, across every vendor, in one view. */
  | "compliance_dashboard"
  /** Alert when a required report never arrived at all. */
  | "missing_report_alerts"
  /** Incident search spanning vendors, not one vendor at a time. */
  | "cross_vendor_search"
  /** Contract-review export: coverage and delivery over a date range. */
  | "procurement_export"
  // --- Both ---
  /** SAML / OIDC single sign-on. */
  | "sso"
  /** Programmatic read access to shifts, reports and delivery state. */
  | "api_access"
  /** Bulk export of the immutable audit log. */
  | "audit_export"
  /** A signed quarterly statement of what was delivered and when. */
  | "delivery_attestation";

/**
 * Never gated, on any plan, in either line, including a lapsed one.
 *
 * Not decoration: a test asserts every one of these stays reachable while
 * `hasEntitlement` returns false for everything, so an entitlement that tried
 * to fence off one of these concepts fails the suite rather than quietly
 * shipping a paywall in front of an incident report.
 */
export const ALWAYS_INCLUDED = [
  "Clocking in and out, including the site's blind-spot checks",
  "Every kind of entry: notes, photos, patrols, packages, property checks",
  "Incident capture with photos, at any severity",
  "Logging with no signal, syncing when there is some",
  "Report generation at end of shift",
  "Email delivery, and the delivery receipt that comes back",
  "The content hash printed on every report",
  "Inviting a vendor, or being invited as one",
  "Twelve months of incident evidence, on every plan",
  "Exporting your own data, at any time, including after you cancel",
] as const;

/** Retention floor that applies even when a subscription has lapsed. */
export const EVIDENCE_FLOOR_MONTHS = 12;

const OPERATOR_PLANS: readonly Plan[] = [
  {
    id: "essential",
    audience: "operator",
    name: "Essential",
    pricePerUnitMonth: 39,
    unit: "active site",
    minUnits: 3,
    fit: "A crew running a handful of static sites who are emailing PDFs by hand today.",
    retentionMonths: 12,
    includes: [
      "Unlimited guards on every site",
      "Site-specific blind-spot and property checks",
      "One-tap timeline, photos, voice notes",
      "End-of-shift PDF with the content hash",
      "Unlimited recipients, no account needed on their side",
      "Delivery and bounce tracking on every send",
      "12 months of report history",
    ],
    entitlements: [],
  },
  {
    id: "operations",
    audience: "operator",
    name: "Operations",
    pricePerUnitMonth: 79,
    unit: "active site",
    minUnits: 3,
    fit: "Multi-site operators whose clients ask for their own access and their own format.",
    retentionMonths: 24,
    includes: [
      "Everything in Essential",
      "Read-only logins for your clients, scoped to their sites",
      "Custom report sections per site",
      "Push alerts to supervisors on high-severity incidents",
      "24 months of report history",
    ],
    entitlements: ["client_portal", "custom_templates", "push_alerts"],
  },
  {
    id: "assurance",
    audience: "operator",
    name: "Assurance",
    pricePerUnitMonth: 149,
    unit: "active site",
    minUnits: 5,
    fit: "Contracts with a procurement department: districts, health systems, anyone who will ask for a DPA.",
    retentionMonths: 84,
    includes: [
      "Everything in Operations",
      "SSO through SAML or OIDC",
      "Read API for shifts, reports and delivery state",
      "Bulk audit-log export",
      "Quarterly signed delivery attestation",
      "7 years of report history",
    ],
    entitlements: [
      "client_portal",
      "custom_templates",
      "push_alerts",
      "sso",
      "api_access",
      "audit_export",
      "delivery_attestation",
    ],
  },
  {
    id: "enterprise",
    audience: "operator",
    name: "Enterprise",
    pricePerUnitMonth: null,
    unit: "active site",
    minUnits: 25,
    fit: "Regional and national operators who need our product under their own brand.",
    retentionMonths: 120,
    includes: [
      "Everything in Assurance",
      "White-label: your brand on the app and on the report",
      "Named support contact and an uptime commitment",
      "Security review, DPA and BAA support",
      "Retention set to your contract, not ours",
    ],
    entitlements: [
      "client_portal",
      "custom_templates",
      "push_alerts",
      "sso",
      "api_access",
      "audit_export",
      "delivery_attestation",
      "white_label",
    ],
  },
] as const;

const CLIENT_PLANS: readonly Plan[] = [
  {
    id: "oversight",
    audience: "client",
    name: "Oversight",
    pricePerUnitMonth: 149,
    unit: "covered property",
    minUnits: 1,
    fit: "One hotel, one school, one building, with one or two guard companies covering it.",
    retentionMonths: 24,
    includes: [
      "Invite as many vendors as you use, free, always",
      "Every vendor's reports in one place, in one format",
      "Required report schedule per site",
      "Alerts when a required report never arrives",
      "Delivery record you hold, not your vendor",
      "24 months of history",
    ],
    entitlements: ["vendor_roster", "report_schedule", "missing_report_alerts"],
  },
  {
    id: "portfolio",
    audience: "client",
    name: "Portfolio",
    pricePerUnitMonth: 129,
    unit: "covered property",
    minUnits: 5,
    fit: "Property managers and multi-site operators comparing vendors across a portfolio.",
    retentionMonths: 36,
    includes: [
      "Everything in Oversight",
      "Vendor compliance dashboard: who files on time, who does not",
      "Incident search across every vendor at once",
      "Coverage and delivery export for contract review",
      "36 months of history",
    ],
    entitlements: [
      "vendor_roster",
      "report_schedule",
      "missing_report_alerts",
      "compliance_dashboard",
      "cross_vendor_search",
      "procurement_export",
    ],
  },
  {
    id: "institution",
    audience: "client",
    name: "Institution",
    pricePerUnitMonth: null,
    unit: "covered property",
    minUnits: 20,
    fit: "School districts and health systems with a procurement office and a records policy.",
    retentionMonths: 120,
    includes: [
      "Everything in Portfolio",
      "SSO through SAML or OIDC",
      "Read API and bulk audit-log export",
      "Quarterly signed delivery attestation",
      "Retention set to your records policy",
      "FERPA DPA and HIPAA BAA support",
    ],
    entitlements: [
      "vendor_roster",
      "report_schedule",
      "missing_report_alerts",
      "compliance_dashboard",
      "cross_vendor_search",
      "procurement_export",
      "sso",
      "api_access",
      "audit_export",
      "delivery_attestation",
    ],
  },
] as const;

export const PLANS: readonly Plan[] = [...OPERATOR_PLANS, ...CLIENT_PLANS];

/** 30 days, no card. Long enough to cover a full billing cycle with a client. */
export const TRIAL_DAYS = 30;

export function plansFor(audience: Audience): readonly Plan[] {
  return PLANS.filter((p) => p.audience === audience);
}

export function planById(id: PlanId): Plan {
  const found = PLANS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown plan: ${id}`);
  return found;
}

/**
 * Cheapest published price for an audience, for marketing copy.
 *
 * Exists so the landing page cannot quote a number this module has stopped
 * charging. Quote-only plans are skipped rather than counted as free.
 */
export function startingPrice(audience: Audience): { price: number; unit: string } {
  const priced = plansFor(audience).filter(
    (p): p is Plan & { pricePerUnitMonth: number } => p.pricePerUnitMonth !== null,
  );
  if (priced.length === 0) throw new Error(`no priced plan for audience: ${audience}`);
  const cheapest = priced.reduce((a, b) =>
    b.pricePerUnitMonth < a.pricePerUnitMonth ? b : a,
  );
  return { price: cheapest.pricePerUnitMonth, unit: cheapest.unit };
}

/**
 * The single question the rest of the app asks.
 *
 * `null` means no subscription at all -- a lapsed or never-started account.
 * That is a real state and it resolves to "no extras", never to "no product":
 * nothing in `ALWAYS_INCLUDED` is reachable through this function, so a caller
 * cannot accidentally gate recording behind it.
 */
export function hasEntitlement(plan: PlanId | null, want: Entitlement): boolean {
  if (!plan) return false;
  return planById(plan).entitlements.includes(want);
}

/**
 * Monthly total for a plan and a unit count, in whole dollars.
 *
 * Returns null for quote-only plans rather than inventing a number, because a
 * pricing page that makes up an enterprise figure is how you lose the deal in
 * the first email.
 */
export function monthlyTotal(plan: Plan, units: number): number | null {
  if (plan.pricePerUnitMonth === null) return null;
  return plan.pricePerUnitMonth * Math.max(units, plan.minUnits);
}
