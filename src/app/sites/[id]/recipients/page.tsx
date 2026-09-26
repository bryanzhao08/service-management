import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppChrome } from "@/components/app-chrome";
import {
  RecipientsManager,
  type RecipientView,
} from "@/components/sites/recipients-manager";
import { Button } from "@/components/ui/button";
import { can, requireUnlockedActor } from "@/lib/auth/guards";
import { siteRecipients } from "@/lib/db/recipients";

export const metadata: Metadata = { title: "Recipients" };

/**
 * Recipients for one site.
 *
 * Reached from the dashboard, which is where a supervisor learns an address
 * bounced. Telling somebody their report did not arrive and then giving them
 * nowhere to fix it is the worst version of this screen, so the link goes
 * here and this page can actually act.
 *
 * The site is resolved through the same visibility filter as everything else,
 * so a site id belonging to another company is a 404 rather than an empty
 * form pointed at somebody else's data.
 */
export default async function SiteRecipientsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUnlockedActor();
  if (!can.configureSite(actor)) notFound();

  const data = await siteRecipients(actor, id);
  if (!data) notFound();

  const initial: RecipientView[] = data.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    roleLabel: r.roleLabel,
    required: r.required,
    status: r.status,
    stale: r.stale,
    lastBounceReason: r.lastBounceReason,
  }));

  const bounced = initial.filter((r) => r.status === "BOUNCED").length;
  const unconfirmed = initial.filter((r) => r.status === "UNVERIFIED").length;

  return (
    <>
      <AppChrome />
      <main
        className="mx-auto max-w-2xl space-y-6 px-4 pb-16"
        data-recipients-page
        data-site-id={id}
      >
        <header className="space-y-2 pt-4">
          <Button asChild variant="ghost" className="-ml-3">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
          <h1 className="text-2xl font-semibold text-text">Recipients</h1>
          <p className="text-sm text-text-muted">
            {data.site.name} ({data.site.code}) &middot;{" "}
            {summarise(initial.length, bounced, unconfirmed)}
          </p>
        </header>

        <RecipientsManager siteId={data.site.id} initial={initial} />
      </main>
    </>
  );
}

function summarise(total: number, bounced: number, unconfirmed: number): string {
  if (total === 0) return "nobody is emailed the report yet";
  if (bounced > 0) {
    return `${bounced} of ${total} bounced, so those reports are not arriving`;
  }
  if (unconfirmed > 0) {
    return `${unconfirmed} of ${total} have not confirmed yet`;
  }
  return total === 1 ? "1 confirmed recipient" : `${total} confirmed recipients`;
}
