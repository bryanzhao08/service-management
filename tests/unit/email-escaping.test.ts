import { describe, expect, it } from "vitest";
import {
  magicLinkEmail,
  teamInviteEmail,
  verifyRecipientEmail,
} from "@/lib/email/templates";

/**
 * Names in these emails are typed by one person and rendered in another
 * person's mail client. An admin names their company, and the guard they
 * invite reads whatever that field held; a dispatcher names a site, and the
 * client's accounts person reads it. Mail clients strip `<script>`, but plenty
 * still render `<a href>`, which is enough to turn a Transient-branded email
 * into a phishing page without touching our servers.
 *
 * So the rule is field-specific, and both halves matter:
 *
 *   - `html` must be escaped, or the markup executes.
 *   - `text` and `subject` must NOT be, or the reader literally sees
 *     `&lt;b&gt;` in their inbox.
 *
 * Asserting only the first half is how you "fix" an injection by shipping
 * garbled plain text. Every case below checks both directions.
 */

/** Markup that survives in real mail clients, not just `<script>`. */
const HOSTILE = `<a href="https://evil.test">Reset</a>`;
const BENIGN = "Meridian Protective Services";

/**
 * Any HTML entity at all. `toContain(HOSTILE)` is too weak on its own: these
 * templates interpolate the same field more than once, so escaping one
 * occurrence still leaves another raw and the assertion passes. Measured, not
 * assumed — a control that escaped the plain-text body went green until this
 * was added.
 */
const ENTITY = /&(amp|lt|gt|quot|#39);/;

describe("email template escaping", () => {
  it("escapes a hostile company name in the invite HTML but not its text", () => {
    const mail = teamInviteEmail({
      to: "guard@example.test",
      name: "Terrence Boyd",
      companyName: HOSTILE,
      invitedBy: "Dana Whitfield",
      signInUrl: "https://app.test/sign-in",
    });

    expect(mail.html).not.toContain(HOSTILE);
    expect(mail.html).toContain("&lt;a href=&quot;https://evil.test&quot;&gt;");
    expect(mail.text).toContain(HOSTILE);
    expect(mail.text).not.toMatch(ENTITY);
    expect(mail.subject).toContain(HOSTILE);
    expect(mail.subject).not.toMatch(ENTITY);
  });

  it("escapes every name field of the recipient verification email", () => {
    const mail = verifyRecipientEmail({
      to: "ap@client.test",
      name: HOSTILE,
      siteName: HOSTILE,
      companyName: HOSTILE,
      url: "https://app.test/confirm/abc123",
    });

    // One assertion per field would pass while a sibling field leaked, so
    // check the rendered document as a whole: the raw string must not appear
    // anywhere in it, no matter which of the three put it there.
    expect(mail.html).not.toContain(HOSTILE);
    expect(mail.html).toContain("&lt;a href=");

    // ...and the same three fields must survive intact in plain text. The
    // entity check is what makes this cover all three: `toContain` alone is
    // satisfied by any one of them staying raw.
    expect(mail.text).toContain(HOSTILE);
    expect(mail.text).not.toMatch(ENTITY);
    expect(mail.subject).toContain(HOSTILE);
    expect(mail.subject).not.toMatch(ENTITY);
  });

  it("escapes the magic link query string so the href parses", () => {
    // NextAuth's callback URL carries `?token=..&email=..`. A bare `&` in
    // HTML is an unterminated entity, so this is a correctness fix as much as
    // a safety one — and the browser unescapes it again on navigation.
    const url = "https://app.test/api/auth/callback/email?token=t1&email=a@b.c";
    const mail = magicLinkEmail({
      to: "a@b.c",
      url,
      expiresInMinutes: 15,
    });

    expect(mail.html).toContain("&amp;email=");
    expect(mail.html).not.toContain("t1&email=");
    // The plain-text copy is what someone pastes into a browser by hand. An
    // escaped URL there is a broken URL.
    expect(mail.text).toContain(url);
    expect(mail.text).not.toMatch(ENTITY);
  });

  it("leaves an ordinary name alone", () => {
    // Control. Every assertion above is satisfied by a template that deletes
    // its inputs entirely, so prove a real company name still renders.
    const mail = teamInviteEmail({
      to: "guard@example.test",
      name: "Terrence Boyd",
      companyName: BENIGN,
      invitedBy: "Dana Whitfield",
      signInUrl: "https://app.test/sign-in",
    });

    expect(mail.html).toContain(BENIGN);
    expect(mail.html).toContain("Terrence Boyd");
    expect(mail.text).toContain(BENIGN);
  });

  it("would catch an unescaped field", () => {
    // Control on the control: proves HOSTILE is actually a string these
    // assertions can detect, so a typo in the constant cannot make the whole
    // suite vacuously green.
    expect(HOSTILE).toContain("<a href=");
    expect(HOSTILE).not.toContain("&lt;");
  });
});
