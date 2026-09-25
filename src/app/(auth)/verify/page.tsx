import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function VerifyPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">Check your email</h1>
        <p className="text-sm text-text-muted">
          If that address has a Transient account, a sign-in link is on its way. It
          works once and expires in 10 minutes.
        </p>
      </div>

      <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-sm text-text-muted">
        <p>
          On a phone, open the link on the same device you want to stay signed in on.
          You can set a PIN straight after, so you will not need the email again on that
          device.
        </p>
      </div>

      <Button asChild variant="ghost" size="lg" fullWidth>
        <Link href="/sign-in">Use a different email</Link>
      </Button>
    </div>
  );
}
