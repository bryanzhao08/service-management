import * as React from "react";

import { cn } from "@/lib/utils";

export interface TimelineEntry {
  id: string;
  at: Date | string;
  title: string;
  detail?: string;
  /** Drives the dot colour. Incidents read `attention`, not `danger`. */
  tone?: "default" | "primary" | "attention" | "danger";
  icon?: React.ElementType;
  media?: React.ReactNode;
}

const DOT_TONE = {
  default: "bg-text-muted",
  primary: "bg-primary",
  attention: "bg-attention",
  danger: "bg-danger",
} as const;

/**
 * The shift log, newest last: a vertical rail of timestamped entries.
 *
 * Rendered as an ordered list so a screen reader announces position and
 * count. The rail itself is a border on the <li>, not a separate element, so
 * it can never fall out of sync with the rows.
 */
export function Timeline({
  entries,
  className,
}: {
  entries: readonly TimelineEntry[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {entries.map((entry, index) => {
        const Icon = entry.icon;
        const last = index === entries.length - 1;
        const at = new Date(entry.at);

        return (
          <li
            key={entry.id}
            className={cn(
              "relative flex gap-3 pb-5 pl-0",
              !last &&
                "before:absolute before:top-6 before:bottom-0 before:left-[11px] before:w-px before:bg-border",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                Icon ? "border border-border bg-surface" : "",
              )}
            >
              {Icon ? (
                <Icon className="size-3.5" />
              ) : (
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    DOT_TONE[entry.tone ?? "default"],
                  )}
                />
              )}
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <time
                  dateTime={at.toISOString()}
                  className="text-xs text-text-muted tabular-nums"
                >
                  {at.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <span className="text-[15px] font-medium">{entry.title}</span>
              </div>
              {entry.detail ? (
                <p className="text-sm whitespace-pre-wrap text-text-muted">
                  {entry.detail}
                </p>
              ) : null}
              {entry.media}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
