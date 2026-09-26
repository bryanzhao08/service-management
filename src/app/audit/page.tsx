import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuditTable } from "@/components/audit/audit-table";
import { requireUnlockedActor } from "@/lib/auth/guards";
import {
  auditActionsPresent,
  auditActors,
  canViewAudit,
  listAuditEvents,
  AUDIT_PAGE_SIZE,
} from "@/lib/db/audit";

export const metadata: Metadata = { title: "Activity" };

/**
 * The audit log (section 20).
 *
 * `notFound()` rather than a 403 page. A guard who types /audit learns nothing
 * from a 404; a 403 confirms the route exists and that they are inside a
 * company that has one, which is a small leak but a free one to close.
 */
function parseDay(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  // Local midnight, not UTC. `new Date("2026-03-01")` is UTC midnight, which
  // in California is 4pm the day before — so a "from" filter would silently
  // include the previous evening's activity.
  const [, y, m, d] = match;
  return new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireUnlockedActor();
  if (!canViewAudit(actor)) notFound();

  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const page = Math.max(0, Number.parseInt(one("page") ?? "0", 10) || 0);
  const filters = {
    action: one("action"),
    actorId: one("actor"),
    entityType: one("entity"),
    from: parseDay(one("from")),
    to: parseDay(one("to"), true),
  };

  const [{ rows, total, hasMore }, actors, actions] = await Promise.all([
    listAuditEvents(actor, filters, page),
    auditActors(actor),
    auditActionsPresent(actor),
  ]);

  const query = new URLSearchParams();
  for (const key of ["action", "actor", "entity", "from", "to"]) {
    const value = one(key);
    if (value) query.set(key, value);
  }
  const pageHref = (next: number) => {
    const q = new URLSearchParams(query);
    if (next > 0) q.set("page", String(next));
    const s = q.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-16" data-audit-page>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-text">Activity</h1>
        <p className="text-sm text-text-muted" data-audit-total={total}>
          {total === 0
            ? "Nothing recorded yet."
            : `${total} ${total === 1 ? "event" : "events"} across the company.`}
        </p>
      </header>

      <AuditTable
        rows={rows}
        actors={actors}
        actions={actions}
        selected={{
          action: one("action") ?? "",
          actor: one("actor") ?? "",
          entity: one("entity") ?? "",
          from: one("from") ?? "",
          to: one("to") ?? "",
        }}
      />

      {total > AUDIT_PAGE_SIZE ? (
        <nav className="flex items-center justify-between" aria-label="Pages">
          {page > 0 ? (
            <a
              className="text-sm text-text underline"
              href={pageHref(page - 1)}
              data-audit-prev
            >
              Newer
            </a>
          ) : (
            <span />
          )}
          <span className="text-sm text-text-muted">
            Page {page + 1} of {Math.ceil(total / AUDIT_PAGE_SIZE)}
          </span>
          {hasMore ? (
            <a
              className="text-sm text-text underline"
              href={pageHref(page + 1)}
              data-audit-next
            >
              Older
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  );
}
