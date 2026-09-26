"use client";

import * as React from "react";

import { DictateField } from "@/components/shift/dictate-field";
import type { TimelineEntryData } from "@/components/shift/shift-timeline";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { BottomSheet, SheetRoot } from "@/components/ui/sheet";
import { submitTimelineWrite } from "@/lib/offline/submit";
import { formatClock } from "@/lib/time";

/**
 * Section 9.3's Note sheet.
 *
 * The entry is timestamped at the moment the sheet *opened*, not when it is
 * saved. A guard who takes ninety seconds to type should not have the note
 * land ninety seconds after the thing it describes — that gap is exactly what
 * gets picked apart when a report is read back. The parent remounts this on
 * open, so mount time is open time.
 */
export function NoteSheet({
  open,
  onOpenChange,
  shiftId,
  areas,
  timezone,
  onSaved,
  onPendingChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  areas: readonly { id: string; name: string }[];
  timezone: string;
  onSaved: (entry: TimelineEntryData) => void;
  onPendingChange: (pending: number) => void;
}) {
  const [openedAt] = React.useState(() => new Date());
  const [text, setText] = React.useState("");
  const [raw, setRaw] = React.useState("");
  const [areaId, setAreaId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    onPendingChange(1);
    const clientId = crypto.randomUUID();
    try {
      const result = await submitTimelineWrite<{ entryId: string }>({
        clientId,
        label: "note",
        envelope: {
          action: "createEntry",
          input: {
            shiftId,
            clientId,
            type: "NOTE",
            occurredAt: openedAt.toISOString(),
            text: text.trim(),
            transcriptRaw: raw || undefined,
            areaId: areaId || undefined,
          },
        },
      });
      if (result.status === "rejected") {
        setError(result.message);
        return;
      }
      onSaved({
        // Queued writes have no server id yet. The timeline keys on `clientId`
        // anyway, and the entry row upserts on it when the queue drains, so
        // the id it eventually gets is the id this row already stands for.
        id: result.status === "sent" ? result.data.entryId : clientId,
        clientId,
        type: "NOTE",
        occurredAt: openedAt.toISOString(),
        text: text.trim(),
        deletedAt: null,
        areaName: areas.find((a) => a.id === areaId)?.name ?? null,
        revisionCount: 0,
        mediaCount: 0,
        incident: null,
        packageInfo: null,
        pending: result.status === "queued",
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
      onPendingChange(0);
    }
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <BottomSheet
        title="Note"
        description={`Timestamped ${formatClock(openedAt, timezone)}, when you opened this.`}
        footer={
          <Button
            size="xl"
            className="w-full"
            busy={busy}
            disabled={text.trim().length === 0}
            onClick={save}
          >
            Save note
          </Button>
        }
      >
        <div className="space-y-5 py-2">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <DictateField
            label="What happened?"
            rows={5}
            value={text}
            onValueChange={setText}
            onRawChange={setRaw}
          />

          {areas.length > 0 ? (
            <ChipGroup
              label="Where?"
              hint="Optional"
              value={areaId}
              onValueChange={setAreaId}
              options={areas.map((area) => ({ value: area.id, label: area.name }))}
            />
          ) : null}
        </div>
      </BottomSheet>
    </SheetRoot>
  );
}
