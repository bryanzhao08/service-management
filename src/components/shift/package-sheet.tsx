"use client";

import * as React from "react";

import type { TimelineEntryData } from "@/components/shift/shift-timeline";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { BottomSheet, SheetRoot } from "@/components/ui/sheet";
import { submitTimelineWrite } from "@/lib/offline/submit";

/**
 * Section 9.3's package entry.
 *
 * Every field is optional. A package that arrives with an unreadable label is
 * still a package that arrived, and refusing to log it because the tracking
 * number is smudged would push the guard back to a paper notebook — which is
 * the behaviour this product exists to replace.
 *
 * Barcode scanning (`@zxing/browser`) and the delivery signature canvas are
 * both listed as "strongly preferred" rather than required in section 9.3, and
 * are not in this milestone. The tracking field accepts a typed number today.
 */
export function PackageSheet({
  open,
  onOpenChange,
  shiftId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  onSaved: (entry: TimelineEntryData) => void;
}) {
  // Mounted fresh on each open (the parent keys it), so mount time is the tap.
  const [openedAt] = React.useState(() => new Date());
  const [carrier, setCarrier] = React.useState("");
  const [trackingNumber, setTrackingNumber] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [room, setRoom] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const clientId = crypto.randomUUID();
    try {
      const result = await submitTimelineWrite<{ entryId: string; packageId: string }>({
        clientId,
        label: "package",
        envelope: {
          action: "createPackage",
          input: {
            shiftId,
            clientId,
            occurredAt: openedAt.toISOString(),
            carrier: carrier.trim() || undefined,
            trackingNumber: trackingNumber.trim() || undefined,
            recipientName: recipientName.trim() || undefined,
            room: room.trim() || undefined,
          },
        },
      });
      if (result.status === "rejected") {
        setError(result.message);
        return;
      }
      const sent = result.status === "sent" ? result.data : null;
      const label =
        [carrier.trim(), recipientName.trim()].filter(Boolean).join(" for ") ||
        "Package received";
      onSaved({
        id: sent ? sent.entryId : clientId,
        clientId,
        type: "PACKAGE",
        occurredAt: openedAt.toISOString(),
        text: label,
        deletedAt: null,
        areaName: null,
        revisionCount: 0,
        mediaCount: 0,
        incident: null,
        packageInfo: {
          id: sent ? sent.packageId : clientId,
          carrier: carrier.trim() || null,
          trackingNumber: trackingNumber.trim() || null,
          recipientName: recipientName.trim() || null,
          deliveredAt: null,
        },
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
        title="Package"
        description="Log it now, fill in the rest later if you need to."
        footer={
          <Button size="xl" className="w-full" busy={busy} onClick={save}>
            Log package
          </Button>
        }
      >
        <div className="space-y-4 py-2">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Field label="Carrier" hint="Optional">
            <Input
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              autoComplete="off"
              placeholder="UPS, FedEx, Amazon…"
            />
          </Field>

          <Field label="Tracking number" hint="Optional">
            <Input
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              autoComplete="off"
              // Tracking numbers are alphanumeric, so a numeric keypad would
              // strand anyone holding a label that starts with letters.
              inputMode="text"
              spellCheck={false}
            />
          </Field>

          <Field label="For" hint="Optional">
            <Input
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              autoComplete="off"
              placeholder="Guest or resident name"
            />
          </Field>

          <Field label="Room or unit" hint="Optional">
            <Input
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              autoComplete="off"
              inputMode="text"
            />
          </Field>
        </div>
      </BottomSheet>
    </SheetRoot>
  );
}
