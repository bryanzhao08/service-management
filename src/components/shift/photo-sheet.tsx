"use client";

import { Camera } from "lucide-react";
import * as React from "react";

import { DictateField } from "@/components/shift/dictate-field";
import type { TimelineEntryData } from "@/components/shift/shift-timeline";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { PhotoGrid, type PhotoTile } from "@/components/ui/photo-grid";
import { BottomSheet, SheetRoot } from "@/components/ui/sheet";
import { createEntry } from "@/lib/actions/entries";
import { uploadPhoto } from "@/lib/media/upload-client";
import { formatClock } from "@/lib/time";

/**
 * Section 9.3's Photo sheet.
 *
 * Photos start uploading the moment they are picked, before the guard has
 * written a caption or pressed save. On a phone that is the difference between
 * a save that returns instantly and one that blocks for thirty seconds on a
 * bad connection — and the entry it attaches to does not exist yet either way,
 * so there is nothing to lose by starting early.
 *
 * That ordering is why `entryId` is attached in a second pass: `POST
 * /api/media` accepts a null entry, and the rows are relinked once the entry
 * has an id. A photo whose relink fails is still a recorded photo on the
 * shift, which is the right failure — losing the caption is recoverable,
 * losing the picture is not.
 */
export function PhotoSheet({
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
  const [tiles, setTiles] = React.useState<PhotoTile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const files = React.useRef(new Map<string, File>());
  const uploaded = React.useRef(new Map<string, string>());

  const uploading = tiles.filter((t) => t.status === "uploading").length;
  const ready = tiles.filter((t) => t.status === "uploaded").length;

  // Object URLs are a manual resource; without this the blobs stay alive for
  // the life of the document every time a guard opens the sheet.
  React.useEffect(() => {
    const urls = tiles.map((t) => t.src).filter((s): s is string => Boolean(s));
    return () => {
      for (const url of urls) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
    };
    // Only on unmount: revoking mid-life would blank the thumbnails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTile(id: string, patch: Partial<PhotoTile>) {
    setTiles((current) =>
      current.map((tile) => (tile.id === id ? { ...tile, ...patch } : tile)),
    );
  }

  async function send(id: string, file: File) {
    setTile(id, { status: "uploading" });
    try {
      const result = await uploadPhoto({ file, shiftId, clientId: id });
      uploaded.current.set(id, result.mediaId);
      setTile(id, { status: "uploaded" });
    } catch (cause) {
      setTile(id, { status: "failed" });
      setError(cause instanceof Error ? cause.message : "That photo failed to upload.");
    }
  }

  function add(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);
    const next: PhotoTile[] = [];
    for (const file of Array.from(picked)) {
      // Must satisfy the presign route's `[A-Za-z0-9_-]{8,64}`, so no braces.
      const id = crypto.randomUUID();
      files.current.set(id, file);
      next.push({
        id,
        src: URL.createObjectURL(file),
        alt: `Photo taken ${formatClock(new Date(), timezone)}`,
        status: "pending",
      });
    }
    setTiles((current) => [...current, ...next]);
    for (const tile of next) {
      const file = files.current.get(tile.id);
      if (file) void send(tile.id, file);
    }
  }

  function retry(id: string) {
    const file = files.current.get(id);
    if (file) void send(id, file);
  }

  function remove(id: string) {
    files.current.delete(id);
    uploaded.current.delete(id);
    setTiles((current) => {
      const gone = current.find((tile) => tile.id === id);
      if (gone?.src?.startsWith("blob:")) URL.revokeObjectURL(gone.src);
      return current.filter((tile) => tile.id !== id);
    });
  }

  async function save() {
    if (ready === 0) return;
    setBusy(true);
    setError(null);
    onPendingChange(1);
    const clientId = crypto.randomUUID();
    try {
      const result = await createEntry({
        shiftId,
        clientId,
        type: "MEDIA",
        occurredAt: openedAt,
        text: text.trim() || undefined,
        transcriptRaw: raw || undefined,
        areaId: areaId || undefined,
        mediaIds: [...uploaded.current.values()],
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved({
        id: result.data.entryId,
        clientId,
        type: "MEDIA",
        occurredAt: openedAt.toISOString(),
        text: text.trim() || null,
        deletedAt: null,
        areaName: areas.find((a) => a.id === areaId)?.name ?? null,
        revisionCount: 0,
        mediaCount: ready,
        incident: null,
        packageInfo: null,
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
        title="Photo"
        description={`Timestamped ${formatClock(openedAt, timezone)}, when you opened this.`}
        footer={
          <Button
            size="xl"
            className="w-full"
            busy={busy}
            disabled={ready === 0 || uploading > 0}
            onClick={save}
          >
            {uploading > 0
              ? `Uploading ${uploading}…`
              : `Save ${ready || ""} photo${ready === 1 ? "" : "s"}`.trim()}
          </Button>
        }
      >
        <div className="space-y-5 py-2">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            // `environment` opens the rear camera directly on a phone, which is
            // the camera pointed at whatever the guard is standing in front of.
            capture="environment"
            multiple
            className="sr-only"
            // The visible Button is the real control; this input only exists to
            // be opened programmatically. It still needs a name (axe checks
            // every input, focusable or not) and it stays out of the tab order
            // so keyboard users do not meet the same control twice.
            aria-label="Choose photos"
            tabIndex={-1}
            onChange={(event) => {
              add(event.target.files);
              event.target.value = "";
            }}
          />

          {tiles.length === 0 ? (
            <Button
              size="xl"
              variant="secondary"
              className="w-full"
              onClick={() => inputRef.current?.click()}
            >
              <Camera aria-hidden className="size-5" />
              Take a photo
            </Button>
          ) : (
            <PhotoGrid
              photos={tiles}
              onAdd={() => inputRef.current?.click()}
              onRemove={remove}
              onRetry={retry}
              max={10}
            />
          )}

          <DictateField
            label="Caption"
            hint="Optional"
            rows={3}
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
              options={areas.map((area) => ({
                value: area.id,
                label: area.name,
              }))}
            />
          ) : null}
        </div>
      </BottomSheet>
    </SheetRoot>
  );
}
