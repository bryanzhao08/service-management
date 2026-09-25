"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Bottom sheets and dialogs share one primitive because they share one
 * contract: focus trap, escape to close, scroll lock, and an accessible name.
 * The only difference is where they come from and how they animate.
 *
 * Default to BottomSheet on this product. A centred dialog on a phone puts the
 * confirm button in the middle of the screen, which breaks the bottom-third
 * rule from principle 1.
 */

export const SheetRoot = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

function Overlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[var(--overlay)]",
        "data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in",
        className,
      )}
      {...props}
    />
  );
}

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  title: string;
  description?: string;
  /** Hide the visible title but keep the accessible name. */
  hideTitle?: boolean;
  footer?: React.ReactNode;
}

/** Slides up from the bottom edge. The primary action lives in `footer`. */
export const BottomSheet = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function BottomSheet(
  { className, children, title, description, hideTitle, footer, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col border-border bg-surface",
          "rounded-t-[var(--radius-sheet)] border-t",
          "data-[state=closed]:animate-slide-down data-[state=open]:animate-slide-up",
          className,
        )}
        {...props}
      >
        {/* Purely decorative grab affordance; the real close is the button. */}
        <div className="flex justify-center pt-2.5" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogPrimitive.Title
              className={cn("text-lg font-semibold", hideTitle && "sr-only")}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-tap shrink-0 items-center justify-center rounded-full text-text-muted hover:text-text"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">{children}</div>

        {footer ? (
          <div className="pb-safe flex flex-col gap-2 border-t border-border px-4 pt-3">
            {footer}
          </div>
        ) : (
          <div className="pb-safe" />
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/** Centred modal. For desktop admin surfaces, not the guard's phone. */
export const Dialog = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function Dialog(
  { className, children, title, description, hideTitle, footer, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "elevation fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md border-border bg-surface",
          "max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-sheet)] border",
          "data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-2">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogPrimitive.Title
              className={cn("text-lg font-semibold", hideTitle && "sr-only")}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-tap shrink-0 items-center justify-center rounded-full text-text-muted hover:text-text"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border p-4">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
