"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type ToastTone = "info" | "success" | "attention" | "danger";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Optional single action, e.g. "Undo" or "Retry". */
  action?: { label: string; onClick: () => void };
  durationMs: number;
}

interface ToastContextValue {
  toast: (
    input: Omit<ToastItem, "id" | "tone" | "durationMs"> & {
      tone?: ToastTone;
      durationMs?: number;
    },
  ) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

const TONE_STYLE: Record<ToastTone, { icon: React.ElementType; className: string }> = {
  info: { icon: Info, className: "text-text-muted" },
  success: { icon: CheckCircle2, className: "text-primary" },
  attention: { icon: AlertTriangle, className: "text-attention" },
  danger: { icon: XCircle, className: "text-danger" },
};

/**
 * Toasts land at the TOP on mobile.
 *
 * The bottom third of the screen belongs to the primary action and the tab
 * bar (principle 1); a toast there covers the button the guard is reaching
 * for, and gets dismissed by the same tap.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(0);

  const toast = React.useCallback<ToastContextValue["toast"]>((input) => {
    const id = nextId.current++;
    setItems((current) => [
      ...current,
      {
        id,
        tone: "info",
        durationMs: 5000,
        ...input,
      },
    ]);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="up">
        {children}
        {items.map((item) => {
          const { icon: Icon, className } = TONE_STYLE[item.tone];
          return (
            <ToastPrimitive.Root
              key={item.id}
              duration={item.durationMs}
              onOpenChange={(open) => {
                if (!open) {
                  setItems((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  );
                }
              }}
              className={cn(
                "elevation flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3.5",
                "data-[state=closed]:animate-toast-out data-[state=open]:animate-toast-in",
                "data-[swipe=end]:animate-toast-out",
              )}
            >
              <Icon
                className={cn("mt-0.5 size-5 shrink-0", className)}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <ToastPrimitive.Title className="text-[15px] font-medium">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="text-sm text-text-muted">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              {item.action ? (
                <ToastPrimitive.Action
                  altText={item.action.label}
                  onClick={item.action.onClick}
                  className="shrink-0 px-2 py-1 text-sm font-semibold text-primary"
                >
                  {item.action.label}
                </ToastPrimitive.Action>
              ) : null}
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport
          className={cn(
            "pt-safe fixed inset-x-0 top-0 z-[60] flex w-full flex-col gap-2 px-3",
            "sm:right-0 sm:left-auto sm:max-w-sm",
          )}
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
