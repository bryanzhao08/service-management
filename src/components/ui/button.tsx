"use client";

import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sizes exist for thumb reach, not decoration. `md` is the smallest that still
 * meets the 48x48 minimum from principle 1; `xl` is for the primary action in
 * the bottom bar, which a tired guard hits one-handed in the dark.
 */
const SIZES = {
  md: "min-h-tap px-4 text-[15px] gap-2 rounded-[var(--radius-control)]",
  lg: "min-h-[56px] px-5 text-base gap-2.5 rounded-[var(--radius-control)]",
  xl: "min-h-[64px] px-6 text-lg font-semibold gap-3 rounded-[var(--radius-control)]",
} as const;

/**
 * Every variant pairs a fill with the matching `on-*` foreground token, so a
 * variant can never produce a pairing that isn't in docs/contrast.md.
 */
const VARIANTS = {
  primary:
    "bg-primary text-on-primary active:bg-primary-pressed active:text-on-primary-pressed",
  secondary: "bg-secondary text-on-secondary active:brightness-90",
  ghost:
    "bg-transparent text-text border border-border hover:bg-surface active:bg-surface",
  danger: "bg-danger text-on-danger active:brightness-90",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the single child element (e.g. a Next <Link>). */
  asChild?: boolean;
  /** Shows a spinner and blocks repeat taps without changing layout width. */
  busy?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    asChild = false,
    busy = false,
    fullWidth = false,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      ref={ref}
      // A button inside a form defaults to submit, which has caused real
      // accidental submissions; callers opt in explicitly.
      type={asChild ? undefined : (type ?? "button")}
      // Still focusable while busy so a screen reader can read the state.
      aria-busy={busy || undefined}
      aria-disabled={disabled || busy || undefined}
      disabled={asChild ? undefined : disabled || busy}
      className={cn(
        "app-button relative inline-flex items-center justify-center font-medium",
        "transition-[background-color,color,filter] duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-50",
        "select-none",
        SIZES[size],
        VARIANTS[variant],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {busy ? (
        <>
          {/* Keeps the label in the flow so the button never resizes. */}
          <span className="invisible contents">{children}</span>
          <Loader2 aria-hidden="true" className="absolute size-5 animate-spin" />
        </>
      ) : (
        children
      )}
    </Component>
  );
});

export interface IconButtonProps extends Omit<
  React.ComponentPropsWithoutRef<"button">,
  "aria-label"
> {
  /**
   * Required, not optional. Section 18: every icon button has an accessible
   * name. Making it part of the type means a nameless one cannot compile.
   */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, label, variant = "ghost", size = "md", busy, children, ...props },
    ref,
  ) {
    const square = {
      md: "size-tap",
      lg: "size-[56px]",
      xl: "size-[64px]",
    }[size];

    return (
      <Button
        ref={ref}
        aria-label={label}
        title={label}
        variant={variant}
        size={size}
        busy={busy}
        className={cn("shrink-0 !px-0", square, className)}
        {...props}
      >
        {children}
      </Button>
    );
  },
);
