import * as React from "react";
import { Camera, Footprints, Mic, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Timeline, type TimelineEntry } from "@/components/ui/timeline";
import { cn } from "@/lib/utils";

/**
 * The hero's phone mock.
 *
 * Built from the real `Timeline` and `Badge` rather than a screenshot, so it
 * cannot drift away from the shipped component the way an image would, and so
 * it stays sharp and text-selectable at any density with no image bytes.
 *
 * Every component used here is a server component, so this renders to static
 * HTML with zero client JavaScript. Section 7 budgets client JS for the phone
 * mock; spending none is strictly better for the Lighthouse floor.
 */

/**
 * Fixed instants, rendered in a fixed zone. A mock built from `new Date()`
 * would be re-evaluated at build time and show a different wall clock on every
 * deploy, and "02:14 on a night shift" is the whole point of the picture.
 */
const DEMO_TZ = "America/Los_Angeles";

const ENTRIES: readonly TimelineEntry[] = [
  {
    id: "1",
    at: "2026-09-24T05:02:00.000Z",
    title: "Shift started",
    detail: "Westside Hotel — Sunset Strip",
    tone: "primary",
  },
  {
    id: "2",
    at: "2026-09-24T06:41:00.000Z",
    title: "Patrol — loading dock",
    detail: "Roll-up door secure. Blind spot 3 of 5.",
    icon: Footprints,
  },
  {
    id: "3",
    at: "2026-09-24T08:17:00.000Z",
    title: "Photo — garage level 2",
    detail: "Broken glass by stairwell B, taped off.",
    icon: Camera,
    tone: "attention",
  },
  {
    id: "4",
    at: "2026-09-24T09:14:00.000Z",
    title: "Incident — trespass",
    detail: "Asked to leave the pool deck. Complied, no contact made.",
    icon: ShieldAlert,
    tone: "danger",
  },
  {
    id: "5",
    at: "2026-09-24T10:33:00.000Z",
    title: "Voice note",
    detail: "“Elevator 2 still making the grinding noise on 4.”",
    icon: Mic,
  },
];

/**
 * A phone bezel. The notch is `aria-hidden` because it is decoration; a screen
 * reader announcing it would sit between the heading and the content.
 */
export function PhoneFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[19rem] rounded-[2.5rem] border border-border bg-surface p-3 shadow-2xl shadow-black/40",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute top-3 left-1/2 z-10 h-6 w-28 -translate-x-1/2 rounded-b-2xl bg-bg"
      />
      <div className="overflow-hidden rounded-[2rem] bg-bg">{children}</div>
    </div>
  );
}

export function TimelineMock() {
  return (
    <PhoneFrame>
      <div className="flex flex-col gap-4 px-4 pt-10 pb-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-text-muted">Westside Hotel</p>
            <p className="text-lg font-semibold tabular-nums">5h 31m</p>
          </div>
          <Badge tone="primary">On shift</Badge>
        </div>

        <Timeline entries={ENTRIES} timeZone={DEMO_TZ} />

        <p className="rounded-[var(--radius-card)] border border-dashed border-border px-3 py-2 text-center text-xs text-text-muted">
          Tap · Snap · Say it
        </p>
      </div>
    </PhoneFrame>
  );
}
