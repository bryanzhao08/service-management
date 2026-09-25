import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/brand";
import { StatusChip, type ReportStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sample report — Transient",
  description: "What a Transient shift report looks like when it lands in an inbox.",
  alternates: { canonical: "/sample-report" },
};

export const dynamic = "force-static";

/**
 * A rendered sample of the report an operations manager receives.
 *
 * DEVIATION, recorded in ASSUMPTIONS.md: the real artefact is a PDF, built in
 * milestone 6. Until that exists this page shows the same content as HTML
 * rather than linking to a file that is not there — a landing page CTA that
 * 404s is worse than one that shows a faithful preview. When the generator
 * ships, this route serves the actual PDF and the fixture below becomes its
 * input.
 *
 * Every field here is one the schema can produce. The site timezone is stated
 * explicitly and all times are formatted in it, because a report read in New
 * York about a shift walked in Los Angeles is a real way to misread an incident.
 */

const SITE_TZ = "America/Los_Angeles";

const SAMPLE = {
  site: "Westside Hotel",
  address: "1100 Ocean Ave, Santa Monica, CA",
  guard: "D. Okafor",
  shiftStart: "2026-09-18T22:00:00-07:00",
  shiftEnd: "2026-09-19T06:04:00-07:00",
  entries: [
    {
      at: "2026-09-18T22:03:00-07:00",
      kind: "Patrol",
      body: "Perimeter walk, north lot through loading dock. All secure.",
    },
    {
      at: "2026-09-18T23:31:00-07:00",
      kind: "Check",
      body: "Blind-spot checklist: stairwell B, roof access, pool gate, garage P2, service corridor. All 5 clear.",
    },
    {
      at: "2026-09-19T01:12:00-07:00",
      kind: "Incident",
      body: "Garage P2, vehicle alarm sounding on a silver sedan. No visible damage or entry. Owner located in room 412 and notified at 01:24. Alarm silenced.",
      photos: 3,
    },
    {
      at: "2026-09-19T02:40:00-07:00",
      kind: "Patrol",
      body: "Second perimeter walk. Pool gate latched, roof access locked.",
    },
    {
      at: "2026-09-19T04:15:00-07:00",
      kind: "Note",
      body: "Loading dock light out, east fixture. Maintenance ticket left at front desk.",
    },
    {
      at: "2026-09-19T05:58:00-07:00",
      kind: "Handoff",
      body: "Handed off to M. Reyes. Briefed on P2 alarm and the dock light.",
    },
  ],
  recipients: [
    { email: "gm@westsidehotel.example", state: "DELIVERED" },
    { email: "agm@westsidehotel.example", state: "DELIVERED" },
    { email: "security@westsidehotel.example", state: "OPENED" },
    { email: "owner@westsidehotel.example", state: "DELIVERED" },
  ],
} as const satisfies {
  recipients: readonly { email: string; state: ReportStatus }[];
} & Record<string, unknown>;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SITE_TZ,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: SITE_TZ,
  });
}

export default function SampleReportPage() {
  const incidents = SAMPLE.entries.filter((entry) => entry.kind === "Incident");

  return (
    <>
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          {/* No aria-label here. The Wordmark inside already exposes "Transient"
              as its accessible name, and an aria-label of "Transient home"
              does not contain the visible glyphs (the wordmark renders a
              dotless U+0131), which trips axe's label-content-name-mismatch
              and, more importantly, breaks speech-input activation. */}
          <Link href="/">
            <Logo />
          </Link>
          <Button asChild variant="ghost">
            <Link href="/">Back to site</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm text-text-muted">
          A sample of the report sent to a site&rsquo;s recipients each morning. Names
          and addresses are fictional.
        </p>

        <article className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="flex flex-col gap-1 border-b border-border px-6 py-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              Shift report — {SAMPLE.site}
            </h1>
            <p className="text-sm text-text-muted">{SAMPLE.address}</p>
            <p className="mt-3 text-sm">
              {fmtDate(SAMPLE.shiftStart)} · {fmtTime(SAMPLE.shiftStart)} to{" "}
              {fmtTime(SAMPLE.shiftEnd)} · Guard {SAMPLE.guard}
            </p>
            <p className="text-sm text-text-muted">
              All times {SITE_TZ.replace("_", " ")}, the site&rsquo;s own timezone.
            </p>
          </div>

          <section
            aria-labelledby="summary"
            className="border-b border-border px-6 py-6"
          >
            <h2 id="summary" className="text-lg font-medium">
              Summary
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Entries", String(SAMPLE.entries.length)],
                ["Incidents", String(incidents.length)],
                ["Photos", "3"],
                ["Checklist", "5 of 5"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-text-muted">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Incidents lead, because that is what the reader opened the email
              for. The full timeline still follows in order below. */}
          <section
            aria-labelledby="incidents"
            className="border-b border-border px-6 py-6"
          >
            <h2 id="incidents" className="text-lg font-medium">
              Incidents
            </h2>
            <ul className="mt-4 flex flex-col gap-4">
              {incidents.map((entry) => (
                <li
                  key={entry.at}
                  className="rounded-[var(--radius-control)] border border-border px-4 py-4"
                >
                  <p className="text-sm font-medium tabular-nums">
                    {fmtTime(entry.at)}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">{entry.body}</p>
                  {"photos" in entry ? (
                    <p className="mt-2 text-sm text-text-muted">
                      {entry.photos} photos attached in the PDF.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="timeline"
            className="border-b border-border px-6 py-6"
          >
            <h2 id="timeline" className="text-lg font-medium">
              Full timeline
            </h2>
            <ol className="mt-4 flex flex-col gap-4">
              {SAMPLE.entries.map((entry) => (
                <li key={entry.at} className="flex gap-4">
                  <span className="w-16 shrink-0 pt-0.5 text-sm text-text-muted tabular-nums">
                    {fmtTime(entry.at)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium">{entry.kind}</span>
                    <span className="text-sm text-text-muted">{entry.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="delivery" className="px-6 py-6">
            <h2 id="delivery" className="text-lg font-medium">
              Delivery
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Recorded per recipient, so a bounce is visible the same morning rather
              than at the next contract review.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {SAMPLE.recipients.map((recipient) => (
                <li
                  key={recipient.email}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
                >
                  <span className="text-sm">{recipient.email}</span>
                  <StatusChip status={recipient.state} />
                </li>
              ))}
            </ul>
          </section>
        </article>

        <div className="mt-10">
          <Button asChild size="lg">
            <Link href="/#contact">Get pricing for your sites</Link>
          </Button>
        </div>
      </main>
    </>
  );
}
