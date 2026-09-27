import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
  render,
} from "@react-email/components";

import type { Severity } from "@/generated/prisma/enums";

import type { EmailMessage } from "./provider";
import { BARK, COPPER, CREAM, EMBER, INK, ACCENT, MUTED } from "./templates";

/**
 * The report email (section 12).
 *
 * Built with `@react-email/components` rather than the hand-rolled `shell()`
 * in `templates.ts` because this one has real structure -- an incident table
 * that has to survive Outlook, two buttons, a conditional disclaimer -- and
 * hand-writing nested tables for that is how mail rendering bugs happen. The
 * colour literals are imported from `templates.ts` so the two systems cannot
 * drift into two different-looking Transient emails.
 *
 * One rule governs the copy: this email is read by a client who was asleep
 * while the work happened. It leads with what was found, not with how the
 * software feels about it.
 */

export type ReportEmailIncident = {
  code: string;
  severity: Severity | null;
  title: string;
  at: string;
};

export type ReportEmailParams = {
  to: string;
  recipientName: string;
  siteName: string;
  siteCode: string;
  shiftDate: string;
  guardName: string;
  guardEmail?: string;
  clockIn: string;
  clockOut: string;
  entryCount: number;
  incidents: ReportEmailIncident[];
  blindSpotsChecked: number;
  blindSpotsTotal: number;
  pdfUrl: string;
  galleryUrl?: string;
  /** Set when the PDF was linked rather than attached, so the body says why. */
  attachmentOmittedReason?: string;
  /** Rendered in the footer when the size budget had to degrade images. */
  sizeNote?: string;
};

/**
 * Only three levels exist in the schema, and an incident is allowed to carry
 * none at all -- a guard writing at 3am should not be blocked on grading their
 * own event. `null` renders in the same muted tone as LOW rather than being
 * dropped, because an ungraded incident is still an incident.
 */
const SEVERITY_COLOR: Record<Severity, string> = {
  LOW: MUTED,
  MEDIUM: EMBER,
  HIGH: COPPER,
};

function severityColor(severity: Severity | null): string {
  return severity ? SEVERITY_COLOR[severity] : MUTED;
}

export function reportSubject(params: {
  siteCode: string;
  shiftDate: string;
  guardName: string;
  incidentCount: number;
}): string {
  const { siteCode, shiftDate, guardName, incidentCount } = params;
  const noun = incidentCount === 1 ? "incident" : "incidents";
  return `[${siteCode}] Shift report ${shiftDate} — ${guardName} — ${incidentCount} ${noun}`;
}

function ReportEmail(params: ReportEmailParams) {
  const {
    recipientName,
    siteName,
    shiftDate,
    guardName,
    clockIn,
    clockOut,
    entryCount,
    incidents,
    blindSpotsChecked,
    blindSpotsTotal,
    pdfUrl,
    galleryUrl,
    attachmentOmittedReason,
    sizeNote,
  } = params;

  const headline =
    incidents.length === 0
      ? `Nothing to report at ${siteName}`
      : `${incidents.length} ${incidents.length === 1 ? "incident" : "incidents"} at ${siteName}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${headline} — ${shiftDate}, ${clockIn} to ${clockOut}`}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "24px",
          background: INK,
          color: CREAM,
          fontFamily:
            "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto" }}>
          <Text
            style={{
              margin: "0 0 24px",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Transient
          </Text>

          <Text
            style={{
              margin: "0 0 4px",
              fontSize: "24px",
              lineHeight: 1.25,
              fontWeight: 700,
            }}
          >
            {headline}
          </Text>
          <Text style={{ margin: "0 0 24px", fontSize: "15px", color: MUTED }}>
            {shiftDate} · {clockIn} to {clockOut} · {guardName}
          </Text>

          <Text style={{ margin: "0 0 16px", fontSize: "15px", lineHeight: 1.5 }}>
            {recipientName ? `${recipientName}, ` : ""}
            {entryCount} {entryCount === 1 ? "entry" : "entries"} logged.{" "}
            {blindSpotsTotal > 0
              ? `${blindSpotsChecked} of ${blindSpotsTotal} blind spots checked.`
              : "No blind-spot checks configured for this site."}
          </Text>

          {incidents.length > 0 ? (
            <Section style={{ margin: "0 0 24px" }}>
              {incidents.map((incident) => (
                <Row key={incident.code} style={{ marginBottom: "8px" }}>
                  <Column style={{ width: "96px", verticalAlign: "top" }}>
                    <Text
                      style={{
                        margin: 0,
                        fontSize: "13px",
                        fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
                        color: severityColor(incident.severity),
                      }}
                    >
                      {incident.code}
                    </Text>
                  </Column>
                  <Column style={{ verticalAlign: "top" }}>
                    <Text style={{ margin: 0, fontSize: "14px", lineHeight: 1.4 }}>
                      {incident.title}
                    </Text>
                    <Text style={{ margin: "2px 0 0", fontSize: "12px", color: MUTED }}>
                      {incident.severity ?? "ungraded"} · {incident.at}
                    </Text>
                  </Column>
                </Row>
              ))}
            </Section>
          ) : null}

          <Section style={{ margin: "0 0 24px" }}>
            <Button
              href={pdfUrl}
              style={{
                display: "inline-block",
                background: ACCENT,
                color: INK,
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "15px",
                padding: "14px 22px",
                borderRadius: "12px",
                marginRight: "8px",
              }}
            >
              Open PDF
            </Button>
            {galleryUrl ? (
              <Button
                href={galleryUrl}
                style={{
                  display: "inline-block",
                  border: `1px solid ${MUTED}`,
                  color: CREAM,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: "15px",
                  padding: "13px 21px",
                  borderRadius: "12px",
                }}
              >
                Open gallery
              </Button>
            ) : null}
          </Section>

          {attachmentOmittedReason ? (
            <Text style={{ margin: "0 0 16px", fontSize: "13px", color: MUTED }}>
              {attachmentOmittedReason}
            </Text>
          ) : null}

          <Hr style={{ borderColor: BARK, margin: "24px 0 16px" }} />

          {sizeNote ? (
            <Text style={{ margin: "0 0 8px", fontSize: "12px", color: MUTED }}>
              {sizeNote}
            </Text>
          ) : null}

          {/* The disclaimer section 12 requires. It is deliberately specific
              about what we can and cannot see: claiming to know an email was
              read would be a lie, and this product is sold on not lying about
              delivery. */}
          <Text style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: MUTED }}>
            Delivery of this message is tracked. The sender can see whether it reached
            your mail server and whether it bounced. They cannot see whether it was
            opened or read. If this address is wrong, reply and say so: a bounce here
            means the next report goes nowhere too.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function plainText(params: ReportEmailParams): string {
  const lines = [
    `${params.siteName} — shift report`,
    `${params.shiftDate} · ${params.clockIn} to ${params.clockOut} · ${params.guardName}`,
    "",
    `${params.entryCount} ${params.entryCount === 1 ? "entry" : "entries"} logged.`,
  ];

  if (params.blindSpotsTotal > 0) {
    lines.push(
      `${params.blindSpotsChecked} of ${params.blindSpotsTotal} blind spots checked.`,
    );
  }

  lines.push("");
  if (params.incidents.length === 0) {
    lines.push("No incidents.");
  } else {
    lines.push(`Incidents (${params.incidents.length}):`);
    for (const incident of params.incidents) {
      lines.push(
        `  ${incident.code}  ${incident.severity ?? "ungraded"}  ${incident.at}  ${incident.title}`,
      );
    }
  }

  lines.push("", `PDF: ${params.pdfUrl}`);
  if (params.galleryUrl) lines.push(`Gallery: ${params.galleryUrl}`);
  if (params.attachmentOmittedReason) lines.push("", params.attachmentOmittedReason);
  if (params.sizeNote) lines.push("", params.sizeNote);

  lines.push(
    "",
    "Delivery of this message is tracked: the sender can see whether it reached",
    "your mail server and whether it bounced, but not whether it was opened.",
  );

  return lines.join("\n");
}

export async function reportEmail(
  params: ReportEmailParams,
): Promise<Omit<EmailMessage, "attachments">> {
  const html = await render(<ReportEmail {...params} />);
  return {
    to: params.to,
    subject: reportSubject({
      siteCode: params.siteCode,
      shiftDate: params.shiftDate,
      guardName: params.guardName,
      incidentCount: params.incidents.length,
    }),
    html,
    text: plainText(params),
    ...(params.guardEmail ? { replyTo: params.guardEmail } : {}),
  };
}
