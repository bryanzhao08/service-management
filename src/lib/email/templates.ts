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

/**
 * HTML-escapes a value before it goes into an email body.
 *
 * Names here are typed by one customer and read by another: an admin invites a
 * guard, and the guard's client renders whatever the admin's `name` field held.
 * Mail clients drop `<script>`, but an `<a href>` survives in plenty of them,
 * which turns a Transient-branded email into a phishing vehicle without ever
 * touching our servers.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
  // The callback URL carries a query string, so a bare `&` in HTML is an
  // unterminated entity rather than a separator. Escaping is what makes the
  // href parse; the browser unescapes it again on navigation. `text` below
  // keeps the raw URL, because a mail client shows that verbatim.
  // `nativeUrl` needs no escaping: nativeSignInLink() runs the callback
  // through encodeURIComponent, which encodes &, ", < and >.
  const htmlUrl = escapeHtml(url);

  const html = shell(
    "Sign in to Transient",
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Tap the button below to sign in. The link works once and expires in
       ${expiresInMinutes} minutes.
     </p>
     <p style="margin:0 0 24px;">
       <a href="${htmlUrl}"
          style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Sign in
       </a>
     </p>
     ${nativeUrl ? `<p style="margin:0 0 24px;"><a href="${nativeUrl}" style="color:${ACCENT};">Open in the iPhone / Android app</a></p>` : ""}
     <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">
       If the button does not work, paste this into your browser:
     </p>
     <p style="margin:0 0 24px;font-size:13px;word-break:break-all;opacity:0.7;">${htmlUrl}</p>
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
  const name = escapeHtml(params.name);
  const siteName = escapeHtml(params.siteName);
  const companyName = escapeHtml(params.companyName);
  const { to, url } = params;
  const htmlUrl = escapeHtml(url);

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
       <a href="${htmlUrl}"
          style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Confirm I receive these reports
       </a>
     </p>
     <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">
       If the button does not work, paste this into your browser:
     </p>
     <p style="margin:0 0 24px;font-size:13px;word-break:break-all;opacity:0.7;">${htmlUrl}</p>
     <p style="margin:0;font-size:13px;opacity:0.7;">
       If you should not be receiving these, ignore this email and tell
       ${companyName} to take you off the list. We will keep showing them this
       address as unconfirmed until someone does.
     </p>`,
  );

  const text = [
    "Do you receive shift reports?",
    "",
    `Hi ${params.name}, ${params.companyName} uses Transient to send the nightly security report`,
    `for ${params.siteName}, and they have listed this address as somewhere it should go.`,
    "",
    "One tap confirms the address works. That is all it does. It does not create",
    "an account and it does not sign you up for anything else.",
    "",
    url,
    "",
    `If you should not be receiving these, ignore this email and tell ${params.companyName}`,
    "to take you off the list.",
  ].join("\n");

  return {
    to,
    subject: `Confirm you receive ${params.siteName} shift reports`,
    html,
    text,
  };
}

/**
 * "You have been added to Transient."
 *
 * Carries no credential, and that is the point. A live sign-in link inside an
 * invite means a mistyped address is an account, silently: the admin sees the
 * invite as sent, the real guard never gets one, and whoever owns the typo
 * holds a working session. So this email only says an account exists and
 * points at `/sign-in`, where the recipient has to prove control of the
 * mailbox through the magic-link flow that is already hardened for it.
 *
 * It costs the guard one extra step. It buys the property that possession of
 * this email grants nothing at all.
 */
export function teamInviteEmail(params: {
  to: string;
  name: string;
  companyName: string;
  invitedBy: string;
  signInUrl: string;
}): EmailMessage {
  const name = escapeHtml(params.name);
  const companyName = escapeHtml(params.companyName);
  const invitedBy = escapeHtml(params.invitedBy);
  const { to, signInUrl } = params;

  const html = shell(
    "You have been added to Transient",
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Hi ${name}, ${invitedBy} added you to <strong>${companyName}</strong> on
       Transient, the app your team uses to log shifts and send the report at
       the end of one.
     </p>
     <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Sign in with this email address and we will send you a link. After that
       you pick a PIN on your phone, and from then on it is your email and six
       digits. There is no password to remember.
     </p>
     <p style="margin:0 0 24px;">
       <a href="${signInUrl}"
          style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Sign in to Transient
       </a>
     </p>
     <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">
       If the button does not work, paste this into your browser:
     </p>
     <p style="margin:0 0 24px;font-size:13px;word-break:break-all;opacity:0.7;">${signInUrl}</p>
     <p style="margin:0;font-size:13px;opacity:0.7;">
       This email does not sign you in on its own. If you were not expecting
       it, ignore it and tell ${invitedBy} they used the wrong address.
     </p>`,
  );

  const text = [
    "You have been added to Transient",
    "",
    `Hi ${params.name}, ${params.invitedBy} added you to ${params.companyName} on`,
    "Transient, the app your team uses to log shifts and send the report at the",
    "end of one.",
    "",
    "Sign in with this email address and we will send you a link. After that you",
    "pick a PIN on your phone, and from then on it is your email and six digits.",
    "",
    signInUrl,
    "",
    "This email does not sign you in on its own. If you were not expecting it,",
    "ignore it.",
  ].join("\n");

  return {
    to,
    subject: `${params.invitedBy} added you to ${params.companyName} on Transient`,
    html,
    text,
  };
}

/**
 * "Confirm your email and we will set the company up."
 *
 * Unlike every other email here, nothing exists yet when this is sent: no
 * company, no user, no site. The link carries a signed payload and creating
 * the account is what clicking it does. That is deliberate — verifying after
 * creation would let anyone squat a company name with an address they do not
 * own, and would leave a tenant behind every typo'd sign-up.
 */
export function signUpVerifyEmail(params: {
  to: string;
  name: string;
  companyName: string;
  url: string;
  trialDays: number;
}): EmailMessage {
  const name = escapeHtml(params.name);
  const companyName = escapeHtml(params.companyName);
  const { to, url, trialDays } = params;
  const htmlUrl = escapeHtml(url);

  const html = shell(
    "Confirm your email",
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Hi ${name}, you started setting up <strong>${companyName}</strong> on
       Transient. Confirm this address and we will create the account and sign
       you in.
     </p>
     <p style="margin:0 0 24px;">
       <a href="${htmlUrl}"
          style="display:inline-block;background:${ACCENT};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Confirm and start ${trialDays} days free
       </a>
     </p>
     <p style="margin:0 0 8px;font-size:13px;opacity:0.7;">
       If the button does not work, paste this into your browser:
     </p>
     <p style="margin:0 0 24px;font-size:13px;word-break:break-all;opacity:0.7;">${htmlUrl}</p>
     <p style="margin:0;font-size:13px;opacity:0.7;">
       No card, and nothing is created until you tap. If you did not start
       this, ignore the email and nothing happens.
     </p>`,
  );

  const text = [
    "Confirm your email",
    "",
    `Hi ${params.name}, you started setting up ${params.companyName} on Transient.`,
    "Confirm this address and we will create the account and sign you in.",
    "",
    url,
    "",
    `No card, and the ${trialDays}-day trial starts when you tap. If you did not`,
    "start this, ignore the email and nothing happens.",
  ].join("\n");

  return {
    to,
    subject: `Confirm your email to finish setting up ${params.companyName}`,
    html,
    text,
  };
}
