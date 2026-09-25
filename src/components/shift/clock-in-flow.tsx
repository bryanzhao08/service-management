"use client";

import { Check, ChevronLeft, Coffee } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import {
  acknowledgeHandoff,
  logBreakCover,
  startShift,
  submitBlindSpotCheck,
  submitPropertyCheck,
} from "@/lib/actions/shift";
import { formatClock, formatElapsed } from "@/lib/time";

type Area = { id: string; name: string };
type BlindSpot = { id: string; name: string; description: string | null };

export interface ClockInFlowProps {
  shift: {
    id: string;
    clockInAt: string | null;
    isEventNight: boolean;
    scheduledStart: string | null;
    scheduledEnd: string | null;
  };
  site: {
    id: string;
    name: string;
    timezone: string;
    areas: readonly Area[];
    blindSpots: readonly BlindSpot[];
  };
  handoff: {
    shiftId: string;
    guardName: string;
    openIncidents: readonly {
      id: string;
      code: string;
      category: string;
      severity: string | null;
      text: string | null;
    }[];
    note: string | null;
  } | null;
  /** Checks already recorded, so a resumed flow doesn't ask twice. */
  done: { property: readonly string[]; blindSpot: readonly string[] };
}

type StepId = "confirm" | "handoff" | "property" | "blindspots" | "done";

/**
 * Section 9.2. One screen at a time, thumb-reachable, no scrolling to find the
 * primary action.
 *
 * Every step commits to the server as it is completed rather than batching at
 * the end. A guard who loses signal on step 4 has still recorded steps 1-3,
 * and — more to the point — a guard who is interrupted by an actual incident
 * mid-clock-in has a real `clockInAt` on the record rather than nothing.
 */
export function ClockInFlow({ shift, site, handoff, done }: ClockInFlowProps) {
  const router = useRouter();

  const steps = React.useMemo<StepId[]>(() => {
    const list: StepId[] = ["confirm"];
    if (handoff) list.push("handoff");
    if (site.areas.length > 0) list.push("property");
    if (site.blindSpots.length > 0) list.push("blindspots");
    list.push("done");
    return list;
  }, [handoff, site.areas.length, site.blindSpots.length]);

  // A resumed flow starts where it left off. Sending the guard back to
  // "Clock in" when they are already clocked in is how a flow trains people
  // to tap past it without reading.
  const [index, setIndex] = React.useState(() =>
    shift.clockInAt ? Math.min(1, steps.length - 1) : 0,
  );
  const step = steps[index];

  const [startedAt] = React.useState(() => new Date());
  const [clockInAt, setClockInAt] = React.useState<Date | null>(
    shift.clockInAt ? new Date(shift.clockInAt) : null,
  );
  const [eventNight, setEventNight] = React.useState(shift.isEventNight);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [propertyDone, setPropertyDone] = React.useState<Set<string>>(
    () => new Set(done.property),
  );
  const [blindSpotDone, setBlindSpotDone] = React.useState<Set<string>>(
    () => new Set(done.blindSpot),
  );

  const advance = () => setIndex((i) => Math.min(i + 1, steps.length - 1));

  async function run<T>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      return result.data;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-sunken flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3">
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              className="-ml-2 flex size-tap items-center justify-center rounded-[var(--radius-control)] text-text-muted"
              aria-label="Previous step"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
          ) : (
            <span className="size-tap" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text">{site.name}</p>
            <p
              className="text-xs text-text-muted"
              aria-live="polite"
              aria-atomic="true"
            >
              Step {index + 1} of {steps.length}
            </p>
          </div>
        </div>
        {/* Progress as a real meter, not a decorative bar: a screen reader
            user gets the same "how much is left" that the bar gives. */}
        <div
          role="progressbar"
          aria-label="Clock-in progress"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          className="mx-auto mt-3 flex w-full max-w-lg gap-1"
        >
          {steps.map((s, i) => (
            <span
              key={s}
              className={
                i <= index
                  ? "h-1 flex-1 rounded-full bg-primary"
                  : "h-1 flex-1 rounded-full bg-border"
              }
            />
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius-control)] border border-danger bg-surface px-4 py-3 text-sm text-text"
          >
            {error}
          </p>
        ) : null}

        {step === "confirm" ? (
          <section className="space-y-6" aria-labelledby="step-confirm">
            <div className="space-y-1">
              <h1 id="step-confirm" className="text-2xl font-semibold text-text">
                Start your shift
              </h1>
              <p className="text-text-muted">
                {shift.scheduledStart
                  ? `Scheduled ${formatClock(new Date(shift.scheduledStart), site.timezone)}`
                  : "Unscheduled"}
                {shift.scheduledEnd
                  ? ` – ${formatClock(new Date(shift.scheduledEnd), site.timezone)}`
                  : ""}
              </p>
            </div>

            <Card>
              <CardContent className="pt-4">
                <Toggle
                  label="Busy or event night?"
                  description="Shows on the report and tells your supervisor to expect more entries."
                  checked={eventNight}
                  onCheckedChange={setEventNight}
                />
              </CardContent>
            </Card>

            <Button
              size="xl"
              className="w-full"
              busy={busy}
              onClick={async () => {
                const data = await run(() =>
                  startShift({
                    shiftId: shift.id,
                    isEventNight: eventNight,
                    clientId: crypto.randomUUID(),
                  }),
                );
                if (data) {
                  setClockInAt(new Date(data.clockInAt));
                  advance();
                }
              }}
            >
              {clockInAt ? "Continue" : "Clock in"}
            </Button>
          </section>
        ) : null}

        {step === "handoff" && handoff ? (
          <HandoffStep
            handoff={handoff}
            shiftId={shift.id}
            timezone={site.timezone}
            busy={busy}
            onAcknowledge={async (note) => {
              const ok = await run(() =>
                acknowledgeHandoff({
                  shiftId: shift.id,
                  fromShiftId: handoff.shiftId,
                  clientId: crypto.randomUUID(),
                  note: note || undefined,
                }),
              );
              if (ok) advance();
            }}
            onBreakCover={async (phase) => {
              await run(() =>
                logBreakCover({
                  shiftId: shift.id,
                  clientId: crypto.randomUUID(),
                  phase,
                }),
              );
            }}
          />
        ) : null}

        {step === "property" ? (
          <PropertyStep
            areas={site.areas}
            doneIds={propertyDone}
            busy={busy}
            onSubmit={async (areaId, result, note) => {
              const data = await run(() =>
                submitPropertyCheck({
                  shiftId: shift.id,
                  areaId,
                  result,
                  note: note || undefined,
                }),
              );
              if (data) {
                setPropertyDone((prev) => new Set(prev).add(areaId));
              }
            }}
            onNext={advance}
          />
        ) : null}

        {step === "blindspots" ? (
          <BlindSpotStep
            spots={site.blindSpots}
            doneIds={blindSpotDone}
            busy={busy}
            onSubmit={async (blindSpotId, method, reason) => {
              const data = await run(() =>
                submitBlindSpotCheck({
                  shiftId: shift.id,
                  blindSpotId,
                  method,
                  reason: reason || undefined,
                }),
              );
              if (data) {
                setBlindSpotDone((prev) => new Set(prev).add(blindSpotId));
              }
            }}
            onNext={advance}
          />
        ) : null}

        {step === "done" ? (
          <section className="space-y-6" aria-labelledby="step-done">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary">
              <Check aria-hidden="true" className="size-7 text-on-primary" />
            </div>
            <div className="space-y-1">
              <h1 id="step-done" className="text-2xl font-semibold text-text">
                You&rsquo;re on shift
              </h1>
              <p className="text-text-muted">
                Clock-in checks complete in {formatElapsed(startedAt, new Date())}.
              </p>
            </div>

            <Card>
              <CardContent className="space-y-2 pt-4 text-sm">
                <Row
                  label="Clocked in"
                  value={clockInAt ? formatClock(clockInAt, site.timezone) : "—"}
                />
                {site.areas.length > 0 ? (
                  <Row
                    label="Property check"
                    value={`${propertyDone.size} of ${site.areas.length}`}
                  />
                ) : null}
                {site.blindSpots.length > 0 ? (
                  <Row
                    label="Blind spots"
                    value={`${blindSpotDone.size} of ${site.blindSpots.length}`}
                  />
                ) : null}
                {eventNight ? <Row label="Event night" value="Yes" /> : null}
              </CardContent>
            </Card>

            <Button
              size="xl"
              className="w-full"
              onClick={() => router.push(`/shift/${shift.id}`)}
            >
              Go to timeline
            </Button>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text tabular-nums">{value}</span>
    </div>
  );
}

function HandoffStep({
  handoff,
  timezone,
  busy,
  onAcknowledge,
  onBreakCover,
}: {
  handoff: NonNullable<ClockInFlowProps["handoff"]>;
  shiftId: string;
  timezone: string;
  busy: boolean;
  onAcknowledge: (note: string) => void;
  onBreakCover: (phase: "START" | "END") => void;
}) {
  const [note, setNote] = React.useState("");
  const [coverStart, setCoverStart] = React.useState<Date | null>(null);

  return (
    <section className="space-y-6" aria-labelledby="step-handoff">
      <div className="space-y-1">
        <h1 id="step-handoff" className="text-2xl font-semibold text-text">
          Handoff
        </h1>
        <p className="text-text-muted">{handoff.guardName} is still on shift here.</p>
      </div>

      {handoff.openIncidents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Open incidents ({handoff.openIncidents.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {handoff.openIncidents.map((incident) => (
                <li key={incident.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-text-muted">
                      {incident.code}
                    </span>
                    {incident.severity ? (
                      <Badge tone={incident.severity === "HIGH" ? "danger" : "neutral"}>
                        {incident.severity.toLowerCase()}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-text">{incident.text ?? incident.category}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {handoff.note ? (
        <Card>
          <CardHeader>
            <CardTitle>Their handoff note</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-text">{handoff.note}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Section 9.2: break cover is a real thing guards do and currently
          record nowhere. It sits on the handoff step because that is the
          moment two guards are on site at once. */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Coffee aria-hidden="true" className="size-4" />
            <span>Covering their break?</span>
          </div>
          {coverStart ? (
            <>
              <p className="text-sm text-text" aria-live="polite">
                Cover started {formatClock(coverStart, timezone)}.
              </p>
              <Button
                variant="secondary"
                className="w-full"
                busy={busy}
                onClick={() => {
                  onBreakCover("END");
                  setCoverStart(null);
                }}
              >
                End break cover
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              busy={busy}
              onClick={() => {
                onBreakCover("START");
                setCoverStart(new Date());
              }}
            >
              Start break cover
            </Button>
          )}
        </CardContent>
      </Card>

      <Field label="Anything to add?" hint="Optional">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
        />
      </Field>

      <Button
        size="xl"
        className="w-full"
        busy={busy}
        onClick={() => onAcknowledge(note)}
      >
        Acknowledge handoff
      </Button>
    </section>
  );
}

const PROPERTY_RESULTS = [
  { value: "CLEAR", label: "Clear" },
  { value: "DAMAGE", label: "Damage" },
  { value: "SKIPPED", label: "Skipped" },
] as const;

function PropertyStep({
  areas,
  doneIds,
  busy,
  onSubmit,
  onNext,
}: {
  areas: readonly Area[];
  doneIds: ReadonlySet<string>;
  busy: boolean;
  onSubmit: (
    areaId: string,
    result: "CLEAR" | "DAMAGE" | "SKIPPED",
    note: string,
  ) => void;
  onNext: () => void;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"DAMAGE" | "SKIPPED">("DAMAGE");
  const [note, setNote] = React.useState("");

  return (
    <section className="space-y-6" aria-labelledby="step-property">
      <div className="space-y-1">
        <h1 id="step-property" className="text-2xl font-semibold text-text">
          Property check
        </h1>
        <p className="text-text-muted" aria-live="polite">
          {doneIds.size} of {areas.length} checked
        </p>
      </div>

      <ul className="space-y-2">
        {areas.map((area) => {
          const checked = doneIds.has(area.id);
          const expanded = open === area.id;
          return (
            <li key={area.id}>
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-text">
                      {area.name}
                    </span>
                    {checked ? (
                      <Badge tone="primary">
                        <Check aria-hidden="true" className="size-3" />
                        Done
                      </Badge>
                    ) : null}
                  </div>

                  {checked ? null : (
                    <div className="grid grid-cols-3 gap-2">
                      {PROPERTY_RESULTS.map((option) => (
                        <Button
                          key={option.value}
                          variant={option.value === "CLEAR" ? "primary" : "secondary"}
                          disabled={busy}
                          onClick={() => {
                            if (option.value === "CLEAR") {
                              onSubmit(area.id, "CLEAR", "");
                              return;
                            }
                            setPending(option.value);
                            setNote("");
                            setOpen(area.id);
                          }}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {/* A non-clear result has to carry a reason, so the field
                      appears in place rather than in a modal the guard has to
                      dismiss. The server enforces it too; this is only the
                      part that tells them before they tap. */}
                  {expanded && !checked ? (
                    <div className="space-y-3">
                      <Field
                        label={
                          pending === "DAMAGE"
                            ? "What did you find?"
                            : "Why was it skipped?"
                        }
                        required
                      >
                        <Textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={3}
                          autoFocus
                        />
                      </Field>
                      <Button
                        className="w-full"
                        busy={busy}
                        disabled={note.trim().length === 0}
                        onClick={() => {
                          onSubmit(area.id, pending, note);
                          setOpen(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Button size="xl" variant="secondary" className="w-full" onClick={onNext}>
        {doneIds.size === areas.length ? "Continue" : "Continue without the rest"}
      </Button>
    </section>
  );
}

const BLIND_SPOT_METHODS = [
  { value: "PHOTO", label: "Photo" },
  { value: "CAMERA_ROOM", label: "Camera room" },
  { value: "NOT_CHECKED", label: "Not checked" },
] as const;

function BlindSpotStep({
  spots,
  doneIds,
  busy,
  onSubmit,
  onNext,
}: {
  spots: readonly BlindSpot[];
  doneIds: ReadonlySet<string>;
  busy: boolean;
  onSubmit: (
    blindSpotId: string,
    method: "PHOTO" | "CAMERA_ROOM" | "NOT_CHECKED",
    reason: string,
  ) => void;
  onNext: () => void;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");

  return (
    <section className="space-y-6" aria-labelledby="step-blindspots">
      <div className="space-y-1">
        <h1 id="step-blindspots" className="text-2xl font-semibold text-text">
          Blind spots
        </h1>
        <p className="text-text-muted" aria-live="polite">
          {doneIds.size} of {spots.length} blind spots checked
        </p>
      </div>

      <ul className="space-y-2">
        {spots.map((spot) => {
          const checked = doneIds.has(spot.id);
          const expanded = open === spot.id;
          return (
            <li key={spot.id}>
              <Card>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium text-text">{spot.name}</span>
                      {spot.description ? (
                        <span className="block text-sm text-text-muted">
                          {spot.description}
                        </span>
                      ) : null}
                    </span>
                    {checked ? (
                      <Badge tone="primary">
                        <Check aria-hidden="true" className="size-3" />
                        Done
                      </Badge>
                    ) : null}
                  </div>

                  {checked ? null : (
                    <div className="grid grid-cols-3 gap-2">
                      {BLIND_SPOT_METHODS.map((option) => (
                        <Button
                          key={option.value}
                          variant={
                            option.value === "NOT_CHECKED" ? "secondary" : "primary"
                          }
                          disabled={busy}
                          onClick={() => {
                            if (option.value === "NOT_CHECKED") {
                              setReason("");
                              setOpen(spot.id);
                              return;
                            }
                            onSubmit(spot.id, option.value, "");
                          }}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {expanded && !checked ? (
                    <div className="space-y-3">
                      <Field label="Why not?" required>
                        <Textarea
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          rows={2}
                          autoFocus
                        />
                      </Field>
                      <Button
                        className="w-full"
                        busy={busy}
                        disabled={reason.trim().length === 0}
                        onClick={() => {
                          onSubmit(spot.id, "NOT_CHECKED", reason);
                          setOpen(null);
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Button size="xl" variant="secondary" className="w-full" onClick={onNext}>
        {doneIds.size === spots.length ? "Continue" : "Continue without the rest"}
      </Button>
    </section>
  );
}
