"use client";

import * as React from "react";

import { revokeGalleryLink } from "@/app/shift/[id]/report/actions";
import { Button } from "@/components/ui/button";

/**
 * Revoke the gallery link (section 20).
 *
 * Two clicks, because there is no undo. The token is destroyed, not marked
 * inactive, so a client who bookmarked the gallery loses it permanently and
 * the only remedy is a fresh report.
 */
export function RevokeGallery({ reportId }: { reportId: string }) {
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  if (done) {
    return (
      <p className="text-sm text-text-muted" role="status" data-gallery-revoked>
        Link revoked. Anyone holding it now gets a dead page.
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => setConfirming(true)}
        data-revoke-gallery
      >
        Revoke photo link
      </Button>
    );
  }

  return (
    <div className="space-y-2" data-revoke-confirm>
      <p className="text-sm text-text">
        This kills the link for everyone, including the client. It can&rsquo;t be put
        back.
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          data-revoke-confirm-yes
          onClick={() =>
            startTransition(async () => {
              const result = await revokeGalleryLink(reportId);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setDone(true);
            })
          }
        >
          {pending ? "Revoking" : "Revoke it"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
