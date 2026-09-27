import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Check your email",
  description: "Confirm your address to finish setting up your company.",
};

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { to } = await searchParams;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">Check your email</h1>
        <p className="text-sm text-text-muted">
          {to ? (
            <>
              We sent a link to <strong className="text-text">{to}</strong>.
              Open it and your account is created.
            </>
          ) : (
            <>We sent you a link. Open it and your account is created.</>
          )}
        </p>
      </div>

      <p className="text-sm text-text-muted">
        Nothing exists yet — the link is what creates your company, so nobody
        can set one up with an address they do not own. It lasts 24 hours.
      </p>

      <p className="text-sm text-text-muted">
        Wrong address, or no email?{" "}
        <Link href="/sign-up" className="underline underline-offset-4">
          Start again
        </Link>
        .
      </p>
    </div>
  );
}
