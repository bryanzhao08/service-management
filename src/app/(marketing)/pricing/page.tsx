import type { Metadata } from "next";
import Link from "next/link";
import { Minus } from "lucide-react";

import { Logo } from "@/components/brand";
import { PLAN_LINES, PlanLine } from "@/components/marketing/pricing-plans";
import { SiteFooter } from "@/components/marketing/site-footer";
import { Button } from "@/components/ui/button";
import { ALWAYS_INCLUDED } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Pricing — Transient",
  description:
    "Two products. Guard companies pay per active site. The organisations that hire them pay per covered property, and never pay to add a vendor.",
  alternates: { canonical: "/pricing" },
};

export const dynamic = "force-static";

/**
 * Both product lines on one static page, stacked rather than behind a toggle.
 *
 * A toggle would need client JavaScript and would hide half the page from
 * search and from anyone who lands here from a vendor invitation, which is a
 * real entry path: an operator invited into a client's workspace arrives
 * wanting to know what *their* side costs. Every number comes from `PLANS`, so
 * this page cannot drift from what the app actually enforces.
 */

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-surface text-text">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <Link href="/" aria-label="Transient home">
          <Logo />
        </Link>
        <Button asChild variant="secondary">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-24">
        <section className="flex flex-col gap-4 pt-6 pb-10">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Two sides of the same night
          </h1>
          <p className="max-w-2xl text-lg text-pretty text-text-muted">
            The company that guards a building and the organisation that hired them need
            different things from the same shift. So there are two products here, not
            one product with a discount.
          </p>
          <nav aria-label="Jump to a plan line" className="flex flex-wrap gap-3">
            {PLAN_LINES.map((line) => (
              <Button key={line.id} asChild variant="secondary">
                <Link href={`#${line.id}`}>{line.heading}</Link>
              </Button>
            ))}
          </nav>
        </section>

        {PLAN_LINES.map((line) => (
          <div
            key={line.id}
            className="border-t border-border pt-12 pb-16 first:border-t-0"
          >
            <PlanLine line={line} />
          </div>
        ))}

        <section
          aria-labelledby="overlap-heading"
          className="flex flex-col gap-3 border-t border-border pt-12"
        >
          <h2 id="overlap-heading" className="text-2xl font-semibold tracking-tight">
            If both of us pay, are you billing twice for one building?
          </h2>
          <p className="max-w-3xl text-pretty text-text-muted">
            Yes, and here is the honest reasoning rather than a dodge. The guard company
            is paying to run the work. You are paying for oversight across vendors you
            do not employ, which is a different job and mostly a different set of
            screens. Your vendor&rsquo;s workspace stays theirs, your record stays
            yours, and neither of us can quietly edit the other&rsquo;s copy.
          </p>
          <p className="max-w-3xl text-pretty text-text-muted">
            If you employ your own officers, you are not a client in this sense. You are
            running the work, so the guard-company line is the one you want, and you
            should ignore the second half of this page.
          </p>
        </section>

        <section
          aria-labelledby="never-heading"
          className="mt-16 flex flex-col gap-6 border-t border-border pt-12"
        >
          <div className="flex flex-col gap-3">
            <h2 id="never-heading" className="text-2xl font-semibold tracking-tight">
              What we will never put behind a plan
            </h2>
            <p className="max-w-3xl text-pretty text-text-muted">
              If a card expires on the night a building floods, the flood still gets
              logged, the photos still upload, the report still generates and it still
              sends. We will chase the bill in the app, loudly. We will not make billing
              status part of a legal record.
            </p>
            <p className="max-w-3xl text-pretty text-text-muted">
              Plainly:{" "}
              <em>
                the pricing system must never be the reason the record is incomplete.
              </em>
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {ALWAYS_INCLUDED.map((line) => (
              <li key={line} className="flex gap-2 text-sm">
                <Minus
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16 flex flex-col gap-5 border-t border-border pt-12">
          <h2 className="text-2xl font-semibold tracking-tight">
            Three things people ask first
          </h2>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h3 className="font-medium">
                Do our vendors have to pay before they can report to us?
              </h3>
              <p className="max-w-3xl text-sm text-pretty text-text-muted">
                No. A vendor you invite can log shifts and file reports into your
                workspace without buying anything. They pay us when they want Transient
                across their own book of business, which is their call and not a toll
                gate on yours.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="font-medium">Do report recipients need an account?</h3>
              <p className="max-w-3xl text-sm text-pretty text-text-muted">
                Never, on any plan, on either side. A report arrives as email with a
                PDF. The portal is for people who want to go looking through history
                themselves rather than dig through an inbox.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="font-medium">What happens to our data if we leave?</h3>
              <p className="max-w-3xl text-sm text-pretty text-text-muted">
                You export it, including after you cancel. Reports are PDFs with a
                content hash printed on them, so they stay verifiable somewhere else
                without us. Holding a company&rsquo;s own evidence hostage is a business
                model we are not interested in.
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter width="page" omit={["/pricing"]} />
    </div>
  );
}
