import Link from "next/link";
import { Check, Minus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Audience,
  ENTITLEMENT_LABELS,
  type Entitlement,
  type Plan,
  RECOMMENDED,
  TRIAL_DAYS,
  plansFor,
} from "@/lib/billing/plans";

/**
 * The pricing block, rendered identically on the landing page and on
 * `/pricing`.
 *
 * It lives here rather than in either page because the two used to disagree:
 * the landing page quoted "from $N" in hand-written copy while `/pricing`
 * rendered the real cards, so a price change had to be made twice and the
 * cheaper of the two numbers was whichever page you happened to land on.
 * Everything below reads `PLANS`, so the marketing surface cannot quote a
 * price the app does not charge.
 *
 * Server-rendered, no client JavaScript. A monthly/annual toggle is the
 * obvious next thing to add and is deliberately absent: we bill one way, and
 * a toggle with one setting is a control that lies about having a choice.
 */

export const PLAN_LINES: {
  audience: Audience;
  id: string;
  heading: string;
  who: string;
  lead: string;
  meter: string;
}[] = [
  {
    audience: "operator",
    id: "for-guard-companies",
    heading: "For guard companies",
    who: "You employ the officers and you are being judged at renewal.",
    lead: "Charging per guard would mean charging you more every time you cover a shift, which is a good way to end up with one login shared across a crew. A shared login wrecks attribution, and attribution is what your client is actually buying. So we bill the site.",
    meter:
      "A site counts for a month if at least one shift was clocked in on it. Seasonal work and event sites cost nothing in the months they sit dark.",
  },
  {
    audience: "client",
    id: "for-the-people-who-hire-them",
    heading: "For the organisations that hire them",
    who: "School districts, hospitals, hotels, campuses, property managers.",
    lead: "You are not running the guards. You are trying to find out whether three different vendors are actually doing what their contracts say, without chasing PDFs through an inbox. You set the standard, every vendor reports into it, and the delivery record is yours rather than theirs.",
    meter:
      "Priced per property you cover. Never per vendor — adding your fourth guard company is the behaviour we want, so it is free, permanently.",
  },
];

export function PlanCard({ plan }: { plan: Plan }) {
  const quoteOnly = plan.pricePerUnitMonth === null;
  const recommended = RECOMMENDED[plan.audience] === plan.id;
  return (
    <Card
      data-plan={plan.id}
      className={`flex h-full flex-col ${
        recommended ? "border-primary ring-1 ring-primary/25" : ""
      }`}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{plan.name}</CardTitle>
          {recommended ? (
            <span className="rounded-[var(--radius-control)] bg-primary px-2 py-0.5 text-xs font-medium text-on-primary">
              Start here
            </span>
          ) : null}
        </div>
        <p className="flex items-baseline gap-1">
          {quoteOnly ? (
            <span className="text-2xl font-semibold">Let&rsquo;s talk</span>
          ) : (
            <>
              <span className="text-3xl font-semibold tabular-nums">
                ${plan.pricePerUnitMonth}
              </span>
              <span className="text-sm text-text-muted">/ {plan.unit} / month</span>
            </>
          )}
        </p>
        <p className="text-sm text-text-muted">
          {plan.minUnits === 1
            ? `From one ${plan.unit}`
            : `${plan.minUnits} ${plan.unit} minimum`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-text-muted">{plan.fit}</p>
        <div className="pt-1">
          <Button
            asChild
            variant={recommended ? "primary" : "secondary"}
            className="w-full"
          >
            <Link
              href={quoteOnly ? "/#contact" : `/sign-up?plan=${plan.id}`}
            >
              {quoteOnly ? "Talk to us" : `Start ${TRIAL_DAYS} days free`}
            </Link>
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {plan.includes.map((line) => (
            <li key={line} className="flex gap-2 text-sm">
              <Check
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="text-text-muted">{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Every capability either line's plans actually differ on, in plan order.
 *
 * Derived from the plans rather than hand-listed, so a capability added to a
 * plan shows up in the table without anyone remembering to add a row, and a
 * capability every plan in the line shares is left out instead of rendering a
 * row of identical ticks that tells a buyer nothing.
 */
function comparisonRows(plans: readonly Plan[]): Entitlement[] {
  const seen: Entitlement[] = [];
  for (const plan of plans) {
    for (const entitlement of plan.entitlements) {
      if (!seen.includes(entitlement)) seen.push(entitlement);
    }
  }
  return seen.filter((e) => !plans.every((p) => p.entitlements.includes(e)));
}

export function PlanComparison({ audience }: { audience: Audience }) {
  const plans = plansFor(audience);
  const rows = comparisonRows(plans);
  const unit = plans[0].unit;
  const caption = `Plan comparison for ${
    audience === "operator" ? "guard companies" : "the organisations that hire them"
  }`;
  return (
    // The comparison table is wider than a phone, so this scrolls sideways.
    // A bare overflow div is unreachable without a mouse: the region needs to
    // be focusable and named, or a keyboard user simply cannot see the columns
    // that are off-screen.
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-2/5 py-3 pr-4 text-left font-medium">
              <span className="text-text-muted">Per {unit}</span>
            </th>
            {plans.map((plan) => (
              <th
                key={plan.id}
                scope="col"
                className="px-3 py-3 text-center font-medium"
              >
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <th scope="row" className="py-3 pr-4 text-left font-normal text-text-muted">
              Monthly price
            </th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-3 py-3 text-center tabular-nums">
                {plan.pricePerUnitMonth === null
                  ? "Quote"
                  : `$${plan.pricePerUnitMonth}`}
              </td>
            ))}
          </tr>
          <tr className="border-b border-border">
            <th scope="row" className="py-3 pr-4 text-left font-normal text-text-muted">
              Report history
            </th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-3 py-3 text-center tabular-nums">
                {plan.retentionMonths >= 24
                  ? `${plan.retentionMonths / 12} years`
                  : `${plan.retentionMonths} months`}
              </td>
            ))}
          </tr>
          <tr className="border-b border-border">
            <th scope="row" className="py-3 pr-4 text-left font-normal text-text-muted">
              Guards on a site
            </th>
            {plans.map((plan) => (
              <td key={plan.id} className="px-3 py-3 text-center">
                Unlimited
              </td>
            ))}
          </tr>
          {rows.map((entitlement) => (
            <tr key={entitlement} className="border-b border-border">
              <th
                scope="row"
                className="py-3 pr-4 text-left font-normal text-text-muted"
              >
                {ENTITLEMENT_LABELS[entitlement]}
              </th>
              {plans.map((plan) => {
                const has = plan.entitlements.includes(entitlement);
                return (
                  <td key={plan.id} className="px-3 py-3 text-center">
                    {has ? (
                      <Check
                        className="mx-auto size-4 text-primary"
                        aria-label="Included"
                      />
                    ) : (
                      <Minus
                        className="mx-auto size-4 text-text-muted"
                        aria-label="Not included"
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One audience's whole pitch: why this meter, the cards, then the table. */
export function PlanLine({
  line,
  headingLevel = "h2",
}: {
  line: (typeof PLAN_LINES)[number];
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  const plans = plansFor(line.audience);
  return (
    <section
      id={line.id}
      aria-labelledby={`${line.id}-heading`}
      className="flex scroll-mt-6 flex-col gap-6"
    >
      <div className="flex flex-col gap-3">
        <Heading
          id={`${line.id}-heading`}
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {line.heading}
        </Heading>
        <p className="font-medium">{line.who}</p>
        <p className="max-w-3xl text-pretty text-text-muted">{line.lead}</p>
        <p className="max-w-3xl text-sm text-pretty text-text-muted">{line.meter}</p>
      </div>
      <ul
        className={
          plans.length >= 4
            ? "grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            : "grid gap-4 md:grid-cols-3"
        }
      >
        {plans.map((plan) => (
          <li key={plan.id}>
            <PlanCard plan={plan} />
          </li>
        ))}
      </ul>
      <PlanComparison audience={line.audience} />
    </section>
  );
}
