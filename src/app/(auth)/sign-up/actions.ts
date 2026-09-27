"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { createSignUpToken, signUpSchema } from "@/lib/auth/sign-up-token";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { trialPlanId } from "@/lib/db/sign-up";
import { getEmailProvider } from "@/lib/email/provider";
import { signUpVerifyEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/url";

/**
 * Nothing here writes to the database.
 *
 * The form sends an email and stops. The company, the owner and the site are
 * created when the link in that email is opened, by `authorizeSignUp`. That
 * ordering is the point: verifying first means a typo'd address never becomes
 * a tenant nobody can reach, and a stranger cannot squat a company name with
 * an address they do not own.
 *
 * Note for anyone editing this file: a `"use server"` module may only export
 * async functions. Exporting a constant from here compiles clean, passes
 * `tsc`, passes `next build`, and then throws at request time on every submit.
 * That is why the forms declare their own initial state. `export type` is
 * fine, because types are erased.
 */

export type SignUpState = {
  /** Per field, keyed by input name. */
  errors: Record<string, string>;
  /** Anything not attributable to one field. */
  formError: string | null;
};

export async function requestSignUp(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    companyName: formData.get("companyName"),
    name: formData.get("name"),
    email: formData.get("email"),
    siteName: formData.get("siteName"),
    siteAddress: formData.get("siteAddress"),
    // Detected in the browser. Missing means JavaScript never ran, and
    // `signUpSchema` catches an unusable value back to a default rather than
    // failing a sign-up over a field the person never saw.
    timezone: formData.get("timezone") ?? "",
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !errors[field]) {
        errors[field] = issue.message;
      }
    }
    return { errors, formError: null };
  }

  const plan = trialPlanId(formData.get("plan")?.toString() ?? null);
  const token = createSignUpToken(parsed.data);
  const query = new URLSearchParams({ token });
  if (plan) query.set("plan", plan);

  try {
    await getEmailProvider().send(
      signUpVerifyEmail({
        to: parsed.data.email,
        name: parsed.data.name,
        companyName: parsed.data.companyName,
        url: appUrl(`/sign-up/verify?${query.toString()}`),
        trialDays: TRIAL_DAYS,
      }),
    );
  } catch {
    // Surfaced rather than swallowed. `deliverMagicLink` stays quiet on a
    // failed send because saying anything there would reveal whether an
    // address has an account; there is no account to reveal here, and a
    // person who sees "check your email" and never gets one has no way to
    // tell a broken mailer from a typo they cannot see.
    return {
      errors: {},
      formError:
        "We could not send the confirmation email just now. Try again in a moment.",
    };
  }

  // Outside the try: `redirect` works by throwing, so catching here would
  // swallow the navigation and render the send as a failure.
  redirect(`/sign-up/check-email?to=${encodeURIComponent(parsed.data.email)}`);
}

export type CompleteState = { error: string | null };

/**
 * Redeems the link. A POST rather than work done on page load, so that a mail
 * scanner or a link-prefetcher following the URL renders a confirmation page
 * instead of quietly creating a company and taking a session cookie with it.
 */
export async function completeSignUp(
  _prev: CompleteState,
  formData: FormData,
): Promise<CompleteState> {
  const token = formData.get("token")?.toString() ?? "";
  const plan = formData.get("plan")?.toString() ?? "";

  try {
    await signIn("sign-up", { token, plan, redirect: false });
  } catch {
    return {
      error:
        "That link did not work. It may have expired. Start again and we will send a new one.",
    };
  }

  // `/dashboard` is behind `requireUnlockedActor`, which sends them to /pin to
  // choose one. Going to "/" instead would drop a brand-new owner back on the
  // marketing page they just signed up from.
  redirect("/dashboard");
}
