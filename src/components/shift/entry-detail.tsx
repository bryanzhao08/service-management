"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/input";
import { softDeleteEntry, updateEntry } from "@/lib/actions/entries";

export type EntryRevisionData = {
  id: string;
  text: string;
  editedAt: string;
  editedBy: string;
};

/**
 * Section 9.3's detail view. Every timeline row linked here and the route did
 * not exist, so tapping anything a guard had just written returned a 404.
 *
 * Two writes, and they are deliberately different shapes. An edit is ordinary
 * and saves in place. A removal is not: the reason is mandatory, so the field
 * is what opens rather than a confirm dialog, and the wording says "remove",
 * never "delete", because the row survives and a supervisor still sees it.
 */
export function EntryDetail({
  entry,
  canWrite,
}: {
  entry: {
    id: string;
    shiftId: string;
    text: string | null;
    deletedAt: string | null;
    deleteReason: string | null;
    revisions: readonly EntryRevisionData[];
  };
  canWrite: boolean;
}) {
  const router = useRouter();
  const [text, setText] = React.useState(entry.text ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const dirty = text.trim() !== (entry.text ?? "").trim();
  const removed = entry.deletedAt !== null;

  async function save() {
    setBusy(true);
    setError(null);
    const result = await updateEntry({
      entryId: entry.id,
      shiftId: entry.shiftId,
      text: text.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function remove() {
    if (!reason.trim()) {
      setError("Say why you are removing this.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await softDeleteEntry({
      entryId: entry.id,
      shiftId: entry.shiftId,
      reason: reason.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(`/shift/${entry.shiftId}`);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{removed ? "Removed entry" : "Entry"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {removed ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap text-text line-through">
                {entry.text ?? "No text"}
              </p>
              <p className="text-sm text-text-muted">Removed: {entry.deleteReason}</p>
            </div>
          ) : canWrite ? (
            <>
              <Field label="What happened" id="entry-text">
                <Textarea
                  rows={6}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setSaved(false);
                  }}
                />
              </Field>
              <Button
                className="w-full"
                size="xl"
                disabled={busy || !dirty || text.trim().length === 0}
                onClick={save}
              >
                {busy ? "Saving…" : saved && !dirty ? "Saved" : "Save changes"}
              </Button>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-text">{entry.text ?? "No text"}</p>
          )}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {entry.revisions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Earlier versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-muted">
              Edits are kept. This is what the entry said before each change.
            </p>
            {entry.revisions.map((rev) => (
              <div
                key={rev.id}
                className="rounded-[var(--radius-card)] border border-border p-3"
              >
                <p className="text-sm whitespace-pre-wrap text-text">{rev.text}</p>
                <p className="mt-2 text-xs text-text-muted">
                  Replaced by {rev.editedBy} · {rev.editedAt}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {canWrite && !removed ? (
        <Card>
          <CardHeader>
            <CardTitle>Remove this entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-muted">
              It stays on the record, struck through, with your reason attached. Nothing
              is erased.
            </p>
            {removing ? (
              <>
                <Field label="Why are you removing it?" id="entry-reason">
                  <Textarea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={remove}
                >
                  {busy ? "Removing…" : "Confirm removal"}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setRemoving(true)}
              >
                Remove entry
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
