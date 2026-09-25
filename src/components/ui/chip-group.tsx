"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChipOption {
  value: string;
  label: string;
}

/**
 * A one-of-N picker that *wraps*, for option sets too long for
 * `SegmentedControl`'s equal columns — the nine incident categories in
 * section 9.3, or a site's area list.
 *
 * A radio group, not a row of buttons: only one can be chosen, and a screen
 * reader should say "3 of 9" rather than announcing nine unrelated controls.
 * Every chip is `min-h-tap` because this is tapped one-handed at 3am.
 *
 * It carries its own visible label rather than sitting inside `Field`: a
 * radio group is not a labelable element, so `Field`'s `<label for=…>` would
 * point at an id nothing owns.
 */
export function ChipGroup({
  options,
  value,
  onValueChange,
  label,
  hint,
  className,
}: {
  options: readonly ChipOption[];
  /** `""` means nothing picked — legal for every optional field. */
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  hint?: string;
  className?: string;
}) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p id={id} className="text-sm font-medium">
        {label}
      </p>
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      <RadioGroupPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        aria-labelledby={id}
        aria-describedby={hintId}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className={cn(
              "min-h-tap cursor-pointer rounded-full border px-4 text-sm font-medium",
              "border-border bg-surface text-text transition-colors duration-150",
              "focus-visible:outline-focus focus-visible:outline-2 focus-visible:outline-offset-2",
              "data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
              "data-[state=checked]:text-on-primary",
            )}
          >
            {option.label}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </div>
  );
}
