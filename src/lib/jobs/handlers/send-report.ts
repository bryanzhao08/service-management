import { z } from "zod";

import {
  blindSpotCoverage,
  createDeliveries,
  markDeliveryFailed,
  markDeliverySent,
  markReportSent,
  recordAudit,
  reportForSend,
} from "@/lib/db/deliveries";
import { getEmailProvider, MAX_ATTACHMENT_BYTES } from "@/lib/email/provider";
import { reportEmail, type ReportEmailIncident } from "@/lib/email/report-email";
import { storage } from "@/lib/storage/driver";
import { baseUrl } from "@/lib/url";
import { formatDateTimeArchival, formatClock, isoDateInZone } from "@/lib/time";

/**
 * `SEND_REPORT` (section 12).
 *
 * The rule that shapes this file: **exactly one email per recipient per report
 * version, never split across messages because of attachment size.** A client
 * who gets "report 1 of 3" learns nothing and forwards none of it, and a split
 * send makes per-recipient delivery status meaningless -- which is the thing
 * this product is sold on. So when the PDF does not fit, the email still goes
 * as one message with a link instead of an attachment.
 *
 * Sends are per-recipient by default (`site.sendIndividually`) for the same
 * reason: one message with five people in `to:` yields one provider message id
 * and therefore one delivery status covering five different mail servers. That
 * is not a delivery record, it is an average.
 */

export const sendReportPayload = z.object({ reportId: z.string().min(1) });

export type SendReportResult = {
  reportId: string;
  result: "sent" | "gone" | "not-ready" | "no-recipients" | "already-sent";
  sent?: number;
  failed?: number;
  attached?: boolean;
};

/**
 * A send is retried by the queue, so a partial failure must not re-send to the
 * people who already got it. Rows already past QUEUED are skipped.
 */
const RESENDABLE = new Set(["QUEUED", "FAILED"]);

export async function sendReport(rawPayload: unknown): Promise<SendReportResult> {
  const { reportId } = sendReportPayload.parse(rawPayload);

  const report = await reportForSend(reportId);

  if (!report) return { reportId, result: "gone" };

  // Gated on the PDF existing, not on the status being exactly READY. A send
  // that half-failed leaves the report SENT or PARTIAL, and a status equality
  // check would make the retry -- the whole reason this is a queued job --
  // bail out as "not ready" and strand the recipients who never got it.
  //
  // DRAFT/GENERATING/FAILED is the real not-ready case, and it is not a failure
  // to retry against either: GENERATE_REPORT owns getting there and enqueues
  // this job itself on success.
  if (!report.storageKey || report.status === "FAILED") {
    return { reportId, result: "not-ready" };
  }

  const { shift } = report;
  const { site } = shift;

  // A bounced address is excluded rather than retried. Sending to a known-dead
  // mailbox trains the provider's reputation down and produces another bounce
  // that tells nobody anything new.
  const recipients = site.recipients.filter((r) => r.status !== "BOUNCED");
  if (recipients.length === 0) return { reportId, result: "no-recipients" };

  const deliveries = await createDeliveries(reportId, recipients);
  const pending = deliveries.filter((d) => RESENDABLE.has(d.status));
  if (pending.length === 0) return { reportId, result: "already-sent" };

  const pdf = await storage().get(report.storageKey);
  const fits = pdf.byteLength <= MAX_ATTACHMENT_BYTES;
  // `clockInAt` is nullable on a scheduled-but-never-started shift. A report
  // only exists for a shift that ran, but the type does not know that, and a
  // crash here would fail the send rather than the generate.
  const shiftStart = shift.clockInAt ?? shift.scheduledStart;
  const filename = `${site.code}-${isoDateInZone(shiftStart, site.timezone)}-v${report.version}.pdf`;

  const pdfUrl = await storage().presignDownload(report.storageKey, 7 * 24 * 60 * 60);
  const galleryUrl = report.galleryToken
    ? `${baseUrl()}/g/${report.galleryToken}`
    : undefined;

  const incidents: ReportEmailIncident[] = shift.entries.flatMap((entry) =>
    entry.incident
      ? [
          {
            code: entry.incident.code,
            severity: entry.incident.severity,
            // The entry's own text is the incident's title; an incident has no
            // separate headline field, and inventing one here would put words
            // in the guard's mouth.
            title: firstLine(entry.text),
            at: formatClock(entry.occurredAt, site.timezone),
          },
        ]
      : [],
  );

  const coverage = await blindSpotCoverage(shift.id, site.id);

  const sizeSteps = Array.isArray(report.sizeSteps) ? report.sizeSteps : [];

  const buildMessage = (to: string, recipientName: string) =>
    reportEmail({
      to,
      recipientName,
      siteName: site.name,
      siteCode: site.code,
      shiftDate: formatDateTimeArchival(shiftStart, site.timezone),
      guardName: shift.guard.name ?? "the guard on duty",
      guardEmail: site.replyToGuard ? (shift.guard.email ?? undefined) : undefined,
      clockIn: formatClock(shift.clockInAt, site.timezone),
      clockOut: shift.clockOutAt
        ? formatClock(shift.clockOutAt, site.timezone)
        : "still open",
      entryCount: shift._count.entries,
      incidents,
      blindSpotsChecked: coverage.checked,
      blindSpotsTotal: coverage.total,
      pdfUrl,
      galleryUrl,
      ...(fits
        ? {}
        : {
            attachmentOmittedReason:
              "The PDF was too large to attach, so it is linked above rather than dropped. The link works for seven days; the report itself does not expire.",
          }),
      ...(sizeSteps.length > 1
        ? { sizeNote: "Images in this report were reduced to fit email limits." }
        : {}),
    });

  const attachmentField = () =>
    fits
      ? { attachments: [{ filename, content: pdf, contentType: "application/pdf" }] }
      : {};

  let sent = 0;
  let failed = 0;

  // One message with everyone in `to:`, when the site asks for it. This is not
  // the default and the tradeoff is real: the provider returns one message id
  // for the whole send, so all five rows share one delivery status. That is an
  // average across five mail servers rather than a delivery record, which is
  // why `sendIndividually` defaults to true. Some clients insist on seeing
  // each other on the thread, so the option exists and the cost is recorded.
  if (!site.sendIndividually && pending.length > 1) {
    const lead = pending[0];
    const leadRecipient = recipients.find((r) => r.id === lead.recipientId);
    try {
      const message = await buildMessage(lead.email, leadRecipient?.name ?? "");
      const result = await getEmailProvider().send({
        ...message,
        to: pending.map((d) => d.email).join(", "),
        tags: { deliveryId: lead.id, reportId },
        ...attachmentField(),
      });
      for (const delivery of pending) {
        await markDeliverySent(delivery.id, result.messageId);
        sent += 1;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const delivery of pending) {
        await markDeliveryFailed(delivery.id, reason);
        failed += 1;
      }
    }
  } else {
    for (const delivery of pending) {
      const recipient = recipients.find((r) => r.id === delivery.recipientId);
      try {
        const message = await buildMessage(delivery.email, recipient?.name ?? "");
        const result = await getEmailProvider().send({
          ...message,
          tags: { deliveryId: delivery.id, reportId },
          ...attachmentField(),
        });
        await markDeliverySent(delivery.id, result.messageId);
        sent += 1;
      } catch (error) {
        // One recipient failing must not abandon the rest. A bad address in
        // the middle of a list would otherwise silently stop the report
        // reaching everyone after it, alphabetically.
        await markDeliveryFailed(
          delivery.id,
          error instanceof Error ? error.message : String(error),
        );
        failed += 1;
      }
    }
  }

  if (sent > 0 && !report.sentAt) {
    await markReportSent(reportId);
  }

  await recordAudit({
    companyId: site.companyId,
    action: "report.sent",
    entityType: "Report",
    entityId: reportId,
    metadata: { sent, failed, attached: fits, bytes: pdf.byteLength },
  });

  return { reportId, result: "sent", sent, failed, attached: fits };
}

/**
 * The first line of an entry, for the incident table. Full text lives in the
 * PDF; an email that reproduces every word gives the reader no reason to open
 * the record the whole product exists to produce.
 */
function firstLine(text: string | null): string {
  const line = (text ?? "").split("\n")[0]?.trim() ?? "";
  if (!line) return "No description";
  return line.length > 90 ? `${line.slice(0, 89)}\u2026` : line;
}
