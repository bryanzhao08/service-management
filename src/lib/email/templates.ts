import type { EmailMessage } from "./provider";

/**
 * Plain HTML, inline styles, table-free. Mail clients are not browsers: no
 * external stylesheet, no web font, no CSS variable survives Outlook, so the
 * design tokens are hardcoded here as literals on purpose. This is the one
 * place in the codebase allowed to write a hex value directly, and the values
 * are copied from the `@theme` block in `globals.css`.
 */
const INK = "#030701";
const CREAM = "#f7ffd7";
const LIME = "#76d337";

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
}): EmailMessage {
  const { to, url, expiresInMinutes } = params;

  const html = shell(
    "Sign in to Transient",
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
       Tap the button below to sign in. The link works once and expires in
       ${expiresInMinutes} minutes.
     </p>
     <p style="margin:0 0 24px;">
       <a href="${url}"
          style="display:inline-block;background:${LIME};color:${INK};text-decoration:none;font-weight:700;font-size:16px;padding:16px 24px;border-radius:12px;">
         Sign in
       </a>
     </p>
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
    "",
    "If you did not ask to sign in, you can ignore this email.",
  ].join("\n");

  return { to, subject: "Your Transient sign-in link", html, text };
}
