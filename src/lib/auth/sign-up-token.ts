import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The sign-up link.
 *
 * Sign-up has a shape the rest of the app does not: the person filling in the
 * form has no account, no company and no row anywhere, so there is nothing to
 * hang a database token off the way `Recipient.verifyToken` does. The choices
 * are a new `PendingSignup` table or a signed, stateless token, and this is the
 * latter.
 *
 * `lib/db/recipients.ts` argues for stored tokens over signed ones, because a
 * stored token gets revocation for free. That reasoning holds there and does
 * not transfer here: a recipient row already exists and may need its access
 * withdrawn, whereas this token grants nothing until it is clicked and creates
 * the very thing it would revoke. There is no prior state to protect.
 *
 * What the signature has to do, then, is narrow:
 *
 *   - Prove we generated the payload, so nobody mints themselves a company by
 *     editing a query string.
 *   - Prove the address received the email, which is the whole point of
 *     verifying before creating rather than after.
 *   - Expire, so a link forwarded months later does not still work.
 *
 * Replay is handled downstream rather than here: `User.email` is `@unique`, so
 * a second click cannot produce a second company, and `createCompanyFromSignUp`
 * checks for the existing account first and signs the person in instead.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * What a new company tells us about itself.
 *
 * Deliberately five fields. Every one of them is something the product cannot
 * invent: a site with no address renders a report header that does not say
 * where the shift happened, and a wrong timezone silently files a 11pm entry
 * on the wrong day, which is the one thing an overnight security log must
 * never get wrong. The timezone is detected in the browser rather than asked
 * for, so the form shows four inputs.
 */
export const signUpSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "Enter your company name")
    .max(120, "That company name is too long"),
  name: z
    .string()
    .trim()
    .min(2, "Enter your name")
    .max(120, "That name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid work email address"),
  siteName: z
    .string()
    .trim()
    .min(2, "Enter the name of a site you cover")
    .max(120, "That site name is too long"),
  siteAddress: z
    .string()
    .trim()
    .min(4, "Enter the site address")
    .max(240, "That address is too long"),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    // Rejecting an unknown zone rather than storing it: Prisma would take any
    // string, and the failure would surface weeks later as entries filed on
    // the wrong day.
    .refine(isKnownTimezone, "Unrecognised timezone")
    .catch("America/Los_Angeles"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function secret(): string {
  const value = process.env["AUTH_SECRET"];
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare sizes first and still run the constant-time compare.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** `payload.signature`, safe to put in an email link. */
export function createSignUpToken(
  input: SignUpInput,
  now = Date.now(),
): string {
  const body = JSON.stringify({ ...input, exp: now + TTL_MS });
  const payload = Buffer.from(body, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * The payload, or null for anything at all wrong with the token.
 *
 * One return value for a forged signature, a corrupt payload, an expired link
 * and a shape that no longer parses. The caller renders the same "that link
 * did not work" either way, because telling them which would confirm that a
 * given payload was once real.
 */
export function readSignUpToken(
  token: string,
  now = Date.now(),
): SignUpInput | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(payload))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const withExp = z.object({ exp: z.number() }).safeParse(parsed);
  if (!withExp.success || withExp.data.exp <= now) return null;

  const input = signUpSchema.safeParse(parsed);
  return input.success ? input.data : null;
}
