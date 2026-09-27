"use client";

import { useId } from "react";

import { brandIconArtwork } from "@/lib/brand-icon";
import { cn } from "@/lib/utils";

export function Mark({
  className,
  inverted = false,
  title = "Transient",
}: {
  className?: string;
  inverted?: boolean;
  title?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      {...(title === ""
        ? { "aria-hidden": true as const, focusable: false }
        : { role: "img", "aria-label": title })}
      className={cn("brand-mark h-8 w-8", className)}
      dangerouslySetInnerHTML={{
        __html: brandIconArtwork({
          id,
          plate: inverted ? "#ffffff" : "var(--bg)",
          shade: inverted ? "#e8e8e8" : "var(--glass-selected)",
          accent: inverted ? "#000000" : "var(--primary)",
          highlight: inverted ? "#595959" : "var(--accent)",
        }),
      }}
    />
  );
}
