"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** A labelled on/off switch. The whole row is the tap target, not just the track. */
export function Toggle({
  label,
  description,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  label: string;
  description?: string;
}) {
  const id = React.useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div
      className={cn(
        "flex min-h-tap items-center justify-between gap-4 py-2",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-[15px] font-medium">
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className="text-sm text-text-muted">
            {description}
          </span>
        ) : null}
      </span>
      <SwitchPrimitive.Root
        id={id}
        aria-describedby={descriptionId}
        className={cn(
          "tap-target relative h-7 w-12 shrink-0 cursor-pointer rounded-[var(--radius-pill)] border border-border",
          "bg-surface data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
          "transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-5 rounded-full bg-text data-[state=checked]:bg-on-primary",
            "translate-x-1 transition-transform duration-150 data-[state=checked]:translate-x-6",
          )}
        />
      </SwitchPrimitive.Root>
    </div>
  );
}

export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "tap-target relative size-6 shrink-0 rounded-md border border-border bg-surface",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
        "flex items-center justify-center transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex text-on-primary">
        <Check className="size-4" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A one-of-N control for short option sets (shift type, date range, theme).
 *
 * Built on a radio group rather than tabs: these pick a value, they do not
 * swap a panel, and a screen reader should hear "2 of 3 selected", not
 * "tab selected".
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Accessible name for the whole group. */
  label: string;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={label}
      className={cn(
        "grid gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-1",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            "min-h-tap cursor-pointer rounded-[calc(var(--radius-card)-4px)] px-3 text-sm font-medium",
            "text-text-muted transition-colors duration-150",
            "data-[state=checked]:bg-primary data-[state=checked]:text-on-primary",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
