"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const FIELD_BASE = cn(
  "bg-surface border-border text-text placeholder:text-text-muted w-full rounded-[var(--radius-card)] border",
  "px-3.5 py-3 min-h-tap",
  // 16px minimum, otherwise iOS Safari zooms the whole page on focus.
  "text-base",
  "transition-colors duration-150",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger",
);

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useFieldProps<
  P extends {
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  },
>(props: P): P {
  const field = React.useContext(FieldContext);
  if (!field) return props;
  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid ? true : undefined),
  };
}

/**
 * Wraps a control with its label, hint, and error, and wires the ARIA
 * relationships automatically.
 *
 * Doing this by hand is how `aria-describedby` ends up pointing at an id that
 * no longer exists, which is silent: the control looks fine and the screen
 * reader just never announces the error.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  id: idProp,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const reactId = React.useId();
  const id = idProp ?? reactId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {required ? (
            <span className="ml-1 text-attention" aria-hidden="true">
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </label>
        {hint ? (
          <p id={hintId} className="text-sm text-text-muted">
            {hint}
          </p>
        ) : null}
        {children}
        {error ? (
          // `alert` so a validation failure is announced when it appears, not
          // only when focus happens to land on the control.
          <p id={errorId} role="alert" className="text-sm text-attention">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(function Input({ className, ...props }, ref) {
  return (
    <input ref={ref} className={cn(FIELD_BASE, className)} {...useFieldProps(props)} />
  );
});

export interface TextareaProps extends React.ComponentPropsWithoutRef<"textarea"> {
  /** Grow with content instead of scrolling inside a fixed box. */
  autoGrow?: boolean;
  maxRows?: number;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, autoGrow = true, maxRows = 16, rows = 3, ...props },
    ref,
  ) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el || !autoGrow) return;
      // Collapse first: scrollHeight never shrinks on its own, so without this
      // the box only ever grows, even as the guard deletes text.
      el.style.height = "auto";
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
      const max = lineHeight * maxRows;
      el.style.height = `${Math.min(el.scrollHeight, max)}px`;
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }, [autoGrow, maxRows]);

    React.useLayoutEffect(resize, [resize, props.value, props.defaultValue]);

    return (
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={rows}
        onInput={(event) => {
          resize();
          props.onInput?.(event);
        }}
        className={cn(FIELD_BASE, "resize-none leading-6", className)}
        {...useFieldProps(props)}
      />
    );
  },
);

/**
 * A native <select>. Deliberately not a custom listbox: the platform picker is
 * a full-screen wheel on iOS, which is the correct one-thumb affordance and
 * something a custom popover cannot match.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentPropsWithoutRef<"select">
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        FIELD_BASE,
        "appearance-none bg-[right_0.9rem_center] bg-no-repeat pr-10",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23aeaa79' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...useFieldProps(props)}
    >
      {children}
    </select>
  );
});
