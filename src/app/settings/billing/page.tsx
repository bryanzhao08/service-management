import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { ALWAYS_INCLUDED, ENTITLEMENT_LABELS } from "@/lib/billing/plans";
import { billingSummary } from "@/lib/db/billing";

import type { SubscriptionStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Plan and billing" };

const STATUS_COPY: Record<SubscriptionStatus, { label: string; tone: BadgeTone }> = {
  TRIALING: { label: "Trial", tone: "neutral" },
  ACTIVE: { label: "Active", tone: "primary" },
  PAST_DUE: { label: "Payment failed", tone: "attention" },
  CANCELED: { label: "Cancelled", tone: "outline" },
};

function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

/**
 * Plan and billing.
 *
 * Owner-only, because this is the one screen where the honest answer involves
 * money. A supervisor told their company's payment failed can do nothing with
 * that and would not want to carry it into a shift.
 *
 * The page leads with what is *not* at risk. Every plan question a customer
 * has at 2am is really "did I just lose the log", and the answer is always
 * no — so `ALWAYS_INCLUDED` is stated on the page rather than only living in
 * a constant nobody outside the repo can read. The active-site meter sits
 * beside the price for the same reason: an operator should be able to check
 * the number they are billed on against shifts they can see, without asking.
 */
export default async function BillingPage() {
  const actor = await requireUnlockedActor();
  if (actor.role !== "OWNER") notFound();

  const summary = await billingSummary(actor.companyId);
  const status = summary.status ? STATUS_COPY[summary.status] : null;

  return (
    <>
      <AppChrome />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pb-16" data-billing-page>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Plan and billing</h1>
          <p className="text-sm text-text-muted">
            What you are on, what it covers, and what it costs.
          </p>
        </header>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <CardTitle data-plan-name={summary.plan?.id ?? ""}>
              {summary.plan ? summary.plan.name : "No plan"}
            </CardTitle>
            {status ? (
              <Badge tone={status.tone} data-plan-status={summary.status}>
                {status.label}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {summary.plan ? (
              <p className="text-text-muted">{summary.plan.fit}</p>
            ) : (
              <p className="text-text-muted">
                You are recording, generating and delivering on the free tier. Nothing
                about the record itself is limited. A plan adds the administrative
                extras around it.
              </p>
            )}

            {summary.inTrial && summary.trialDaysLeft !== null ? (
              <p data-trial-days={summary.trialDaysLeft}>
                <strong>{summary.trialDaysLeft}</strong>{" "}
                {summary.trialDaysLeft === 1 ? "day" : "days"} left in your{" "}
                {summary.trialDays}-day trial.
              </p>
            ) : null}

            {summary.status === "PAST_DUE" ? (
              <p className="text-danger">
                We could not take the last payment. Everything keeps working, including
                this month&apos;s reports. We will not switch off a record you might
                need. Update the card when you get a chance.
              </p>
            ) : null}

            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div>
                <dt className="text-xs tracking-wide text-text-muted uppercase">
                  Active sites this month
                </dt>
                <dd
                  className="text-lg font-semibold"
                  data-active-sites={summary.activeSites}
                >
                  {summary.activeSites}
                </dd>
              </div>
              <div>
                <dt className="text-xs tracking-wide text-text-muted uppercase">
                  Billable units
                </dt>
                <dd
                  className="text-lg font-semibold"
                  data-billable-units={summary.billableUnits}
                >
                  {summary.billableUnits}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs tracking-wide text-text-muted uppercase">
                  Monthly total
                </dt>
                <dd
                  className="text-lg font-semibold"
                  data-monthly-total={summary.monthlyTotalUsd ?? ""}
                >
                  {summary.monthlyTotalUsd === null
                    ? "—"
                    : `${usd(summary.monthlyTotalUsd)} / month`}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-text-muted">
              A site counts for the month once a guard clocks in there. It is counted
              from your shifts, not from a separate tally, so the number above is one
              you can check yourself.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Always included</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-text-muted">
              These never depend on a plan, a trial, or a payment going through. The
              pricing is not allowed to be the reason a record is incomplete.
            </p>
            <ul className="space-y-1" data-always-included={ALWAYS_INCLUDED.length}>
              {ALWAYS_INCLUDED.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {summary.plan && summary.plan.entitlements.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Included in {summary.plan.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul
                className="space-y-1 text-sm"
                data-plan-entitlements={summary.plan.entitlements.length}
              >
                {summary.plan.entitlements.map((entitlement) => (
                  <li key={entitlement} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span>{ENTITLEMENT_LABELS[entitlement]}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/pricing">See all plans</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/settings">Back to settings</Link>
          </Button>
        </div>

        <p className="text-xs text-text-muted">
          Plan changes go through your account manager while billing is in early access.
          Nothing on this screen charges a card.
        </p>
      </main>
    </>
  );
}
