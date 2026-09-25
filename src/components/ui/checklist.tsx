"use client";

import { Camera, Check } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

export interface ChecklistItem {
  id: string;
  label: string;
  /** Section 9: some checkpoints require a photo before they can be ticked. */
  requiresPhoto?: boolean;
  done: boolean;
  doneAt?: Date | string | null;
  photoCount?: number;
}

/**
 * The patrol checklist. Each row is one tap to complete.
 *
 * A row that needs a photo stays visibly incomplete until one exists, and the
 * checkbox is disabled rather than hidden — the guard needs to see the
 * requirement, not discover it when the tap does nothing.
 */
export function Checklist({
  items,
  onToggle,
  onAddPhoto,
  className,
}: {
  items: readonly ChecklistItem[];
  onToggle: (id: string, next: boolean) => void;
  onAddPhoto?: (id: string) => void;
  className?: string;
}) {
  const doneCount = items.filter((item) => item.done).length;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-sm text-text-muted" aria-live="polite">
        {doneCount} of {items.length} complete
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const photoCount = item.photoCount ?? 0;
          const blocked = Boolean(item.requiresPhoto) && photoCount === 0 && !item.done;
          const labelId = `checklist-${item.id}`;

          return (
            <li
              key={item.id}
              className={cn(
                "flex min-h-tap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3",
                item.done && "border-primary/40",
              )}
            >
              <Checkbox
                checked={item.done}
                disabled={blocked}
                aria-labelledby={labelId}
                onCheckedChange={(next) => onToggle(item.id, next === true)}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  id={labelId}
                  className={cn(
                    "text-[15px]",
                    item.done && "text-text-muted line-through",
                  )}
                >
                  {item.label}
                </span>
                {item.done && item.doneAt ? (
                  <time
                    dateTime={new Date(item.doneAt).toISOString()}
                    className="text-xs text-text-muted"
                  >
                    {new Date(item.doneAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                ) : null}
              </div>

              {item.requiresPhoto ? (
                <button
                  type="button"
                  onClick={() => onAddPhoto?.(item.id)}
                  aria-label={
                    photoCount > 0
                      ? `${item.label}: ${photoCount} photo${photoCount === 1 ? "" : "s"}, add another`
                      : `${item.label}: photo required, add one`
                  }
                  className={cn(
                    "flex size-tap shrink-0 items-center justify-center gap-1 rounded-[var(--radius-card)]",
                    photoCount > 0 ? "text-primary" : "text-attention",
                  )}
                >
                  {photoCount > 0 ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      <span className="text-xs tabular-nums">{photoCount}</span>
                    </>
                  ) : (
                    <Camera className="size-5" aria-hidden="true" />
                  )}
                </button>
              ) : null}

              {blocked ? (
                <Badge tone="outline" className="hidden sm:inline-flex">
                  Photo required
                </Badge>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
