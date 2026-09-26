"use client";

import * as React from "react";

import { DictateField } from "@/components/shift/dictate-field";
import type { SiteConfig, TimelineEntryData } from "@/components/shift/shift-timeline";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { Field } from "@/components/ui/input";
import { BottomSheet, SheetRoot } from "@/components/ui/sheet";
import { SegmentedControl, Toggle } from "@/components/ui/toggle";
import { submitTimelineWrite } from "@/lib/offline/submit";
import { formatClock } from "@/lib/time";

/**
 * Section 9.3's quick-incident sheet.
 *
 * The design target is ten seconds, so category is the only required field and
 * the save button arms the moment a chip is tapped. Everything else can be
 * filled in later from the entry detail view — which is the point: a guard
 * dealing with the incident should not be holding a phone.
 *
 * Like the note sheet, the entry is timestamped when the sheet *opened*. The
 * incident code is allocated server-side from that timestamp in the site's
 * timezone, so a graveyard shift crossing midnight still reads as one night.
 */
export function IncidentSheet({
  open,
  onOpenChange,
  shiftId,
  site,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  site: SiteConfig;
  onSaved: (entry: TimelineEntryData) => void;
}) {
  // Mounted fresh each time the sheet opens (the parent keys it on an open
  // counter), so mount time *is* the moment the guard tapped Incident.
  const [openedAt] = React.useState(() => new Date());
  const [categoryId, setCategoryId] = React.useState("");
  const [severity, setSeverity] = React.useState<"" | "LOW" | "MEDIUM" | "HIGH">("");
  const [areaId, setAreaId] = React.useState("");
  const [ongoing, setOngoing] = React.useState(false);
  const [text, setText] = React.useState("");
  const [raw, setRaw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const category = site.entryTypes.find((type) => type.id === categoryId);

  async function save() {
    if (!category) return;
    setBusy(true);
    setError(null);
    const clientId = crypto.randomUUID();
    try {
      const result = await submitTimelineWrite<{
        entryId: string;
        incidentId: string;
        code: string;
        status: string;
      }>({
        clientId,
        label: "incident",
        envelope: {
          action: "createIncident",
          input: {
            shiftId,
            clientId,
            occurredAt: openedAt.toISOString(),
            categoryKey: category.key,
            siteEntryTypeId: category.id,
            severity: severity || undefined,
            status: ongoing ? "ONGOING" : undefined,
            text: text.trim() || undefined,
            transcriptRaw: raw || undefined,
            areaId: areaId || undefined,
          },
        },
      });
      if (result.status === "rejected") {
        setError(result.message);
        return;
      }
      const sent = result.status === "sent" ? result.data : null;
      onSaved({
        id: sent ? sent.entryId : clientId,
        clientId,
        type: "INCIDENT",
        occurredAt: openedAt.toISOString(),
        text: text.trim() || category.label,
        deletedAt: null,
        areaName: site.areas.find((area) => area.id === areaId)?.name ?? null,
        revisionCount: 0,
        mediaCount: 0,
        incident: {
          id: sent ? sent.incidentId : clientId,
          // The code is a per-shift sequence the database assigns, so an
          // offline incident genuinely does not have one yet. Showing a
          // guessed number would be worse than showing none: the code is what
          // gets quoted back in a dispute, and a number that changes on sync
          // is a number nobody can trust.
          code: sent ? sent.code : "",
          categoryKey: category.key,
          severity: severity || null,
          status: sent ? sent.status : ongoing ? "ONGOING" : "OPEN",
          // The header's live timer reads this, so it has to match the
          // timestamp the server actually stored, not "now".
          ongoingSince: ongoing ? openedAt.toISOString() : null,
        },
        packageInfo: null,
        pending: result.status === "queued",
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <BottomSheet
        title="Incident"
        description={`Timestamped ${formatClock(openedAt, site.timezone)}. Only the category is required.`}
        footer={
          <Button
            size="xl"
            className="w-full"
            busy={busy}
            disabled={!category}
            onClick={save}
          >
            {category ? `Log ${category.label.toLowerCase()}` : "Pick a category"}
          </Button>
        }
      >
        <div className="space-y-5 py-2">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <ChipGroup
            label="What happened?"
            value={categoryId}
            onValueChange={setCategoryId}
            options={site.entryTypes.map((type) => ({
              value: type.id,
              label: type.label,
            }))}
          />

          <Field label="How bad?" hint="Optional">
            <SegmentedControl
              label="Severity"
              value={severity}
              onValueChange={setSeverity}
              options={[
                { value: "", label: "Not set" },
                { value: "LOW", label: "Low" },
                { value: "MEDIUM", label: "Medium" },
                { value: "HIGH", label: "High" },
              ]}
            />
          </Field>

          {site.areas.length > 0 ? (
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

          <DictateField
            label="Details"
            hint="Optional"
            rows={4}
            value={text}
            onValueChange={setText}
            onRawChange={setRaw}
          />

          {/* Ongoing pins the incident to the sticky header with a live timer
              until it is resolved (section 9.3), so it is deliberately the
              last thing in the sheet: it is a commitment to come back. */}
          <Toggle
            checked={ongoing}
            onCheckedChange={setOngoing}
            label="Still happening"
            description="Pins this to the top with a running timer until you resolve it."
          />
        </div>
      </BottomSheet>
    </SheetRoot>
  );
}
