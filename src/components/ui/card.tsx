import * as React from "react";

import { cn } from "@/lib/utils";

/** Opaque data surfaces keep shift information clear in either color mode. */
export function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "elevation rounded-[var(--radius-card)] border border-border bg-surface",
        interactive &&
          "transition-colors duration-150 hover:border-text-muted active:border-primary",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"h3">) {
  return <h3 className={cn("text-base font-semibold", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-sm text-text-muted", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-border p-4", className)}
      {...props}
    />
  );
}
