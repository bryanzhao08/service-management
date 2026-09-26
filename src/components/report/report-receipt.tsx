import { AlertTriangle, FileText, Images } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  StatusTracker,
  type TrackerState,
  type TrackerStep,
} from "@/components/ui/status-tracker";
import type { DeliveryStatus } from "@/generated/prisma/enums";
import type { ReceiptData, ReceiptDelivery } from "@/lib/db/receipt";
import { formatDateTimeArchival } from "@/lib/time";

/**
 * Section 9.5, rendered once and used by both the guard's page and the signed
 * public link.
 *
 * A server component with no interactivity on purpose: this is the block a
 * manager may screenshot into an insurance file, so everything on it has to be
 * a fact already settled on the server, not something a client fetch filled in
 * after paint.
 */

/**
 * The chain every delivery walks. Queued and Sent always happened by the time
 * a row exists; the third step is where they differ.
 *
 * Rendering all three even for a bounce is deliberate — "we accepted it, the
 * provider accepted it, their server refused it" is the sentence a manager
 * needs, and collapsing it to one red chip loses the middle of it.
 */
function deliverySteps(delivery: ReceiptDelivery): TrackerStep[] {
  const { status, statusAt } = delivery;

  const queued: TrackerStep = {
    id: "queued",
    label: "Queued",
    state: "done",
    at: status === "QUEUED" ? statusAt : null,
  };

  const sentState: TrackerState =
    status === "QUEUED" ? "pending" : status === "FAILED" ? "failed" : "done";
  const sent: TrackerStep = {
    id: "sent",
    label: "Sent to provider",
    state: sentState,
    at: status === "SENT" ? statusAt : null,
    ...(delivery.providerMessageId ? { detail: delivery.providerMessageId } : {}),
  };

  const final: TrackerStep = (() => {
    switch (status) {
      case "DELIVERED":
        return { id: "final", label: "Delivered", state: "done", at: statusAt };
      case "DELAYED":
        return {
          id: "final",
          label: "Delayed by the receiving server",
          state: "active",
          at: statusAt,
          detail: "Still trying. No action needed yet.",
        };
      case "BOUNCED":
        return {
          id: "final",
          label: "Bounced",
          state: "failed",
          at: statusAt,
          detail: delivery.bounceReason ?? "The receiving server refused it.",
        };
      case "COMPLAINED":
        return {
          id: "final",
          label: "Marked as spam",
          state: "failed",
          at: statusAt,
          detail: "They flagged it. Confirm the address is still the right one.",
        };
      case "FAILED":
        return {
          id: "final",
          label: "Send failed",
          state: "failed",
          at: statusAt,
          detail: delivery.lastError ?? "The provider rejected the send.",
        };
      case "UNCONFIRMED":
        return {
          id: "final",
          label: "Not confirmed",
          state: "pending",
          at: statusAt,
          // The honest reading. Nobody should file "unconfirmed" as "failed",
          // and nobody should file it as "delivered" either.
          detail:
            "Accepted by the provider, but no delivery confirmation came back within 24 hours.",
        };
      default:
        return { id: "final", label: "Delivered", state: "pending", at: null };
    }
  })();

  return [queued, sent, final];
}

const STATUS_TONE: Record<
  DeliveryStatus,
  "primary" | "neutral" | "danger" | "attention"
> = {
  QUEUED: "neutral",
  SENT: "neutral",
  DELIVERED: "primary",
  DELAYED: "attention",
  BOUNCED: "danger",
  COMPLAINED: "danger",
  FAILED: "danger",
  UNCONFIRMED: "attention",
};

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  QUEUED: "Queued",
  SENT: "Sent",
  DELIVERED: "Delivered",
  DELAYED: "Delayed",
  BOUNCED: "Bounced",
  COMPLAINED: "Spam",
  FAILED: "Failed",
  UNCONFIRMED: "Unconfirmed",
};

export function ReportReceipt({
  data,
  pdfHref,
  galleryHref,
  actions,
}: {
  data: ReceiptData;
  /** Null when the viewer is a link holder who should not get the raw file. */
  pdfHref: string | null;
  galleryHref: string | null;
  /** Copy-link / download-receipt controls, only rendered for signed-in staff. */
  actions?: React.ReactNode;
}) {
  const zone = data.siteTimezone;
  const at = (when: Date | null) => (when ? formatDateTimeArchival(when, zone) : "—");

  const failed = data.deliveries.filter((d) =>
    ["BOUNCED", "COMPLAINED", "FAILED"].includes(d.status),
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>
              {data.siteName} &middot; v{data.version}
            </span>
            <Badge tone={data.sentAt ? "primary" : "neutral"}>
              {data.sentAt ? "Sent" : "Not sent"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <Fact label="Generated" value={at(data.generatedAt)} />
            <Fact label="Sent" value={at(data.sentAt)} />
            <Fact
              label="Pages"
              value={data.pages === null ? "—" : String(data.pages)}
            />
            <Fact label="Size" value={humanBytes(data.bytes)} />
          </dl>

          <div className="flex flex-wrap gap-2">
            {pdfHref ? (
              <Button variant="secondary" asChild>
                <a href={pdfHref} target="_blank" rel="noopener noreferrer">
                  <FileText className="size-4" aria-hidden="true" />
                  Download PDF
                </a>
              </Button>
            ) : null}
            {galleryHref && data.hasGallery ? (
              <Button variant="secondary" asChild>
                <a href={galleryHref} target="_blank" rel="noopener noreferrer">
                  <Images className="size-4" aria-hidden="true" />
                  Open gallery
                </a>
              </Button>
            ) : null}
            {actions}
          </div>
        </CardContent>
      </Card>

      {failed.length > 0 ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md bg-danger px-3 py-2 text-sm text-on-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {failed.length === 1
              ? "1 recipient did not receive this report."
              : `${failed.length} recipients did not receive this report.`}{" "}
            A supervisor has been notified.
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {data.deliveries.length === 0 ? (
            <p className="text-sm text-text-muted">
              This report has not been sent yet.
            </p>
          ) : (
            data.deliveries.map((delivery) => (
              <div key={delivery.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{delivery.name ?? delivery.email}</span>
                  {delivery.roleLabel ? (
                    <span className="text-xs text-text-muted">
                      {delivery.roleLabel}
                    </span>
                  ) : null}
                  {delivery.required ? <Badge tone="outline">Required</Badge> : null}
                  <Badge tone={STATUS_TONE[delivery.status]}>
                    {STATUS_LABEL[delivery.status]}
                  </Badge>
                </div>
                {delivery.name ? (
                  <p className="text-xs break-all text-text-muted">{delivery.email}</p>
                ) : null}
                <StatusTracker steps={deliverySteps(delivery)} timeZone={zone} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Submission receipt</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-text-muted">
            A permanent record of what was sent, when, and to whom. It does not change
            when the report is regenerated; a correction becomes a new version with its
            own receipt.
          </p>
          <dl className="flex flex-col gap-3">
            <Fact label="Company" value={data.companyName} />
            <Fact label="Site" value={data.siteName} />
            <Fact label="Guard on shift" value={data.guardName} />
            <Fact label="Report generated by" value={data.generatedByName} />
            <Fact
              label="Shift"
              value={`${at(data.shiftStart)} → ${at(data.shiftEnd)}`}
            />
            <Fact label="Generated at" value={at(data.generatedAt)} />
            <Fact label="Sent at" value={at(data.sentAt)} />
            <Fact label="File SHA-256" value={data.sha256 ?? "—"} mono />
            <Fact label="Content hash" value={data.contentHash ?? "—"} mono />
          </dl>
          <p className="text-xs text-text-muted">
            The content hash covers the shift&rsquo;s facts rather than the file, so a
            printed copy can still be checked against the record years from now.
          </p>
        </CardContent>
      </Card>

      {data.versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {data.versions.map((version) => (
              <div key={version.id} className="flex items-center justify-between gap-2">
                <span className={version.id === data.reportId ? "font-medium" : ""}>
                  v{version.version}
                  {version.id === data.reportId ? " (this one)" : ""}
                </span>
                <span className="text-text-muted tabular-nums">
                  {at(version.sentAt ?? version.generatedAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "font-medium"}>{value}</dd>
    </div>
  );
}

function humanBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
