"use client";

import * as React from "react";

import { changePin } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";

/**
 * Change the device PIN (section 9.10).
 *
 * No "current PIN" field. Getting to this screen already required an unlocked
 * session, which means the PIN was entered during this session — asking again
 * would only be theatre, since anyone who reached here can already read every
 * entry the account can see.
 */
export function ChangePin({ hasPin }: { hasPin: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await changePin(pin, confirm);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPin("");
      setConfirm("");
      setOpen(false);
      setSaved(true);
    });
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-text-muted">
          {hasPin
            ? "A PIN is set on this account."
            : "No PIN yet. Anyone holding an unlocked phone can open the app."}
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen(true)}
          data-change-pin
        >
          {hasPin ? "Change PIN" : "Set a PIN"}
        </Button>
        {saved ? (
          <p className="text-sm text-text-muted" role="status">
            PIN saved.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-pin-form>
      <div className="space-y-2">
        <label className="text-sm font-medium text-text" htmlFor="new-pin">
          New PIN
        </label>
        <input
          id="new-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          data-pin-new
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-text" htmlFor="confirm-pin">
          Confirm
        </label>
        <input
          id="confirm-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          data-pin-confirm
        />
      </div>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} data-pin-save>
          {pending ? "Saving" : "Save PIN"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
