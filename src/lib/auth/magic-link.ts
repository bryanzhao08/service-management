import { findSignInUserByEmail } from "@/lib/db/auth-adapter";
import { getEmailProvider } from "@/lib/email/provider";
import { magicLinkEmail } from "@/lib/email/templates";
import { MAGIC_LINK_MAX_AGE_SECONDS } from "./config";

/**
 * Decides whether to send a magic link, and absorbs the outcome either way.
 *
 * Its own module rather than an inline closure in `index.ts` so it can be
 * tested without constructing `NextAuth()` and a database adapter.
 *
 * The contract is narrow and load-bearing: **nothing a caller can observe may
 * depend on whether the address belongs to an account.** Transient has no
 * self-registration, so the set of real addresses is exactly the customer's
 * staff list, and leaking it hands an attacker a target list.
 */
export async function deliverMagicLink({
  identifier,
  url,
}: {
  identifier: string;
  url: string;
}): Promise<void> {
  const user = await findSignInUserByEmail(identifier);
  if (!user) {
    console.info(`[auth] sign-in requested for unknown address, not sending`);
    return;
  }

  try {
    await getEmailProvider().send(
      magicLinkEmail({
        to: identifier,
        url,
        expiresInMinutes: Math.round(MAGIC_LINK_MAX_AGE_SECONDS / 60),
      }),
    );
  } catch (cause) {
    // Auth.js turns a throw here into `?error=Configuration` on the sign-in
    // page, while an unknown address redirects to `verify-request`. That
    // difference is an account-enumeration oracle, and it is *most* reliable
    // exactly when someone is attacking it: an unknown address returns above
    // without ever reaching the provider, so a suppressed recipient, a hard
    // bounce, or a send-rate limit can only ever produce an error for an
    // address that genuinely exists.
    //
    // Measured on production before this fix, with a sandbox sender that only
    // delivers to the account owner: three known addresses redirected to
    // `?error=Configuration` and two unknown ones to `verify-request`.
    //
    // Swallowing it costs the operator a signal, so the cause is logged rather
    // than dropped. The user is told to check their email and nothing arrives,
    // which is the same trade this file already makes for unknown addresses.
    console.error(
      "[auth] magic-link delivery failed; the sign-in response is left unchanged " +
        "so it cannot reveal whether the account exists. Cause: " +
        (cause instanceof Error ? cause.message : String(cause)),
    );
  }
}
