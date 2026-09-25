import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Shaped like the content it replaces so the layout does
 * not jump when real data lands — a jump on a phone means the guard's thumb
 * lands on the wrong control.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-shimmer rounded-[var(--radius-card)] bg-surface",
        "bg-[linear-gradient(90deg,var(--surface)_25%,color-mix(in_oklab,var(--surface),var(--text)_8%)_37%,var(--surface)_63%)]",
        "bg-[length:280%_100%]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The state a screen shows when it has nothing.
 *
 * Always carries an action. An empty screen with no next step is how a guard
 * decides the app is broken and goes back to paper.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-surface text-text-muted">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {description ? (
          <p className="max-w-[42ch] text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
