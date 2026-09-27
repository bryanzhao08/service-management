import type { Metadata } from "next";
import Link from "next/link";
import { readSignUpToken } from "@/lib/auth/sign-up-token";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { trialPlanId } from "@/lib/db/sign-up";
import { ConfirmSignUpForm } from "./confirm-form";

export const metadata: Metadata = {
  title: "Finish setting up",
  description: "Confirm the details and create your company.",
};

/**
 * Reads the token and shows what it will create. It does not create anything.
 *
 * The write happens on the POST from the button below, so a mail scanner or a
 * link prefetcher that follows this URL renders a page and stops. Doing the
 * work on GET would let an automated fetch build the company and collect the
 * session cookie that comes with it.
 */
export default async function VerifySignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; plan?: string }>;
}) {
  const { token = "", plan } = await searchParams;
  const input = readSignUpToken(token);

  if (!input) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-text">
            That link did not work
          </h1>
          <p className="text-sm text-text-muted">
            It may have expired, or been changed on its way here. Sign-up links
            last 24 hours. Nothing was created.
          </p>
        </div>
        <p className="text-sm text-text-muted">
          <Link href="/sign-up" className="underline underline-offset-4">
            Start again
          </Link>{" "}
          and we will send a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">Finish setting up</h1>
        <p className="text-sm text-text-muted">
          Confirm this looks right and we will create the account and sign you
          in. {TRIAL_DAYS} days free, no card.
        </p>
      </div>

      <dl className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Company</dt>
          <dd className="text-right font-medium text-text">
            {input.companyName}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Owner</dt>
          <dd className="text-right font-medium text-text">{input.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Email</dt>
          <dd className="text-right font-medium text-text">{input.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">First site</dt>
          <dd className="text-right font-medium text-text">
            {input.siteName}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">Timezone</dt>
          <dd className="text-right font-medium text-text">
            {input.timezone}
          </dd>
        </div>
      </dl>

      <ConfirmSignUpForm token={token} plan={trialPlanId(plan) ?? ""} />
    </div>
  );
}
