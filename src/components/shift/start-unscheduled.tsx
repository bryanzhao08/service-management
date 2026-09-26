"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { openUnscheduledShift } from "@/lib/actions/shift";
import { clientId } from "@/lib/utils";

export type StartableSite = {
  id: string;
  name: string;
  code: string;
};

/**
 * The way a guard starts work when nobody scheduled them.
 *
 * This exists because the dashboard's empty state used to be a sentence —
 * "No shifts scheduled for you." — with no control anywhere on the screen. A
 * guard standing at the post could not begin, which made the whole product
 * unusable for the most ordinary case there is.
 *
 * The client id is generated once per mount and reused across retries, so the
 * failure this is most likely to hit — tapping again because the first tap
 * looked dead on a car-park signal — resolves to one shift, not two.
 */
export function StartUnscheduled({ sites }: { sites: readonly StartableSite[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const keys = React.useRef(new Map<string, string>());

  if (sites.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-text-muted">
            You are not assigned to a site yet. Your supervisor assigns you, and it
            shows up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function start(siteId: string) {
    setError(null);
    setPending(siteId);
    let key = keys.current.get(siteId);
    if (!key) {
      key = clientId();
      keys.current.set(siteId, key);
    }
    const result = await openUnscheduledShift({ siteId, clientId: key });
    if (result.ok) {
      router.push(`/shift/${result.data.shiftId}/start`);
      return;
    }
    setPending(null);
    setError(result.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{sites.length === 1 ? "Start shift" : "Start a shift"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-muted">
          Nothing is scheduled for you right now. Pick the post you are working and
          start.
        </p>
        {sites.map((site) => (
          <Button
            key={site.id}
            size="xl"
            className="w-full"
            disabled={pending !== null}
            onClick={() => start(site.id)}
          >
            {pending === site.id ? "Starting…" : `Start at ${site.name}`}
          </Button>
        ))}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
