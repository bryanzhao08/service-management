import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tones map onto semantic tokens, never raw palette colors, so a chip can only
 * ever render a pairing that `pnpm contrast` already verified.
 */
const TONES = {
  neutral: "bg-surface text-text-muted border-border",
  primary: "bg-primary text-on-primary border-transparent",
  attention: "bg-attention text-on-attention border-transparent",
  danger: "bg-danger text-on-danger border-transparent",
  outline: "bg-transparent text-text border-border",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentPropsWithoutRef<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1",
        "text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * The one place a report/delivery status turns into a color.
 *
 * Centralised deliberately: section 12 needs the same vocabulary in the guard
 * app, the client portal, and the admin console, and three separate colour
 * decisions is how those three drift apart.
 */
export type ReportStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "SENDING"
  | "DELIVERED"
  | "OPENED"
  | "BOUNCED"
  | "FAILED";

const STATUS_TONE: Record<ReportStatus, BadgeTone> = {
  DRAFT: "outline",
  SUBMITTED: "neutral",
  APPROVED: "primary",
  SENDING: "neutral",
  DELIVERED: "primary",
  OPENED: "primary",
  BOUNCED: "danger",
  FAILED: "danger",
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  SENDING: "Sending",
  DELIVERED: "Delivered",
  OPENED: "Opened",
  BOUNCED: "Bounced",
  FAILED: "Failed",
};

export function StatusChip({
  status,
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"span">, "children"> & {
  status: ReportStatus;
}) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className} {...props}>
      {/* Shape as well as colour, so the status is not colour-only. */}
      <span aria-hidden="true" className="text-[10px] leading-none">
        {status === "BOUNCED" || status === "FAILED" ? "×" : "•"}
      </span>
      {STATUS_LABEL[status]}
    </Badge>
  );
}
