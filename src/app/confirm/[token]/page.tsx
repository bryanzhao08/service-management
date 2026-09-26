import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Wordmark } from "@/components/brand";
import { confirmRecipient } from "@/lib/db/recipients";

export const metadata: Metadata = {
  title: "Address confirmed",
  robots: { index: false, follow: false },
};

/**
 * One-tap recipient confirmation (section 9.8).
 *
 * Opened by someone with no account, from an email they did not ask for. The
 * whole page is one sentence and no controls, because there is nothing else
 * they can usefully do here and anything more would read as the start of a
 * sign-up.
 *
 * Confirming on a GET is deliberate, against the usual rule. The alternative
 * is a page with a button that POSTs, and that costs a real confirmation rate
 * from exactly the audience least willing to spend effort on our behalf. What
 * makes it acceptable is the blast radius: the only thing the token can do is
 * mark one address as reachable, which is a statement the holder of that
 * mailbox is uniquely entitled to make. It grants nothing, reveals nothing,
 * and cannot be used to read a report.
 *
 * It is spent on use, so a mail client that pre-fetches links confirms the
 * address once and every later fetch 404s. That is the correct outcome
 * anyway: a scanner on the recipient's own mail server reaching the link
 * still proves the address accepts our mail.
 */
export default async function ConfirmRecipientPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const confirmed = await confirmRecipient(token);
  // Unknown, already spent, and forged all land here identically. A separate
  // "already confirmed" message would tell someone guessing tokens when they
  // had hit a real one.
  if (!confirmed) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-5 py-16">
      <Wordmark />
      <div className="border-hairline rounded-2xl border bg-surface p-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Thanks, {confirmed.name}.
        </h1>
        <p className="text-muted mt-3 text-base leading-relaxed">
          This address is confirmed for {confirmed.siteName} shift reports. If it ever
          stops working, whoever sends those reports will be told straight away instead
          of finding out weeks later.
        </p>
        <p className="text-muted mt-4 text-sm leading-relaxed">
          You do not have an account and we have not created one. Nothing else happens
          here.
        </p>
      </div>
    </main>
  );
}
