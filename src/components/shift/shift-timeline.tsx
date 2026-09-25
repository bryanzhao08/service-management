"use client";

import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  LogIn,
  LogOut,
  MoreHorizontal,
  Package,
  Plus,
  Users,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { NoteSheet } from "@/components/shift/note-sheet";
import { PhotoSheet } from "@/components/shift/photo-sheet";
import { IncidentSheet } from "@/components/shift/incident-sheet";
import { MoreSheet } from "@/components/shift/more-sheet";
import { PackageSheet } from "@/components/shift/package-sheet";
import { Badge } from "@/components/ui/badge";
import { ElapsedTimer } from "@/components/ui/timer";
import type { EntryType } from "@/generated/prisma/enums";
import { formatClock, hourBucket } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface TimelineEntryData {
  id: string;
  clientId: string;
  type: EntryType;
  occurredAt: string;
  text: string | null;
  deletedAt: string | null;
  areaName: string | null;
  revisionCount: number;
  mediaCount: number;
  incident: {
    id: string;
    code: string;
    categoryKey: string;
    severity: string | null;
    status: string;
    ongoingSince: string | null;
  } | null;
  packageInfo: {
    id: string;
    carrier: string | null;
    trackingNumber: string | null;
    recipientName: string | null;
    deliveredAt: string | null;
  } | null;
}

export interface SiteConfig {
  id: string;
  name: string;
  code: string;
  timezone: string;
  areas: readonly { id: string; name: string }[];
  entryTypes: readonly {
    id: string;
    label: string;
    key: string;
    color: string;
  }[];
}

const ICONS: Partial<Record<EntryType, React.ElementType>> = {
  CLOCK_IN: LogIn,
  CLOCK_OUT: LogOut,
  NOTE: FileText,
  MEDIA: Camera,
  INCIDENT: AlertTriangle,
  PACKAGE: Package,
  PATROL: Check,
  PROPERTY_CHECK: Check,
  BLIND_SPOT_CHECK: Camera,
  HANDOFF_RECEIVED: Users,
  HANDOFF_GIVEN: Users,
  VISITOR: Users,
};

const LABELS: Partial<Record<EntryType, string>> = {
  CLOCK_IN: "Clocked in",
  CLOCK_OUT: "Clocked out",
  NOTE: "Note",
  MEDIA: "Photo",
  INCIDENT: "Incident",
  PACKAGE: "Package",
  PATROL: "Patrol",
  PROPERTY_CHECK: "Property check",
  BLIND_SPOT_CHECK: "Blind spot",
  BREAK_COVER_START: "Break cover started",
  BREAK_COVER_END: "Break cover ended",
  HANDOFF_RECEIVED: "Handoff received",
  HANDOFF_GIVEN: "Handoff given",
  VISITOR: "Visitor",
  CUSTOM: "Entry",
};

type SheetId = "note" | "photo" | "incident" | "package" | "more" | null;

/**
 * Section 9.3. Sticky header, reverse-chronological timeline grouped by hour,
 * fixed bottom action bar.
 *
 * The four bottom buttons are the whole interaction model: everything a guard
 * does at 3am is one thumb tap from here, and nothing they do requires
 * scrolling to reach a control. "More" holds the long tail precisely so the
 * four that matter stay large.
 */
export function ShiftTimeline({
  shift,
  site,
  initialEntries,
  canWrite,
}: {
  shift: {
    id: string;
    clockInAt: string | null;
    clockOutAt: string | null;
    isEventNight: boolean;
    guardName: string;
  };
  site: SiteConfig;
  initialEntries: readonly TimelineEntryData[];
  canWrite: boolean;
}) {
  const [entries, setEntries] = React.useState<TimelineEntryData[]>([
    ...initialEntries,
  ]);
  const [sheet, setSheet] = React.useState<SheetId>(null);
  const [pending, setPending] = React.useState(0);

  // Opening a sheet bumps that sheet's counter, which is its React `key`, so
  // it mounts fresh every time instead of resetting its own fields in an
  // effect. Two things fall out of that: the "timestamp when the sheet opened"
  // rule in section 9.3 becomes a plain `useState(() => new Date())` at mount,
  // and a half-typed draft cannot survive into the next thing the guard logs.
  // Per-sheet rather than one shared counter so "More > Package" leaves the
  // More sheet's identity alone and it still animates out.
  const [opens, setOpens] = React.useState<Record<string, number>>({});
  const openSheet = React.useCallback((id: Exclude<SheetId, null>) => {
    setOpens((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    setSheet(id);
  }, []);

  const addEntry = React.useCallback((entry: TimelineEntryData) => {
    setEntries((prev) =>
      [entry, ...prev.filter((e) => e.clientId !== entry.clientId)].sort((a, b) =>
        b.occurredAt.localeCompare(a.occurredAt),
      ),
    );
  }, []);

  const ongoing = entries.filter(
    (entry) => entry.incident && entry.incident.status === "ONGOING",
  );

  // Grouped by the hour the entry happened in the *site's* zone, so a shift in
  // Los Angeles read from New York still groups by the hours the guard worked.
  const groups = React.useMemo(() => {
    const map = new Map<string, TimelineEntryData[]>();
    for (const entry of entries) {
      const key = hourBucket(new Date(entry.occurredAt), site.timezone);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    return [...map.entries()];
  }, [entries, site.timezone]);

  return (
    <div className="bg-surface-sunken flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-text">{site.name}</p>
            <p className="text-sm text-text-muted">
              {shift.clockInAt ? (
                <>
                  <ElapsedTimer
                    since={shift.clockInAt}
                    until={shift.clockOutAt}
                    className="font-mono"
                  />
                  {" on shift"}
                </>
              ) : (
                "Not clocked in"
              )}
            </p>
          </div>
          <SyncDot pending={pending} />
        </div>

        {ongoing.length > 0 ? (
          <div className="bg-surface-sunken border-t border-border px-4 py-2">
            <ul className="mx-auto w-full max-w-lg space-y-1">
              {ongoing.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 text-sm text-text"
                >
                  <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" />
                  <span className="font-mono text-text-muted">
                    {entry.incident!.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {entry.text ?? entry.incident!.categoryKey}
                  </span>
                  <ElapsedTimer
                    since={entry.incident!.ongoingSince ?? entry.occurredAt}
                    className="shrink-0 font-mono text-text-muted"
                    label="Incident running time"
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4 pb-32">
        <h1 className="sr-only">Shift timeline for {site.name}</h1>
        {entries.length === 0 ? (
          <p className="py-16 text-center text-text-muted">
            Nothing logged yet. Use the buttons below.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map(([hour, rows]) => (
              <section key={hour} aria-labelledby={`hour-${hour}`}>
                <h2
                  id={`hour-${hour}`}
                  className="bg-surface-sunken sticky top-[68px] z-10 -mx-4 px-4 py-1 font-mono text-sm text-text-muted"
                >
                  {hour}
                </h2>
                <ol className="mt-2 space-y-2">
                  {rows.map((entry) => (
                    <TimelineRow
                      key={entry.id}
                      entry={entry}
                      timezone={site.timezone}
                      shiftId={shift.id}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </main>

      {canWrite ? (
        <>
          <nav
            aria-label="Log an entry"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
          >
            <div className="mx-auto grid w-full max-w-lg grid-cols-4 gap-2 p-3">
              <ActionButton
                icon={FileText}
                label="Note"
                onClick={() => openSheet("note")}
              />
              <ActionButton
                icon={Camera}
                label="Photo"
                onClick={() => openSheet("photo")}
              />
              <ActionButton
                icon={AlertTriangle}
                label="Incident"
                tone="danger"
                onClick={() => openSheet("incident")}
              />
              <ActionButton
                icon={MoreHorizontal}
                label="More"
                onClick={() => openSheet("more")}
              />
            </div>
          </nav>

          <NoteSheet
            key={`note-${opens.note ?? 0}`}
            open={sheet === "note"}
            onOpenChange={(next: boolean) => setSheet(next ? "note" : null)}
            shiftId={shift.id}
            areas={site.areas}
            timezone={site.timezone}
            onSaved={addEntry}
            onPendingChange={setPending}
          />
          <PhotoSheet
            key={`photo-${opens.photo ?? 0}`}
            open={sheet === "photo"}
            onOpenChange={(next: boolean) => setSheet(next ? "photo" : null)}
            shiftId={shift.id}
            areas={site.areas}
            timezone={site.timezone}
            onSaved={addEntry}
            onPendingChange={setPending}
          />
          <IncidentSheet
            key={`incident-${opens.incident ?? 0}`}
            open={sheet === "incident"}
            onOpenChange={(next: boolean) => setSheet(next ? "incident" : null)}
            shiftId={shift.id}
            site={site}
            onSaved={addEntry}
          />
          <PackageSheet
            key={`package-${opens.package ?? 0}`}
            open={sheet === "package"}
            onOpenChange={(next: boolean) => setSheet(next ? "package" : null)}
            shiftId={shift.id}
            onSaved={addEntry}
          />
          <MoreSheet
            key={`more-${opens.more ?? 0}`}
            open={sheet === "more"}
            onOpenChange={(next: boolean) => setSheet(next ? "more" : null)}
            shiftId={shift.id}
            site={site}
            onPackage={() => openSheet("package")}
            onSaved={addEntry}
          />
        </>
      ) : (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-4 py-3 pb-[env(safe-area-inset-bottom)]">
          <p className="mx-auto w-full max-w-lg text-center text-sm text-text-muted">
            {shift.clockOutAt
              ? "This shift has ended."
              : `${shift.guardName}'s shift — read only.`}
          </p>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border text-xs font-medium",
        "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
        tone === "danger"
          ? "border-transparent bg-danger text-on-danger"
          : "bg-surface-sunken border-border text-text",
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
      {label}
    </button>
  );
}

/**
 * The sync indicator from section 9.3. It is a dot *and* a word, because a
 * colour-only status is invisible to a colour-blind guard and to anyone
 * glancing at a phone in sunlight.
 */
function SyncDot({ pending }: { pending: number }) {
  const synced = pending === 0;
  return (
    <p
      className="flex shrink-0 items-center gap-2 text-sm text-text-muted"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn("size-2.5 rounded-full", synced ? "bg-primary" : "bg-attention")}
      />
      {synced ? "Synced" : `${pending} waiting`}
    </p>
  );
}

function TimelineRow({
  entry,
  timezone,
  shiftId,
}: {
  entry: TimelineEntryData;
  timezone: string;
  shiftId: string;
}) {
  const Icon = ICONS[entry.type] ?? Plus;
  const deleted = entry.deletedAt !== null;
  const incident = entry.incident;

  return (
    <li>
      <Link
        href={`/shift/${shiftId}/entry/${entry.id}`}
        className={cn(
          "flex min-h-tap gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3",
          "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
          deleted && "opacity-60",
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            incident ? "bg-danger text-on-danger" : "bg-surface-sunken text-text-muted",
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <time
              dateTime={entry.occurredAt}
              className="font-mono text-sm text-text-muted tabular-nums"
            >
              {formatClock(new Date(entry.occurredAt), timezone)}
            </time>
            <span className="text-sm text-text-muted">
              {LABELS[entry.type] ?? "Entry"}
            </span>
            {incident ? (
              <span className="font-mono text-sm text-text-muted">{incident.code}</span>
            ) : null}
          </span>

          <span
            className={cn("mt-0.5 block truncate text-text", deleted && "line-through")}
          >
            {entry.text ??
              entry.packageInfo?.carrier ??
              entry.areaName ??
              LABELS[entry.type] ??
              "Entry"}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-2">
            {entry.areaName ? <Badge tone="outline">{entry.areaName}</Badge> : null}
            {entry.mediaCount > 0 ? (
              <Badge tone="neutral">
                <Camera aria-hidden="true" className="size-3" />
                {entry.mediaCount}
              </Badge>
            ) : null}
            {incident?.severity ? (
              <Badge tone={incident.severity === "HIGH" ? "danger" : "neutral"}>
                {incident.severity.toLowerCase()}
              </Badge>
            ) : null}
            {incident?.status === "RESOLVED" ? (
              <Badge tone="primary">Resolved</Badge>
            ) : null}
            {entry.packageInfo?.deliveredAt ? (
              <Badge tone="primary">Delivered</Badge>
            ) : null}
            {entry.revisionCount > 0 ? (
              <Badge tone="outline">
                Edited{entry.revisionCount > 1 ? ` ${entry.revisionCount}x` : ""}
              </Badge>
            ) : null}
            {deleted ? <Badge tone="outline">Removed</Badge> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
