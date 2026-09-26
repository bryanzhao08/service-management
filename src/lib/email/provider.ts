import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Email transport. Section 23 requires the app to run with no third-party
 * account, so the provider is an interface with a local implementation rather
 * than a direct Resend call. Milestone 7 adds the Resend implementation and
 * webhook handling behind this same shape.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Correlates a send with its `ReportDelivery` row. Read back off webhooks. */
  tags?: Record<string, string>;
  attachments?: EmailAttachment[];
};

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

/**
 * Hard ceiling on a single message.
 *
 * Resend rejects above 40MB and most corporate gateways bounce well before
 * that, so the report renderer targets 8MB and this is the backstop that keeps
 * an oversized attachment from turning into a silent provider error. Over the
 * cap we send the email with a link instead of dropping the email.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export type SendResult = {
  /** Provider message id. The receipt shows this, so it is never synthesised. */
  messageId: string;
  provider: "console" | "resend";
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<SendResult>;
}

export const OUTBOX_DIR = path.join(process.cwd(), ".data", "outbox");

/**
 * Writes messages to `.data/outbox/` instead of sending them. Two consumers:
 * a developer opening the `.html` to read what a guard would see, and the
 * Playwright suite reading the `.json` to pull a magic-link URL out of it.
 *
 * The pair is deliberate — the `.html` is for eyes, the `.json` is the only
 * thing a test should parse, because scraping a link out of rendered HTML
 * breaks the moment the template changes.
 */
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<SendResult> {
    const messageId = `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const stem = path.join(OUTBOX_DIR, messageId);
    // Attachments are summarised, never serialised. `...message` would put an
    // 8MB PDF buffer through JSON.stringify and write a useless megabyte-scale
    // file that no test can read and no human can open.
    const { attachments, ...rest } = message;
    const summary = {
      messageId,
      sentAt: new Date().toISOString(),
      ...rest,
      attachments: (attachments ?? []).map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        bytes: a.content.byteLength,
      })),
    };

    try {
      await mkdir(OUTBOX_DIR, { recursive: true });
      await Promise.all([
        writeFile(`${stem}.html`, message.html, "utf8"),
        writeFile(`${stem}.json`, JSON.stringify(summary, null, 2), "utf8"),
      ]);

      if (process.env.NODE_ENV !== "test") {
        console.info(`[email] ${message.subject} -> ${message.to}  (${stem}.html)`);
      }
    } catch (error) {
      // Serverless filesystems are read-only, so the outbox write throws EROFS.
      // Letting that propagate would take the caller down with it, and the
      // caller is sign-in: a deployment with no RESEND_API_KEY would answer
      // every magic-link request with a 500 and never tell anyone why. The
      // outbox is an inspection aid, not the delivery mechanism, so degrade to
      // the log — which on a serverless host is the only readable surface
      // anyway — and let the send succeed.
      const code = (error as NodeJS.ErrnoException).code ?? "unknown";
      console.error(
        `[email] outbox write failed (${code}); this deployment has no RESEND_API_KEY, ` +
          `so nothing is being delivered. Set one to send real mail.`,
      );
      console.info(`[email] ${JSON.stringify(summary)}`);
    }

    return { messageId, provider: "console" };
  }
}

/**
 * Resend. Only constructed when a key exists, so importing this module in a
 * test or a keyless dev environment never reaches for the network.
 *
 * Tags carry the `ReportDelivery` id. That is the whole reason webhooks can be
 * matched back to a row without trusting the recipient address, which is not
 * unique across reports and changes when someone fixes a typo.
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const { Resend } = await import("resend");
    const client = new Resend(this.apiKey);

    const { data, error } = await client.emails.send({
      from: process.env.EMAIL_FROM ?? "Transient <reports@transient.app>",
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.tags
        ? {
            tags: Object.entries(message.tags).map(([name, value]) => ({
              name,
              value,
            })),
          }
        : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            })),
          }
        : {}),
    });

    // Resend reports failure in the body rather than by throwing, so a caller
    // that only catches exceptions would record a send that never happened and
    // then wait forever for a webhook that is never coming.
    if (error) throw new Error(`resend: ${error.name}: ${error.message}`);
    if (!data?.id) throw new Error("resend: send returned no message id");

    return { messageId: data.id, provider: "resend" };
  }
}

let cached: EmailProvider | undefined;

/**
 * Resend when a key is configured, the outbox otherwise.
 *
 * The fallback is not a convenience. Section 23 requires the whole app to run
 * with no third-party account, so a missing key has to be an ordinary
 * supported mode rather than a crash on the first report of the night.
 */
export function getEmailProvider(): EmailProvider {
  if (!cached) {
    const key = process.env.RESEND_API_KEY;
    cached = key ? new ResendEmailProvider(key) : new ConsoleEmailProvider();
  }
  return cached;
}

/** True when sends are local-only, so callers can simulate delivery webhooks. */
export function isConsoleEmail(): boolean {
  return !process.env.RESEND_API_KEY;
}

/** Test seam: lets a unit test install a fake without touching the filesystem. */
export function setEmailProvider(provider: EmailProvider | undefined): void {
  cached = provider;
}
