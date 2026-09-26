import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EntryDetail } from "@/components/shift/entry-detail";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";
import { formatClock } from "@/lib/time";

export const metadata: Metadata = { title: "Entry" };

/**
 * Section 9.3: "Tapping opens the detail view."
 *
 * Every row in `shift-timeline.tsx` has always linked here. The route did not
 * exist, so every entry a guard logged was a 404 the moment they tapped it —
 * found by a first-run journey check watching for failed requests, not by
 * reading the code, because nothing in the code looks wrong from either side.
 */
export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id, entryId } = await params;
  const actor = await requireUnlockedActor();
  const scoped = db(actor);

  const entry = await scoped.entry.findByIdForDetail(entryId);
  if (!entry) notFound();
  // The entry is reachable through its own id, so the shift in the URL is not
  // trusted: a mismatched pair is a wrong link, not a different entry.
  if (entry.shiftId !== id) notFound();

  const shift = entry.shift;
  const tz = shift.site.timezone;
  // Supervisors read a guard's shift (section 8); writing is the guard's own,
  // and only while the shift is still open.
  const canWrite = shift.guardId === actor.userId && shift.clockOutAt === null;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <Link
          href={`/shift/${id}`}
          className="text-sm text-text-muted underline underline-offset-4"
        >
          Back to timeline
        </Link>
        <h1 className="text-2xl font-semibold text-text">
          {formatClock(entry.occurredAt, tz)} ·{" "}
          {entry.type.toLowerCase().replace(/_/g, " ")}
        </h1>
        <p className="text-sm text-text-muted">
          {shift.site.name}
          {entry.area ? ` · ${entry.area.name}` : ""}
        </p>
      </header>

      {entry.incident ? (
        <p className="rounded-[var(--radius-card)] border border-danger bg-danger/10 p-3 text-sm text-text">
          Incident {entry.incident.code}
          {entry.incident.severity
            ? ` · ${entry.incident.severity.toLowerCase()}`
            : ""}{" "}
          · {entry.incident.status.toLowerCase()}
        </p>
      ) : null}

      <EntryDetail
        canWrite={canWrite}
        entry={{
          id: entry.id,
          shiftId: entry.shiftId,
          text: entry.text,
          deletedAt: entry.deletedAt?.toISOString() ?? null,
          deleteReason: entry.deleteReason,
          revisions: entry.revisions.map((rev) => ({
            id: rev.id,
            text: rev.text,
            editedAt: formatClock(rev.editedAt, tz),
            editedBy: rev.editedBy.name ?? rev.editedBy.email ?? "Someone",
          })),
        }}
      />
    </main>
  );
}
