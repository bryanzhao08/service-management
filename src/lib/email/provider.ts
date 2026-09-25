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
  /** Correlates a send with its `ReportDelivery` row once m7 wires webhooks. */
  tags?: Record<string, string>;
};

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
    await mkdir(OUTBOX_DIR, { recursive: true });

    const stem = path.join(OUTBOX_DIR, messageId);
    await Promise.all([
      writeFile(`${stem}.html`, message.html, "utf8"),
      writeFile(
        `${stem}.json`,
        JSON.stringify(
          { messageId, sentAt: new Date().toISOString(), ...message },
          null,
          2,
        ),
        "utf8",
      ),
    ]);

    if (process.env.NODE_ENV !== "test") {
      console.info(
        `[email] ${message.subject} -> ${message.to}  (${stem}.html)`,
      );
    }

    return { messageId, provider: "console" };
  }
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  cached ??= new ConsoleEmailProvider();
  return cached;
}

/** Test seam: lets a unit test install a fake without touching the filesystem. */
export function setEmailProvider(provider: EmailProvider | undefined): void {
  cached = provider;
}
