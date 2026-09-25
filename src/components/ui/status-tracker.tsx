import { Check, CircleDashed, Loader2, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type TrackerState = "pending" | "active" | "done" | "failed";

export interface TrackerStep {
  id: string;
  label: string;
  state: TrackerState;
  at?: Date | string | null;
  detail?: string;
}

const STATE_ICON: Record<TrackerState, React.ElementType> = {
  pending: CircleDashed,
  active: Loader2,
  done: Check,
  failed: X,
};

const STATE_STYLE: Record<TrackerState, string> = {
  pending: "text-text-muted border-border",
  active: "text-primary border-primary",
  done: "text-on-primary bg-primary border-transparent",
  failed: "text-on-danger bg-danger border-transparent",
};

/**
 * Delivery proof, rendered (section 12): submitted, sent, delivered, opened —
 * or bounced.
 *
 * This is the screen that answers "did the client actually get it", so each
 * step carries its own timestamp rather than one time for the whole chain. A
 * failed step is marked by an X as well as colour, so the failure is legible
 * without colour vision.
 */
export function StatusTracker({
  steps,
  className,
}: {
  steps: readonly TrackerStep[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {steps.map((step, index) => {
        const Icon = STATE_ICON[step.state];
        const last = index === steps.length - 1;

        return (
          <li key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border",
                  STATE_STYLE[step.state],
                )}
              >
                <Icon
                  className={cn("size-4", step.state === "active" && "animate-spin")}
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              </span>
              {!last ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-px flex-1",
                    step.state === "done" ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
            </div>

            <div
              className={cn("flex min-w-0 flex-col gap-0.5", last ? "pb-0" : "pb-5")}
            >
              <span
                className={cn(
                  "text-[15px] font-medium",
                  step.state === "pending" && "text-text-muted",
                )}
              >
                {step.label}
                <span className="sr-only">
                  {": "}
                  {step.state === "done"
                    ? "complete"
                    : step.state === "failed"
                      ? "failed"
                      : step.state === "active"
                        ? "in progress"
                        : "not started"}
                </span>
              </span>
              {step.at ? (
                <time
                  dateTime={new Date(step.at).toISOString()}
                  className="text-xs text-text-muted tabular-nums"
                >
                  {new Date(step.at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              ) : null}
              {step.detail ? (
                <p className="text-sm text-text-muted">{step.detail}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
