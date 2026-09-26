"use client";

import { postOrQueue } from "@/lib/offline/outbox";

/**
 * The one call a timeline sheet makes to save something (section 14).
 *
 * Every sheet already builds its own optimistic row — `onSaved` is handed a
 * fully-formed `TimelineEntryData` assembled from local state, and the only
 * thing that comes back from the server is a set of ids. That is what makes
 * offline cheap here: the row a guard sees after saving is the same row
 * whether the write went out or went into the queue.
 *
 * So this returns a discriminated result rather than throwing, and the caller
 * decides what to render. `queued` is not an error state; it is the normal
 * ending for a note written in a stairwell.
 */

export type SubmitResult<T> =
  | { status: "sent"; data: T }
  | { status: "queued" }
  | { status: "rejected"; message: string };

type ActionEnvelope = {
  action: "createEntry" | "createIncident" | "createPackage";
  input: Record<string, unknown>;
};

export async function submitTimelineWrite<T>(params: {
  clientId: string;
  /** Shown in the offline banner: "2 notes waiting" beats "2 requests". */
  label: string;
  envelope: ActionEnvelope;
}): Promise<SubmitResult<T>> {
  const { queued, response } = await postOrQueue({
    url: "/api/offline/replay",
    clientId: params.clientId,
    label: params.label,
    body: params.envelope,
  });

  if (queued || !response) return { status: "queued" };

  if (!response.ok) {
    // The route answers 4xx with the action's own `{ok:false, code, message}`,
    // so the wording a guard reads is the wording the action chose. A body
    // that will not parse falls back rather than throwing, because a save
    // button that explodes is worse than one that says it did not work.
    let message = "Could not save that. Try again.";
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === "string" && body.message) message = body.message;
    } catch {
      // Keep the fallback.
    }
    return { status: "rejected", message };
  }

  const body = (await response.json()) as { ok: true; data: T };
  return { status: "sent", data: body.data };
}
