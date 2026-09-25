"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface Column<Row> {
  key: string;
  header: string;
  /** Rendered cell content. */
  cell: (row: Row) => React.ReactNode;
  /** Right-align numerics so columns of counts and money line up. */
  align?: "start" | "end";
  /** Hide below `sm`. The card view shows it instead. */
  hideOnMobile?: boolean;
  /** Used as the card title on mobile. Exactly one column should set this. */
  primary?: boolean;
}

/**
 * A table on desktop, a stack of cards on mobile.
 *
 * Not a horizontally scrolling table: a supervisor checking one report on a
 * phone should not have to swipe sideways to find the status column. The same
 * `columns` array drives both, so the two views cannot list different fields.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  caption,
  onRowClick,
  empty,
  className,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  /** Accessible description of the table. Required, not decorative. */
  caption: string;
  onRowClick?: (row: Row) => void;
  empty?: React.ReactNode;
  className?: string;
}) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  const primary = columns.find((column) => column.primary) ?? columns[0];
  const secondary = columns.filter((column) => column !== primary);

  return (
    <div className={className}>
      {/* Desktop */}
      <table className="hidden w-full border-collapse text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-3 py-2.5 text-xs font-medium tracking-wide text-text-muted uppercase",
                  column.align === "end" ? "text-right" : "text-left",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border last:border-0",
                onRowClick && "cursor-pointer hover:bg-surface",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-3 py-3 align-middle",
                    column.align === "end" && "text-right tabular-nums",
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile */}
      <ul className="flex flex-col gap-2 sm:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li
            key={getRowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              "rounded-[var(--radius-card)] border border-border bg-surface p-3.5",
              onRowClick && "cursor-pointer active:border-primary",
            )}
          >
            <div className="mb-2 font-medium">{primary.cell(row)}</div>
            <dl className="flex flex-col gap-1 text-sm">
              {secondary
                .filter((column) => !column.hideOnMobile)
                .map((column) => (
                  <div
                    key={column.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <dt className="text-text-muted">{column.header}</dt>
                    <dd className="min-w-0 text-right tabular-nums">
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
