import type { Metadata } from "next";
import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { trialPlanId } from "@/lib/db/sign-up";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Start your trial",
  description: `Set up your company on Transient. ${TRIAL_DAYS} days free, no card.`,
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">Start your trial</h1>
        <p className="text-sm text-text-muted">
          {TRIAL_DAYS} days free, no card. We&rsquo;ll set up your company and
          your first site, then you can add your guards.
        </p>
      </div>

      {/* Validated here rather than trusted into the form: `?plan=` comes off
          a link anyone can edit, and an unknown value falls back to no plan
          rather than failing the sign-up. */}
      <SignUpForm plan={trialPlanId(plan) ?? ""} />

      <p className="text-sm text-text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
