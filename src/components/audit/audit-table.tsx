"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { auditLabel, type AuditRow } from "@/lib/audit-actions";

const ENTITY_TYPES = [
  "Shift",
  "Entry",
  "Report",
  "Recipient",
  "Site",
  "User",
  "Delivery",
];

/**
 * Colour by consequence, not by area.
 *
 * Someone opens this log because something looks wrong, so the rows that
 * destroy or expose something have to be findable by eye in a 50-row page.
 * Everything else stays neutral: if half the page is coloured, none of it
 * reads as a warning.
 */
function toneFor(action: string): "neutral" | "attention" | "danger" {
  if (
    action === "entry.delete" ||
    action === "recipient.remove" ||
    action === "link.revoke" ||
    action === "delivery.bounced" ||
    action === "delivery.complained"
  ) {
    return "danger";
  }
  if (action === "entry.edit" || action === "site.config" || action === "report.send") {
    return "attention";
  }
  return "neutral";
}

/**
 * The one detail worth putting in the row.
 *
 * A deletion reason or a recipient's address answers "what happened" without
 * opening anything; an entity id does not. Falling back to the id is honest
 * about there being nothing better rather than leaving the column blank,
 * which reads as a missing value.
 */
function describe(row: AuditRow): string {
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const record = meta as Record<string, unknown>;
    for (const key of ["reason", "email", "siteName", "name", "to"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return key === "reason" ? `\u201c${value}\u201d` : value;
      }
    }
  }
  return `${row.entityType} ${row.entityId.slice(0, 8)}`;
}

export function AuditTable({
  rows,
  actors,
  actions,
  selected,
}: {
  rows: AuditRow[];
  actors: { id: string; name: string }[];
  actions: string[];
  selected: {
    action: string;
    actor: string;
    entity: string;
    from: string;
    to: string;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Narrowing while on page 3 would land on an empty page, which reads as
    // "no activity" rather than "you moved the goalposts".
    next.delete("page");
    const query = next.toString();
    router.push(query ? `/audit?${query}` : "/audit");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1 text-sm">
          <span className="text-text-muted">Who</span>
          <select
            className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
            value={selected.actor}
            onChange={(e) => setParam("actor", e.target.value)}
            data-filter-actor
          >
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-text-muted">Action</span>
          <select
            className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
            value={selected.action}
            onChange={(e) => setParam("action", e.target.value)}
            data-filter-action
          >
            <option value="">Everything</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {auditLabel(action)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-text-muted">Thing</span>
          <select
            className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
            value={selected.entity}
            onChange={(e) => setParam("entity", e.target.value)}
            data-filter-entity
          >
            <option value="">Any</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-text-muted">From</span>
          <input
            type="date"
            className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
            value={selected.from}
            onChange={(e) => setParam("from", e.target.value)}
            data-filter-from
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-text-muted">To</span>
          <input
            type="date"
            className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
            value={selected.to}
            onChange={(e) => setParam("to", e.target.value)}
            data-filter-to
          />
        </label>
      </div>

      <DataTable
        caption="Everything recorded across the company, newest first."
        empty="No activity matches those filters."
        getRowKey={(row) => row.id}
        rows={rows}
        columns={[
          {
            key: "at",
            header: "When",
            cell: (row) => (
              <time dateTime={row.at.toISOString()} className="tabular-nums">
                {row.at.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            ),
          },
          {
            key: "what",
            header: "What",
            primary: true,
            cell: (row) => (
              <Badge tone={toneFor(row.action)} data-audit-action={row.action}>
                {row.label}
              </Badge>
            ),
          },
          {
            key: "who",
            header: "Who",
            cell: (row) =>
              row.actorName ?? (
                // A null actor is not a gap in the log. Recipient
                // verification is done by someone with no account, so naming
                // a user would be a lie.
                <span className="text-text-muted">Recipient</span>
              ),
          },
          {
            key: "detail",
            header: "Detail",
            hideOnMobile: true,
            cell: (row) => <span className="text-text-muted">{describe(row)}</span>,
          },
        ]}
      />
    </div>
  );
}
