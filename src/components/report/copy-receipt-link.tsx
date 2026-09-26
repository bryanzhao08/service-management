"use client";

import { Check, Link2 } from "lucide-react";
import * as React from "react";

import { receiptLink } from "@/app/shift/[id]/report/actions";
import { Button } from "@/components/ui/button";

/**
 * "Copy receipt link" from section 9.5.
 *
 * Shows the URL as text after copying rather than only firing a toast, because
 * `navigator.clipboard` silently fails in a few real situations (an insecure
 * origin, an iOS webview without a user-gesture chain). A guard who trusts a
 * green toast and pastes nothing into an email has been lied to; a visible URL
 * they can select by hand always works.
 */
export function CopyReceiptLink({ reportId }: { reportId: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    const result = await receiptLink(reportId);
    setBusy(false);
    if (result.error || !result.url) {
      setError(result.error ?? "Could not create the link.");
      return;
    }
    const absolute = new URL(result.url, window.location.origin).toString();
    setUrl(absolute);
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Not an error worth showing: the URL is on screen and selectable.
      setCopied(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <Button variant="secondary" onClick={onClick} busy={busy}>
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Link2 className="size-4" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy receipt link"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {url ? (
        <p className="text-xs break-all text-text-muted" aria-live="polite">
          Anyone with this link can read the receipt, no account needed. Expires in 90
          days.
          <br />
          <code className="select-all">{url}</code>
        </p>
      ) : null}
    </div>
  );
}
