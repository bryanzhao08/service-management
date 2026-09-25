"use client";

import {
  ArrowRightLeft,
  Coffee,
  Footprints,
  Package as PackageIcon,
  UserCheck,
} from "lucide-react";
import * as React from "react";

import { DictateField } from "@/components/shift/dictate-field";
import type { SiteConfig, TimelineEntryData } from "@/components/shift/shift-timeline";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { BottomSheet, SheetRoot } from "@/components/ui/sheet";
import { logBreakCover } from "@/lib/actions/shift";
import { createEntry } from "@/lib/actions/entries";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Section 9.3's "More" menu — the long tail, kept out of the bottom bar so
 * Note, Photo and Incident stay full-width targets.
 *
 * Two states in one sheet: the menu, then a compose step for whichever kind
 * was picked. Keeping it in one sheet means one animation and one dismissal,
 * so a mis-tap costs a back press rather than a lost draft.
 *
 * Custom entry types (section 9.3's last "More" item) are not here yet:
 * `SiteEntryType` has no discriminator between an incident category and a
 * custom entry type, and the seeded rows are explicitly the nine incident
 * categories. Listing them would let a guard log "Medical" as a plain entry
 * with no incident code and no place in the incident summary. The
 * distinction belongs with the entry-types tab in site config (section 9.9).
 * Recorded in ASSUMPTIONS.md.
 */

type Kind = "PATROL" | "VISITOR" | "HANDOFF_NOTE" | "BREAK_START" | "BREAK_END";

const KINDS: {
  kind: Kind;
  label: string;
  hint: string;
  icon: React.ElementType;
  prompt: string;
}[] = [
  {
    kind: "PATROL",
    label: "Patrol",
    hint: "A round you walked",
    icon: Footprints,
    prompt: "What did you cover?",
  },
  {
    kind: "VISITOR",
    label: "Visitor or vendor",
    hint: "Who came on site",
    icon: UserCheck,
    prompt: "Who, and why?",
  },
  {
    kind: "HANDOFF_NOTE",
    label: "Handoff note",
    hint: "For the next guard",
    icon: ArrowRightLeft,
    prompt: "What should the next guard know?",
  },
  {
    kind: "BREAK_START",
    label: "Break cover started",
    hint: "Someone took over",
    icon: Coffee,
    prompt: "Who is covering?",
  },
  {
    kind: "BREAK_END",
    label: "Break cover ended",
    hint: "You are back",
    icon: Coffee,
    prompt: "Anything to note?",
  },
];

export function MoreSheet({
  open,
  onOpenChange,
  shiftId,
  site,
  onPackage,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  site: SiteConfig;
  onPackage: () => void;
  onSaved: (entry: TimelineEntryData) => void;
}) {
  const [kind, setKind] = React.useState<Kind | null>(null);
  const [openedAt, setOpenedAt] = React.useState<Date | null>(null);
  const [text, setText] = React.useState("");
  const [raw, setRaw] = React.useState("");
  const [areaId, setAreaId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function choose(next: Kind) {
    setKind(next);
    // The entry belongs to the moment the guard decided to log it, not the
    // moment they finished typing.
    setOpenedAt(new Date());
    // Back-then-a-different-kind must not carry the abandoned draft over.
    setText("");
    setRaw("");
    setAreaId("");
    setError(null);
  }

  const active = KINDS.find((item) => item.kind === kind);

  async function save() {
    if (!kind || !openedAt) return;
    setBusy(true);
    setError(null);
    const clientId = crypto.randomUUID();
    const body = text.trim();
    try {
      if (kind === "BREAK_START" || kind === "BREAK_END") {
        const result = await logBreakCover({
          shiftId,
          clientId,
          phase: kind === "BREAK_START" ? "START" : "END",
          occurredAt: openedAt,
          text: body || undefined,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onSaved({
          id: result.data.entryId,
          clientId,
          type: kind === "BREAK_START" ? "BREAK_COVER_START" : "BREAK_COVER_END",
          occurredAt: openedAt.toISOString(),
          text: body || null,
          deletedAt: null,
          areaName: null,
          revisionCount: 0,
          mediaCount: 0,
          incident: null,
          packageInfo: null,
        });
        onOpenChange(false);
        return;
      }

      const type =
        kind === "PATROL" ? "PATROL" : kind === "VISITOR" ? "VISITOR" : "HANDOFF_GIVEN";
      const result = await createEntry({
        shiftId,
        clientId,
        type,
        occurredAt: openedAt,
        text: body || undefined,
        transcriptRaw: raw || undefined,
        areaId: areaId || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved({
        id: result.data.entryId,
        clientId,
        type,
        occurredAt: openedAt.toISOString(),
        text: body || null,
        deletedAt: null,
        areaName: site.areas.find((area) => area.id === areaId)?.name ?? null,
        revisionCount: 0,
        mediaCount: 0,
        incident: null,
        packageInfo: null,
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <BottomSheet
        title={active ? active.label : "More"}
        description={
          active && openedAt
            ? `Timestamped ${formatClock(openedAt, site.timezone)}.`
            : undefined
        }
        footer={
          active ? (
            <>
              <Button size="xl" className="w-full" busy={busy} onClick={save}>
                Save {active.label.toLowerCase()}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={() => setKind(null)}
              >
                Back
              </Button>
            </>
          ) : undefined
        }
      >
        {active ? (
          <div className="space-y-5 py-2">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}

            <DictateField
              key={kind}
              label={active.prompt}
              hint="Optional"
              rows={4}
              value={text}
              onValueChange={setText}
              onRawChange={setRaw}
            />

            {kind !== "HANDOFF_NOTE" && site.areas.length > 0 ? (
              <ChipGroup
                label="Where?"
                hint="Optional"
                value={areaId}
                onValueChange={setAreaId}
                options={site.areas.map((area) => ({
                  value: area.id,
                  label: area.name,
                }))}
              />
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2 py-2">
            <MenuRow
              icon={PackageIcon}
              label="Package"
              hint="Received at the desk"
              onClick={onPackage}
            />
            {KINDS.map((item) => (
              <MenuRow
                key={item.kind}
                icon={item.icon}
                label={item.label}
                hint={item.hint}
                onClick={() => choose(item.kind)}
              />
            ))}
          </ul>
        )}
      </BottomSheet>
    </SheetRoot>
  );
}

function MenuRow({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-h-tap w-full items-center gap-3 rounded-[var(--radius-card)] border border-border",
          "bg-surface px-4 py-3 text-left",
          "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
        )}
      >
        <Icon aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-text">{label}</span>
          <span className="block text-sm text-text-muted">{hint}</span>
        </span>
      </button>
    </li>
  );
}
