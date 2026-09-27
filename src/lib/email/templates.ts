import type { EmailMessage } from "./provider";

/**
 * Plain HTML, inline styles, table-free. Mail clients are not browsers: no
 * external stylesheet, no web font, no CSS variable survives Outlook, so the
 * design tokens are hardcoded here as literals on purpose. This is the one
 * place in the codebase allowed to write a hex value directly, and the values
 * are copied from the `@theme` block in `globals.css`.
 */
export const INK = "#000000";
export const CREAM = "#ffffff";
export const ACCENT = "#e8a2b9";
/** Muted body text. Contrast-checked against INK, not eyeballed. */
// Must stay equal to `--color-ash` in globals.css. Email clients cannot read
// custom properties, so this literal is a hand-maintained copy and
// tests/unit/email-palette.test.ts is the only thing keeping the two in step.
export const MUTED = "#bcb5b8";

/** `--color-charcoal`. Surfaces and hairline dividers on the dark canvas. */
export const BARK = "#171315";

/** `--color-rose`. Attention: a graded incident the client should read. */
export const EMBER = "#e8a2b9";

/** `--color-blush`. The worst states the product has: HIGH severity, bounced. */
export const COPPER = "#f3bdcd";

function shell(heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:24px;background:${INK};color:${CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">
        Transient
      </p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;">${heading}</h1>
      ${body}
    </div>
  </body>
</html>`;
}

export function magicLinkEmail(params: {
  to: string;
  url: string;
  expiresInMinutes: number;
  nativeUrl?: string;
}): EmailMessage {
  const { to, url, expiresInMinutes, nativeUrl } = params;

  const html = shell(
    "Sign in to Transient",
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Tap the button below to sign in. The link works once and expires in
       ${expiresInMinutes} minutes.
     </p>
     <p style="margin:0 0 24px;">
       <a href="${url}"
          style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Sign in
       </a>
     </p>
     ${nativeUrl ? `<p style="margin:0 0 24px;"><a href="${nativeUrl}" style="color:${ACCENT};">Open in the iPhone / Android app</a></p>` : ""}
     <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">
       If the button does not work, paste this into your browser:
     </p>
     <p style="margin:0 0 24px;font-size:13px;word-break:break-all;opacity:0.7;">${url}</p>
     <p style="margin:0;font-size:13px;opacity:0.7;">
       If you did not ask to sign in, you can ignore this email.
     </p>`,
  );

  const text = [
    "Sign in to Transient",
    "",
    `This link works once and expires in ${expiresInMinutes} minutes.`,
    "",
    url,
    ...(nativeUrl ? ["", "Open in the iPhone / Android app:", nativeUrl] : []),
    "",
    "If you did not ask to sign in, you can ignore this email.",
  ].join("\n");

  return { to, subject: "Your Transient sign-in link", html, text };
}

/**
 * "Confirm you receive Transient reports."
 *
 * Sent to someone who has no account and did not ask for this: a duty manager
 * at a hotel whose security vendor just added them to a report list. So the
 * email says who added them and for which site before it asks for anything,
 * and the ignore-path is spelled out. An unexplained "confirm your email"
 * from a brand they have never heard of is indistinguishable from phishing,
 * and the one thing worse than an unverified recipient is a recipient who
 * reports us as a phisher.
 */
export function verifyRecipientEmail(params: {
  to: string;
  name: string;
  siteName: string;
  companyName: string;
  url: string;
}): EmailMessage {
  const { to, name, siteName, companyName, url } = params;

  const html = shell(
    "Do you receive shift reports?",
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Hi ${name}, ${companyName} uses Transient to send the nightly security
       report for <strong>${siteName}</strong>, and they have listed this
       address as somewhere it should go.
     </p>
     <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       One tap confirms the address works. That is all it does. It does not
       create an account and it does not sign you up for anything else.
     </p>
     <p style="margin:0 0 24px;">
       <a href="${url}"
          style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Confirm I receive these reports
       </a>
     </p>
     <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">
       If the button does not work, paste this into your browser:
     </p>
     <p style="margin:0 0 24px;font-size:13px;word-break:break-all;opacity:0.7;">${url}</p>
     <p style="margin:0;font-size:13px;opacity:0.7;">
       If you should not be receiving these, ignore this email and tell
       ${companyName} to take you off the list. We will keep showing them this
       address as unconfirmed until someone does.
     </p>`,
  );

  const text = [
    "Do you receive shift reports?",
    "",
    `Hi ${name}, ${companyName} uses Transient to send the nightly security report`,
    `for ${siteName}, and they have listed this address as somewhere it should go.`,
    "",
    "One tap confirms the address works. That is all it does. It does not create",
    "an account and it does not sign you up for anything else.",
    "",
    url,
    "",
    `If you should not be receiving these, ignore this email and tell ${companyName}`,
    "to take you off the list.",
  ].join("\n");

  return {
    to,
    subject: `Confirm you receive ${siteName} shift reports`,
    html,
    text,
  };
}
