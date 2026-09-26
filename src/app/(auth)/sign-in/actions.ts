"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { pinSignInSchema } from "@/lib/auth/pin-sign-in";
import { safeRedirect } from "@/lib/auth/safe-redirect";
import { grantUnlock } from "@/lib/auth/unlock";
import { findSignInUserByEmail } from "@/lib/db/auth-adapter";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

export type SignInState = { error: string | null };

/**
 * Same wording for a bad address, a wrong PIN, an account with no PIN set, and
 * a locked-out account. Saying which would turn this form into a way to find
 * out who works here, and into a way to tell a real address from a guess.
 */
const PIN_SIGN_IN_ERROR = "That email and PIN did not match. Try again.";

/**
 * Email + PIN sign-in. Only reachable when `PIN_SIGN_IN_ENABLED` is "1", since
 * the provider is not registered otherwise and `signIn` then throws.
 *
 * Every failure returns the one message above. The redirect sits outside the
 * try because `redirect()` works by throwing, so catching it here would
 * swallow the navigation.
 */
export async function signInWithPin(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = pinSignInSchema.safeParse({
    email: formData.get("email"),
    pin: formData.get("pin"),
  });
  if (!parsed.success) return { error: PIN_SIGN_IN_ERROR };

  const redirectTo = safeRedirect(formData.get("from"));

  try {
    await signIn("pin", {
      email: parsed.data.email,
      pin: parsed.data.pin,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: PIN_SIGN_IN_ERROR };
    throw error;
  }

  // Reaching here means the PIN was correct, so the device-unlock gate in
  // `requireUnlockedActor` has already been satisfied by this very form.
  // Without this the user signs in with their PIN and is immediately bounced
  // to /pin to type the same PIN again. Measured, not assumed: the probe
  // landed on /pin holding a valid session cookie.
  //
  // This grants no authority the PIN did not already carry — `grantUnlock`
  // only attests that this user entered the right PIN, and the session cookie
  // is still what authenticates every request.
  const user = await findSignInUserByEmail(parsed.data.email);
  if (user) await grantUnlock(user.id);

  redirect(redirectTo);
}

/**
 * Sends the magic link.
 *
 * The response is deliberately the same whether or not the address belongs to
 * an account: `sendVerificationRequest` returns quietly for an unknown one, and
 * the redirect below is unconditional. Anything else turns this form into a way
 * to find out who works here.
 *
 * `redirect: false` is load-bearing. Left on, next-auth redirects to its own
 * `/api/auth/verify-request`, which only 302s on to `pages.verifyRequest` for a
 * document navigation — a server action navigates client-side, so the browser
 * stopped on the API URL. Taking the redirect here also means the destination
 * cannot vary with whether the address was known.
 */
export async function requestMagicLink(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address" };
  }

  const rawFrom = formData.get("from");
  const from = typeof rawFrom === "string" ? rawFrom : "";
  // Only a same-site path is ever accepted. `//evil.test` and `https://evil.test`
  // are both rejected here rather than being handed to a redirect.
  const redirectTo =
    from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard";

  try {
    await signIn("magic-link", {
      email: parsed.data,
      redirectTo,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Could not send the link. Try again in a moment." };
    }
    throw error;
  }

  redirect("/verify");
}
