import "server-only";

import {
  EVIDENCE_FLOOR_MONTHS,
  hasEntitlement,
  monthlyTotal,
  planById,
  TRIAL_DAYS,
  type Entitlement,
  type Plan,
  type PlanId,
} from "@/lib/billing/plans";

import { prisma } from "@/lib/db/client";

import type { SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * What the app knows about a company's subscription, resolved once.
 *
 * `plan` is null for a company that never subscribed and for one whose
 * subscription is gone. Both mean the same thing to every caller: no extras.
 * Callers that need to *say* something different to an administrator read
 * `status` instead.
 */
export type Subscription = {
  plan: Plan | null;
  status: SubscriptionStatus | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** True while a trial is running and has not yet expired. */
  inTrial: boolean;
  /** Days left in the trial, floored at 0. Null when there is no trial. */
  trialDaysLeft: number | null;
  /**
   * How far back report history is retrievable, in months.
   *
   * Never below `EVIDENCE_FLOOR_MONTHS`, including for a company with no
   * subscription at all. A lapsed card is not a reason the night of an
   * incident becomes unavailable.
   */
  retentionMonths: number;
};

/**
 * A plan id that is not in `plans.ts` is a data error, not a downgrade.
 *
 * `planById` throws, and the throw is caught here rather than propagated,
 * because the alternative is a 500 on every signed-in screen the moment a
 * plan is renamed. Resolving to "no plan" degrades to the free capability
 * set, which is the safe direction: the recording keeps working and only the
 * administrative extras go quiet.
 */
function resolvePlan(planId: string | null): Plan | null {
  if (!planId) return null;
  try {
    return planById(planId as PlanId);
  } catch {
    return null;
  }
}

export async function companySubscription(companyId: string): Promise<Subscription> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      planId: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
    },
  });

  const plan = resolvePlan(company?.planId ?? null);
  const status = company?.subscriptionStatus ?? null;
  const trialEndsAt = company?.trialEndsAt ?? null;

  const inTrial =
    status === "TRIALING" && trialEndsAt !== null && trialEndsAt.getTime() > Date.now();
  const trialDaysLeft =
    trialEndsAt === null
      ? null
      : Math.max(
          0,
          Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        );

  return {
    plan,
    status,
    trialEndsAt,
    currentPeriodEnd: company?.currentPeriodEnd ?? null,
    inTrial,
    trialDaysLeft,
    retentionMonths: Math.max(plan?.retentionMonths ?? 0, EVIDENCE_FLOOR_MONTHS),
  };
}

/**
 * The one question the rest of the app asks about billing.
 *
 * Takes a company id rather than a resolved subscription so a caller cannot
 * hold a stale answer across a plan change, and returns a plain boolean so it
 * reads the same way at a route guard and in a template.
 *
 * A cancelled or past-due subscription still resolves against its plan. Losing
 * a capability the moment a payment fails would mean a webhook retry can
 * silently change what a supervisor is allowed to do mid-shift; the collection
 * problem is handled by telling an administrator, not by pulling the floor out
 * from under whoever is working tonight.
 */
export async function companyHasEntitlement(
  companyId: string,
  want: Entitlement,
): Promise<boolean> {
  const { plan } = await companySubscription(companyId);
  return hasEntitlement(plan?.id ?? null, want);
}

/**
 * The operator meter: sites that had at least one clocked-in shift this month.
 *
 * Derived from `Shift` rather than stored in a counter, because a counter and
 * the shifts it counts are two facts that can disagree, and the one a customer
 * will check is the shifts. A dark site bills nothing, which is what makes
 * seasonal work honest instead of something to hide by deleting the site.
 *
 * The window is calendar-month-to-date in UTC. Sites live in their own
 * timezones, so a shift that starts at 23:00 local on the last of the month
 * can land in the next UTC month; that moves a site's *first* billable night
 * by a few hours and never changes whether it was billable at all, since one
 * shift is the whole test.
 */
export async function activeSiteCount(
  companyId: string,
  now = new Date(),
): Promise<number> {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );

  const rows = await prisma.shift.findMany({
    where: {
      site: { companyId },
      clockInAt: { gte: monthStart, not: null },
    },
    select: { siteId: true },
    distinct: ["siteId"],
  });

  return rows.length;
}

export type BillingSummary = Subscription & {
  /** Sites with at least one clocked-in shift this calendar month. */
  activeSites: number;
  /** What the plan will actually bill for, after its minimum. */
  billableUnits: number;
  /** Monthly total in whole dollars, or null for a quote-only plan. */
  monthlyTotalUsd: number | null;
  /** Days a trial lasts, for the "start one" case. */
  trialDays: number;
};

export async function billingSummary(companyId: string): Promise<BillingSummary> {
  const subscription = await companySubscription(companyId);
  const activeSites = await activeSiteCount(companyId);
  const plan = subscription.plan;

  return {
    ...subscription,
    activeSites,
    billableUnits: plan ? Math.max(activeSites, plan.minUnits) : activeSites,
    monthlyTotalUsd: plan ? monthlyTotal(plan, activeSites) : null,
    trialDays: TRIAL_DAYS,
  };
}

/**
 * Put a company on a plan.
 *
 * Exists so the seed, the tests and any future checkout write the same row
 * through the same function. `planById` is called for its throw: an unknown
 * plan id fails here, at the write, rather than resolving to "no plan" every
 * time it is read afterwards.
 */
export async function setCompanyPlan(
  companyId: string,
  input: {
    planId: PlanId;
    status: SubscriptionStatus;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
  },
): Promise<void> {
  planById(input.planId);
  await prisma.company.update({
    where: { id: companyId },
    data: {
      planId: input.planId,
      subscriptionStatus: input.status,
      trialEndsAt: input.trialEndsAt ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
    },
  });
}
