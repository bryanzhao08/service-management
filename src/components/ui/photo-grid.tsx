"use client";

import { AlertTriangle, ImageOff, Loader2, Plus, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface PhotoTile {
  id: string;
  /** Object URL while local, signed URL once uploaded. */
  src: string | null;
  alt: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  /** 0-1. Only meaningful while `uploading`. */
  progress?: number;
}

/**
 * Thumbnails for photos attached to a log entry or checkpoint.
 *
 * Upload state lives on the tile, not in a separate list, so a photo taken
 * offline looks like a photo and not like a missing one. `pending` is a
 * normal, expected state here (principle 3), which is why it renders as a
 * dimmed image rather than an error.
 */
export function PhotoGrid({
  photos,
  onAdd,
  onRemove,
  onRetry,
  max,
  className,
}: {
  photos: readonly PhotoTile[];
  onAdd?: () => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  max?: number;
  className?: string;
}) {
  const atMax = max !== undefined && photos.length >= max;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => (
          <li
            key={photo.id}
            className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface"
          >
            {photo.src ? (
              // Local blob URLs and signed remote URLs, so next/image buys
              // nothing here and blocks blob: entirely.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.src}
                alt={photo.alt}
                className={cn(
                  "size-full object-cover",
                  photo.status !== "uploaded" && "opacity-60",
                )}
              />
            ) : (
              <span className="flex size-full items-center justify-center text-text-muted">
                <ImageOff className="size-5" aria-hidden="true" />
              </span>
            )}

            {photo.status === "uploading" ? (
              <span className="absolute inset-0 flex items-center justify-center bg-[var(--overlay)]">
                <Loader2 className="size-5 animate-spin text-text" aria-hidden="true" />
                <span className="sr-only">
                  Uploading {photo.alt}
                  {photo.progress !== undefined
                    ? `, ${Math.round(photo.progress * 100)}%`
                    : ""}
                </span>
              </span>
            ) : null}

            {photo.status === "failed" ? (
              <button
                type="button"
                onClick={() => onRetry?.(photo.id)}
                aria-label={`Upload failed for ${photo.alt}. Retry.`}
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/85 text-xs text-on-danger"
              >
                <AlertTriangle className="size-4" aria-hidden="true" />
                Retry
              </button>
            ) : null}

            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(photo.id)}
                aria-label={`Remove ${photo.alt}`}
                className="tap-target absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-bg/80 text-text"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}

        {onAdd && !atMax ? (
          <li>
            <button
              type="button"
              onClick={onAdd}
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border border-dashed border-border text-text-muted transition-colors hover:border-primary hover:text-accent"
            >
              <Plus className="size-5" aria-hidden="true" />
              <span className="text-xs">Add photo</span>
            </button>
          </li>
        ) : null}
      </ul>

      {max !== undefined ? (
        <p className="text-xs text-text-muted tabular-nums">
          {photos.length} of {max}
        </p>
      ) : null}
    </div>
  );
}
