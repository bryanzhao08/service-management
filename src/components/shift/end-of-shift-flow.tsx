"use client";

import { AlertTriangle, ArrowLeft, Check, FileText, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { DictateField } from "@/components/shift/dictate-field";
import { Badge } from "@/components/ui/badge";
import { PushPrompt } from "@/components/push-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { RecipientStatus, ReportStatus, Severity } from "@/generated/prisma/enums";
import {
  addOneOffRecipient,
  buildReport,
  clockOut,
  saveSummary,
  sendReport,
} from "@/app/shift/[id]/end/actions";
import { formatDuration } from "@/lib/utils";

/** Dictation into the summary has no verbatim column to land in, unlike an
 * entry, where the transcript *is* the record. Here the guard is editing a
 * generated draft, so "the raw transcript" would be a fragment of a paragraph
 * that is already part template and part typing. Storing that would imply a
 * provenance the text does not have. */
const DISCARD_RAW = () => {};

/**
 * Section 9.4. The flow that is supposed to save the guard 30-60 minutes.
 *
 * The whole design target is that a tired person at 6am can get through it
 * without reading anything twice, so: one decision per screen, the button that
 * moves them forward is always the biggest thing on it, and the reassurance
 * line ("you can leave once step 3 is done") is persistent rather than a toast
 * they might miss.
 */

type Step = 1 | 2 | 3 | 4;

/**
 * How long to keep asking the server whether a background job has landed.
 * A build is ~5s and a send is ~40s, so this is headroom, not a deadline: it
 * exists so a job that never finishes cannot leave a phone polling until the
 * battery dies.
 */
const POLL_CEILING_MS = 120_000;

type ReportRow = {
  id: string;
  version: number;
  status: ReportStatus;
  bytes: number | null;
  pages: number | null;
  sentAt: string | null;
  ready: boolean;
};

type RecipientRow = {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  required: boolean;
  status: RecipientStatus;
};

/**
 * Counts only. The provider's own error text stays server-side: a guard needs
 * to know the report did not go out and that retrying is the move, not that
 * an API returned `validation_error`.
 */
type DeliveryOutcomes = {
  total: number;
  failed: number;
  sent: number;
  /** Lowercased. Which addresses it did not reach tonight, so the badge can say so. */
  failedEmails: string[];
};

export function EndOfShiftFlow(props: {
  shiftId: string;
  siteName: string;
  timeZone: string;
  alreadyClockedOut: boolean;
  startedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  review: {
    counts: Record<string, number>;
    incidents: {
      id: string;
      code: string;
      text: string;
      severity: Severity | null;
      open: boolean;
    }[];
    unattachedPhotos: number;
    blindSpots: { checked: number; total: number };
    propertyChecks: { done: number; total: number };
  };
  summary: string;
  handoffNote: string;
  recipients: RecipientRow[];
  oneOffs: string[];
  /**
   * How this report's deliveries have actually gone, or null when no report
   * has been built yet.
   *
   * The report row alone cannot answer this. A report whose every delivery
   * failed is still `READY` with a null `sentAt`, which is byte-for-byte the
   * state of a report nobody has tried to send. Without this the screen shows
   * a guard the same thing either way, and the send half of the flow fails
   * silently.
   */
  delivery: DeliveryOutcomes | null;
  /** Null when the deployment has no VAPID keys; the prompt stays hidden. */
  vapidPublicKey: string | null;
  reports: ReportRow[];
  /**
   * What this site's logging mode permits at the end of a shift. When it is
   * `none` the middle two steps do not exist: there is no document to build
   * and no list to send it to, so offering them would be offering to do
   * something the site declined.
   */
  reportMode: "pdf" | "email" | "none";
}) {
  const router = useRouter();
  const latest = props.reports[0] ?? null;
  const sends = props.reportMode !== "none";

  const [step, setStep] = React.useState<Step>(() => {
    if (props.alreadyClockedOut) return 4;
    if (!sends) return 1;
    if (latest?.sentAt) return 4;
    if (latest?.ready) return 3;
    return 1;
  });
  const [summary, setSummary] = React.useState(props.summary);
  const [handoffNote, setHandoffNote] = React.useState(props.handoffNote);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sendArmed, setSendArmed] = React.useState(false);

  // The clock this flow is measured from is stamped server-side, in the page
  // render, before any of this mounts. It used to be stamped here in an
  // effect, which meant the headline metric only started once React hydrated
  // and a server action came back: a phone on bad signal would report a
  // shorter wrap-up than it actually took, and the error was one-directional,
  // always in the direction that flatters us.

  // Step 2 and 3 both wait on a background job. Poll while anything is in
  // flight and stop as soon as it settles, rather than leaving a timer running
  // all night on a phone in someone's pocket.
  //
  // `busy` cannot be the send's in-flight signal. `sendReport` returns the
  // moment the job is queued, long before any address is tried, so `busy` went
  // false within milliseconds and killed this poll on its first evaluation.
  // Nothing then refreshed, `sentAt` never arrived client-side, and the screen
  // sat on step 3 until someone reloaded it by hand -- which reads as a hang,
  // and invites the second tap. `sendArmed` survives that flip.
  const sendFailed = (props.delivery?.failed ?? 0) > 0;
  const waitingForBuild = step === 2 && !latest?.ready;
  const waitingForSend = step === 3 && sendArmed && latest?.sentAt === null;
  React.useEffect(() => {
    if (!waitingForBuild && !waitingForSend) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > POLL_CEILING_MS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 2_000);
    return () => clearInterval(timer);
  }, [waitingForBuild, waitingForSend, router]);

  // Hand the guard to step 4 once the send lands. Derived rather than stored:
  // the condition is exactly the one that already revealed the manual
  // "Continue to clock out" button, so this changes when step 3 turns over,
  // never whether. A send that failed leaves `sentAt` null and stays put, with
  // the retry banner.
  const current: Step = step === 3 && latest?.sentAt ? 4 : step;

  async function run(action: () => Promise<{ error: string | null }>, next?: Step) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (next) setStep(next);
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-28">
      <header className="flex items-center gap-3">
        <Link
          href={`/shift/${props.shiftId}`}
          className="text-text-muted hover:text-text"
          aria-label="Back to the timeline"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">End of shift</h1>
          <p className="text-sm text-text-muted">{props.siteName}</p>
        </div>
      </header>

      <StepRail current={current} sends={sends} />

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-danger px-3 py-2 text-sm text-on-danger"
        >
          {error}
        </p>
      ) : null}

      {current === 1 ? (
        <ReviewStep
          review={props.review}
          summary={summary}
          onSummary={setSummary}
          handoffNote={handoffNote}
          onHandoffNote={setHandoffNote}
          busy={busy}
          onNext={() =>
            run(
              () => saveSummary(props.shiftId, { summary, handoffNote }),
              sends ? 2 : 4,
            )
          }
        />
      ) : null}

      {current === 2 && sends ? (
        <GenerateStep
          report={latest}
          busy={busy}
          onBuild={() => run(() => buildReport(props.shiftId))}
          onNext={() => setStep(3)}
        />
      ) : null}

      {current === 3 && sends && latest ? (
        <SendStep
          shiftId={props.shiftId}
          report={latest}
          recipients={props.recipients}
          oneOffs={props.oneOffs}
          delivery={props.delivery}
          busy={busy || (waitingForSend && !sendFailed)}
          onSend={() => {
            setSendArmed(true);
            run(() => sendReport(props.shiftId, latest.id));
          }}
          onAddCc={(email) =>
            run(() => addOneOffRecipient(props.shiftId, latest.id, email))
          }
          onNext={() => setStep(4)}
        />
      ) : null}

      {current === 4 ? (
        <ClockOutStep
          shiftId={props.shiftId}
          done={props.alreadyClockedOut}
          busy={busy}
          vapidPublicKey={props.vapidPublicKey}
          shiftMs={spanMs(props.clockInAt, props.clockOutAt)}
          endFlowMs={spanMs(props.startedAt, props.clockOutAt)}
          onClockOut={() => run(() => clockOut(props.shiftId))}
        />
      ) : null}

      {current >= 3 && sends ? (
        latest?.sentAt || props.alreadyClockedOut ? (
          <p className="text-center text-sm text-text-muted">
            It&rsquo;s safe to clock out. We&rsquo;ll push a notification when
            it&rsquo;s delivered &mdash; or if anything bounces.
          </p>
        ) : (
          // Not "it's safe to clock out". Clock-out is step 4, and step 4 only
          // opens once a recipient has accepted the report, so saying that
          // here would promise a button that is not on the screen. That exact
          // pair -- the reassurance and no way to act on it -- is what a
          // guard hits when the provider rejects every address.
          <p className="text-center text-sm text-text-muted">
            You can clock out once the report has been accepted.
          </p>
        )
      ) : sends ? (
        <p className="text-center text-sm text-text-muted">
          You can leave once step 3 is done; we&rsquo;ll notify you.
        </p>
      ) : (
        <p className="text-center text-sm text-text-muted">
          This site is on verbal handover. Nothing is emailed &mdash; we record that the
          shift happened and that is all.
        </p>
      )}
    </main>
  );
}

function StepRail({ current, sends }: { current: Step; sends: boolean }) {
  // A site on verbal handover has two steps, not four greyed out. Showing
  // "Generate" and "Send" as skipped would tell the guard we chose not to do
  // something we could have done, when the truth is the customer asked us not
  // to hold it at all.
  const labels = sends
    ? ["Review", "Generate", "Send", "Clock out"]
    : ["Review", "Clock out"];
  const steps: Step[] = sends ? [1, 2, 3, 4] : [1, 4];
  return (
    <ol className="flex gap-1" aria-label="End of shift progress">
      {labels.map((label, index) => {
        const n = steps[index]!;
        const state = n < current ? "done" : n === current ? "active" : "todo";
        return (
          <li key={label} className="flex-1">
            <div
              className={
                state === "todo"
                  ? "h-1 rounded-full bg-border"
                  : "h-1 rounded-full bg-primary"
              }
            />
            <p
              className={
                state === "active"
                  ? "mt-1 text-xs font-medium text-text"
                  : "mt-1 text-xs text-text-muted"
              }
            >
              {/* The number is here as well as the bar so the position is not
                  carried by colour alone. */}
              {n}. {label}
              {state === "done" ? <span className="sr-only"> (done)</span> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

const COUNT_LABEL: Record<string, string> = {
  NOTE: "Notes",
  INCIDENT: "Incidents",
  PACKAGE: "Packages",
  PATROL: "Patrols",
  PROPERTY_CHECK: "Property checks",
  BLIND_SPOT: "Blind spots",
  HANDOFF: "Handoff",
  BREAK: "Breaks",
  CLOCK_IN: "Clock in",
  CLOCK_OUT: "Clock out",
};

function ReviewStep({
  review,
  summary,
  onSummary,
  handoffNote,
  onHandoffNote,
  busy,
  onNext,
}: {
  review: EndOfShiftFlowReview;
  summary: string;
  onSummary: (value: string) => void;
  handoffNote: string;
  onHandoffNote: (value: string) => void;
  busy: boolean;
  onNext: () => void;
}) {
  const entries = Object.entries(review.counts).filter(([, n]) => n > 0);
  const openIncidents = review.incidents.filter((i) => i.open);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Tonight</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {entries.map(([type, n]) => (
              <div key={type} className="flex justify-between gap-2">
                <dt className="text-text-muted">{COUNT_LABEL[type] ?? type}</dt>
                <dd className="font-medium tabular-nums">{n}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <dt className="text-text-muted">Blind spots</dt>
              <dd className="font-medium tabular-nums">
                {review.blindSpots.checked}/{review.blindSpots.total}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-text-muted">Property checks</dt>
              <dd className="font-medium tabular-nums">
                {review.propertyChecks.done}/{review.propertyChecks.total}
              </dd>
            </div>
          </dl>

          {openIncidents.length > 0 ? (
            <p className="flex items-start gap-2 rounded-md bg-attention px-3 py-2 text-sm text-on-attention">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {openIncidents.length === 1
                  ? "1 incident is still marked ongoing"
                  : `${openIncidents.length} incidents are still marked ongoing`}
                . They&rsquo;ll go out as open unless you resolve them first.
              </span>
            </p>
          ) : null}

          {review.unattachedPhotos > 0 ? (
            <p className="text-sm text-text-muted">
              {review.unattachedPhotos} photo
              {review.unattachedPhotos === 1 ? "" : "s"} not linked to an incident.
              They&rsquo;ll stay in the general gallery.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {review.incidents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Incidents</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {review.incidents.map((incident) => (
              <div key={incident.id} className="flex items-start gap-2 text-sm">
                <Badge tone="outline" className="shrink-0 font-mono text-[11px]">
                  {incident.code}
                </Badge>
                <span className="min-w-0 flex-1">{incident.text || "(no text)"}</span>
                {incident.open ? <Badge tone="attention">Open</Badge> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Shift summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <DictateField
            label="Summary"
            value={summary}
            onValueChange={onSummary}
            onRawChange={DISCARD_RAW}
            rows={4}
            hint="Pre-filled from tonight's entries. Edit anything that isn't right."
          />
          <DictateField
            label="Handoff note for the next guard"
            value={handoffNote}
            onValueChange={onHandoffNote}
            onRawChange={DISCARD_RAW}
            rows={3}
            hint="Optional. Anything the next shift should know walking in."
          />
        </CardContent>
      </Card>

      <Button size="lg" onClick={onNext} busy={busy} className="w-full">
        Continue to report
      </Button>
    </div>
  );
}

type EndOfShiftFlowReview = {
  counts: Record<string, number>;
  incidents: {
    id: string;
    code: string;
    text: string;
    severity: Severity | null;
    open: boolean;
  }[];
  unattachedPhotos: number;
  blindSpots: { checked: number; total: number };
  propertyChecks: { done: number; total: number };
};

function GenerateStep({
  report,
  busy,
  onBuild,
  onNext,
}: {
  report: ReportRow | null;
  busy: boolean;
  onBuild: () => void;
  onNext: () => void;
}) {
  if (report?.ready) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-primary" aria-hidden="true" />
            Report v{report.version} is ready
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-text-muted">Pages</dt>
              <dd className="font-medium tabular-nums">{report.pages ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Size</dt>
              <dd className="font-medium tabular-nums">{formatBytes(report.bytes)}</dd>
            </div>
          </dl>
          <Button variant="secondary" asChild>
            <a
              href={`/api/reports/${report.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText className="size-4" aria-hidden="true" />
              Open PDF
            </a>
          </Button>
          <Button size="lg" onClick={onNext} className="w-full">
            Continue to send
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Build the report</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {busy || report ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Processing photos, laying out the PDF, checking the size&hellip;
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            This pulls tonight&rsquo;s entries and photos into one PDF. It takes a few
            seconds.
          </p>
        )}
        <Button size="lg" onClick={onBuild} busy={busy} className="w-full">
          Build report
        </Button>
      </CardContent>
    </Card>
  );
}

const RECIPIENT_TONE: Record<RecipientStatus, "primary" | "neutral" | "danger"> = {
  VERIFIED: "primary",
  UNVERIFIED: "neutral",
  BOUNCED: "danger",
};

const RECIPIENT_LABEL: Record<RecipientStatus, string> = {
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
  BOUNCED: "Bounced before",
};

function SendStep({
  report,
  recipients,
  oneOffs,
  delivery,
  busy,
  onSend,
  onAddCc,
  onNext,
}: {
  shiftId: string;
  report: ReportRow;
  recipients: RecipientRow[];
  oneOffs: string[];
  delivery: DeliveryOutcomes | null;
  busy: boolean;
  onSend: () => void;
  onAddCc: (email: string) => void;
  onNext: () => void;
}) {
  const [cc, setCc] = React.useState("");
  const sent = report.sentAt !== null;
  // Tonight's outcome, keyed by address. Empty until a send has actually run,
  // so before the first attempt every badge still shows standing.
  const didNotArrive = React.useMemo(
    () => new Set(delivery?.failedEmails ?? []),
    [delivery],
  );
  const missed = (email: string) => didNotArrive.has(email.toLowerCase());

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Who gets it</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recipients.map((recipient) => (
            <div key={recipient.id} className="flex items-center gap-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{recipient.name}</p>
                <p className="truncate text-xs text-text-muted">
                  {recipient.roleLabel} &middot; {recipient.email}
                </p>
              </div>
              {recipient.required ? (
                <Badge tone="outline" className="shrink-0">
                  Required
                </Badge>
              ) : null}
              <Badge
                tone={
                  missed(recipient.email) ? "danger" : RECIPIENT_TONE[recipient.status]
                }
                className="shrink-0"
              >
                {missed(recipient.email)
                  ? "Didn't send"
                  : RECIPIENT_LABEL[recipient.status]}
              </Badge>
            </div>
          ))}

          {oneOffs.map((email) => (
            <div key={email} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{email}</span>
              <Badge tone={missed(email) ? "danger" : "outline"} className="shrink-0">
                {missed(email) ? "Didn't send" : "CC, tonight only"}
              </Badge>
            </div>
          ))}

          {!sent ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!cc.trim()) return;
                onAddCc(cc);
                setCc("");
              }}
            >
              <Input
                type="email"
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                placeholder="CC someone, tonight only"
                aria-label="One-off CC address"
                className="flex-1"
              />
              <Button type="submit" variant="secondary" disabled={!cc.trim()}>
                Add
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* `sendReport` only enqueues: it returns ok the moment the job is
          queued, long before any address is tried, so a total failure lands
          after the button has already gone idle. Nothing else on this screen
          moves when that happens -- the recipient badges show standing, not
          tonight's outcome -- so without this the guard is left on a step that
          will never advance, with no hint why. */}
      {!sent && delivery && delivery.failed > 0 ? (
        <p
          role="alert"
          className="rounded-md bg-danger px-3 py-2 text-sm text-on-danger"
        >
          We could not send this to {delivery.failed} of {delivery.total}{" "}
          {delivery.total === 1 ? "recipient" : "recipients"}. Try again &mdash; if it
          keeps failing, tell your supervisor before you leave.
        </p>
      ) : null}

      {sent ? (
        /* Reached only if the auto-advance has not run yet -- the flow moves
           itself to step 4 the moment `sentAt` lands. Kept as the manual way
           through so a guard is never stranded if that effect does not fire. */
        <Button size="lg" onClick={onNext} className="w-full">
          Continue to clock out
        </Button>
      ) : (
        <Button size="lg" onClick={onSend} busy={busy} className="w-full">
          <Send className="size-4" aria-hidden="true" />
          {delivery && delivery.failed > 0 ? "Try sending again" : "Send report"}
        </Button>
      )}
    </div>
  );
}

function ClockOutStep({
  shiftId,
  done,
  busy,
  shiftMs,
  endFlowMs,
  vapidPublicKey,
  onClockOut,
}: {
  shiftId: string;
  done: boolean;
  busy: boolean;
  shiftMs: number | null;
  endFlowMs: number | null;
  vapidPublicKey: string | null;
  onClockOut: () => void;
}) {
  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-primary" aria-hidden="true" />
            You&rsquo;re clocked out
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-text-muted">Shift</dt>
              <dd className="font-medium tabular-nums">
                {shiftMs === null
                  ? "—"
                  : formatDuration(shiftMs, { hideSeconds: true })}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">End of shift</dt>
              <dd className="font-medium tabular-nums">
                {endFlowMs === null ? "—" : formatDuration(endFlowMs)}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-text-muted">
            The report keeps going without you. Delivery status is on the receipt.
          </p>
          <Button variant="secondary" asChild>
            <Link href={`/shift/${shiftId}/report`}>Open the receipt</Link>
          </Button>
          <Button asChild size="lg" className="w-full">
            <Link href="/dashboard">Done</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock out</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          This closes the shift and writes the last entry on the timeline.
        </p>
        {/* Section 13's one-time ask. It used to sit on step 3 behind the
            manual "Continue" button; now that the flow advances itself once
            the report lands, this is the last interactive moment a guard has,
            and the one where "tell me it arrived" is the obvious yes. */}
        <PushPrompt publicKey={vapidPublicKey} />
        <Button size="lg" onClick={onClockOut} busy={busy} className="w-full">
          Clock out
        </Button>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Null rather than "measure to now" when either end is missing.
 *
 * An unfinished flow has no duration yet, and rendering a number that grows
 * while the screen sits open would make an abandoned tab look like a very slow
 * guard.
 */
function spanMs(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return new Date(to).getTime() - new Date(from).getTime();
}
