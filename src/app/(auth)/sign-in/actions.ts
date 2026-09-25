"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/lib/auth";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address");

export type SignInState = { error: string | null };

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
