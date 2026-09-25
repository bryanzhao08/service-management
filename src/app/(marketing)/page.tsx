import type { Metadata } from "next";
import Link from "next/link";
import {
  BellRing,
  Camera,
  ClipboardList,
  Clock,
  FileText,
  Lock,
  Mail,
  MapPin,
  Mic,
  Receipt,
  ScrollText,
  Send,
  Building2,
} from "lucide-react";

import { DashboardMock } from "@/components/marketing/dashboard-mock";
import { SiteConfigMock } from "@/components/marketing/site-config-mock";
import { TimelineMock } from "@/components/marketing/timeline-mock";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Transient — log the shift, leave on time",
  description:
    "Transient turns a night of timestamps, photos, and incidents into one clean report and one deliverable email — in minutes, with proof it arrived.",
  alternates: { canonical: "/" },
};

/**
 * Statically generated on purpose. Nothing here reads a cookie, a header, or
 * the database, so Next can render it once at build time and serve HTML — which
 * is most of how the Lighthouse floor in section 7 gets met. The only client
 * JavaScript on the page is the contact form.
 */
export const dynamic = "force-static";

// --- 2. The 4 AM problem ------------------------------------------------------
// Quoted as findings, not as our own measurements, and left anonymous.
const PROBLEMS = [
  {
    stat: "35–40 min",
    body: "to assemble and email a routine shift report. Up to an hour on event nights.",
  },
  {
    stat: "30–40 photos",
    body: "means multiple emails and 10+ extra minutes, because attachments blow the size cap.",
  },
  {
    stat: "Weeks",
    body: "of reports bounced silently to a deactivated address — and the guard got blamed.",
  },
] as const;

// --- 3. How it works ----------------------------------------------------------
const STEPS = [
  {
    icon: Clock,
    title: "Clock in and walk the blind spots",
    body: "The checklist is per site, so a new guard walks it the same way the last one did.",
  },
  {
    icon: Camera,
    title: "Tap, snap, or say it as it happens",
    body: "Every entry is timestamped where it happened, not reconstructed at 6am.",
  },
  {
    icon: FileText,
    title: "One tap builds the PDF",
    body: "Photos compressed and laid out, entries in order, incidents pulled to the front.",
  },
  {
    icon: Send,
    title: "One email, tracked to delivery",
    body: "Everyone who should get it, in one send, with the delivery state recorded.",
  },
] as const;

// --- 4. Feature grid ----------------------------------------------------------
const FEATURES = [
  {
    icon: Clock,
    title: "One-tap timestamps",
    body: "Patrols, checks and handoffs logged in a second, with a thumb, in the dark.",
  },
  {
    icon: Camera,
    title: "Photo capture with compression",
    body: "Compressed on the phone before upload, so 40 photos still send on bad signal.",
  },
  {
    icon: Mic,
    title: "Voice-to-note dictation",
    body: "Say it while walking. It lands as text on the timeline at the right minute.",
  },
  {
    icon: ClipboardList,
    title: "Site-specific templates",
    body: "A hotel and a school do not file the same report, and should not use the same form.",
  },
  {
    icon: BellRing,
    title: "Delivery tracking and bounce alerts",
    body: "A bad recipient address raises an alert that night, not at the next contract review.",
  },
  {
    icon: Receipt,
    title: "Proof-of-submission receipts",
    body: "The guard keeps a receipt showing what was sent, when, and to whom.",
  },
] as const;

// --- 7. Security & privacy ----------------------------------------------------
const SECURITY = [
  { icon: Lock, label: "Encrypted storage" },
  { icon: Mail, label: "Signed, expiring links" },
  { icon: ScrollText, label: "Immutable audit log" },
  { icon: Building2, label: "Per-company data isolation" },
] as const;

function Section({
  id,
  title,
  lead,
  children,
  className,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`border-t border-border px-6 py-16 sm:py-20 ${className ?? ""}`}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="flex max-w-2xl flex-col gap-3">
          <h2
            id={`${id}-heading`}
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            {title}
          </h2>
          {lead ? <p className="text-text-muted">{lead}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      {/* First focusable element on the page. Without it a keyboard user tabs
          through the whole nav and hero to reach the contact form. */}
      <a
        href="#contact"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to contact
      </a>

      <header className="px-6 py-5">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
          <Logo />
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>

      <main>
        {/* --- 1. Hero ---------------------------------------------------- */}
        <section className="px-6 pt-8 pb-16 sm:pt-12 sm:pb-24">
          <div className="mx-auto grid w-full max-w-5xl items-center gap-12 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                Log the shift. Leave on time.
              </h1>
              <p className="max-w-xl text-lg text-pretty text-text-muted">
                Transient turns a night of timestamps, photos, and incidents into one
                clean report and one deliverable email — in minutes, with proof it
                arrived.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/sign-in">Start free</Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/sample-report" target="_blank" rel="noopener">
                    See a sample report
                  </Link>
                </Button>
              </div>
            </div>

            <div className="lg:justify-self-end">
              <TimelineMock />
            </div>
          </div>
        </section>

        {/* --- 2. The 4 AM problem ---------------------------------------- */}
        <Section
          id="problem"
          title="The 4 AM problem"
          lead="What guards and operations managers reported before they had anything better. Numbers are theirs, not ours."
        >
          <ul className="grid gap-4 md:grid-cols-3">
            {PROBLEMS.map((problem) => (
              <li key={problem.stat}>
                <Card className="h-full">
                  <CardContent className="flex flex-col gap-2 py-6">
                    <p className="text-2xl font-semibold text-primary tabular-nums">
                      {problem.stat}
                    </p>
                    <p className="text-sm text-text-muted">{problem.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </Section>

        {/* --- 3. How it works -------------------------------------------- */}
        <Section id="how" title="How it works">
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span className="flex size-10 items-center justify-center rounded-[var(--radius-control)] bg-primary text-on-primary">
                  <step.icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-medium">
                  <span className="text-text-muted tabular-nums">{index + 1}. </span>
                  {step.title}
                </h3>
                <p className="text-sm text-text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* --- 4. Feature grid -------------------------------------------- */}
        <Section id="features" title="What it does">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <Card className="h-full">
                  <CardHeader className="gap-3">
                    <feature.icon className="size-5 text-primary" aria-hidden="true" />
                    <CardTitle className="text-base">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-text-muted">{feature.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </Section>

        {/* --- 5. Sites differ -------------------------------------------- */}
        <Section
          id="sites"
          title="Built for how sites actually differ"
          lead="A hotel emails four people every morning. A school two miles away files nothing and hands off verbally at 6am. Same company, same guard rotation, different rules — so the rules live on the site, not in the app."
        >
          <SiteConfigMock />
        </Section>

        {/* --- 6. Operations ---------------------------------------------- */}
        <Section
          id="operations"
          title="For operations teams"
          lead="One screen that answers the only question worth asking at 7am: did every site report, and did it land?"
        >
          <DashboardMock />
        </Section>

        {/* --- 7. Security strip ------------------------------------------ */}
        <Section id="security" title="Security & privacy">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map((item) => (
              <li
                key={item.label}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-4"
              >
                <item.icon
                  className="size-5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="text-sm font-medium">{item.label}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* --- 8. Pricing + contact --------------------------------------- */}
        <Section
          id="contact"
          title="Simple per-site pricing"
          lead="You pay per site, monthly, with no per-guard charge — adding someone to a rotation should not cost anything. Tell us how many sites you run and we will send real numbers."
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <ul className="flex flex-col gap-3 text-sm text-text-muted">
              <li className="flex gap-2">
                <MapPin
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                Per site, per month. Unlimited guards on that site.
              </li>
              <li className="flex gap-2">
                <Mail
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                Unlimited report recipients. They never need an account.
              </li>
              <li className="flex gap-2">
                <ScrollText
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                Your reports and photos stay yours. Export any time.
              </li>
            </ul>
            <ContactForm />
          </div>
        </Section>
      </main>

      {/* --- 9. Footer ---------------------------------------------------- */}
      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href="/privacy" className="text-text-muted hover:text-text">
              Privacy
            </Link>
            <Link href="/terms" className="text-text-muted hover:text-text">
              Terms
            </Link>
            <Link href="/sign-in" className="text-text-muted hover:text-text">
              Sign in
            </Link>
          </nav>
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            Status: all systems normal
          </p>
        </div>
      </footer>
    </>
  );
}
