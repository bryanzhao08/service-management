import type { Metadata } from "next";
import { PIN_SIGN_IN_ENABLED } from "@/lib/auth/pin-sign-in";
import { PinSignInForm, SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Transient with a link sent to your work email.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "", error } = await searchParams;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">Sign in</h1>
        <p className="text-sm text-text-muted">
          Transient accounts are created by your supervisor. If you do not have one yet,
          ask them to add you.
        </p>
      </div>

      {/* The stale-link notice only makes sense while links are the way in. */}
      {error && !PIN_SIGN_IN_ENABLED ? (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-text"
        >
          That link did not work. It may have already been used or expired. Request a
          new one below.
        </p>
      ) : null}

      {PIN_SIGN_IN_ENABLED ? <PinSignInForm from={from} /> : <SignInForm from={from} />}
    </div>
  );
}
