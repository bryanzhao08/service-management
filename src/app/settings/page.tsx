import type { Metadata } from "next";

import { AppChrome } from "@/components/app-chrome";
import { PushToggle } from "@/components/push-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { hasSubscription } from "@/lib/db/notifications";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (sections 13 and 18).
 *
 * Only the notifications section exists at this milestone; the rest arrives in
 * milestone 11. It lives here rather than on the dashboard because the
 * permission prompt must be reachable deliberately: a guard who wants
 * notifications back after denying them once needs somewhere to go, and a
 * dashboard widget they scrolled past is not that.
 */
export default async function SettingsPage() {
  const actor = await requireUnlockedActor();

  // Read on the server so the page can say whether *any* device is registered.
  // The toggle itself can only speak for the browser it is running in, and
  // those two facts genuinely differ — a guard with the depot tablet
  // registered and their own phone not should see both.
  const registeredSomewhere = await hasSubscription(actor.userId);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  return (
    <>
      <AppChrome />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pb-16">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-text">Settings</h1>
          <p className="text-sm text-text-muted">
            Notifications are set per device, not per account.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PushToggle publicKey={publicKey} />

            {registeredSomewhere ? (
              <p className="border-rule border-t pt-4 text-sm text-text-muted">
                At least one device is set up for notifications on your account. If this
                isn&rsquo;t one of them, turn them on here too.
              </p>
            ) : null}

            {publicKey ? null : (
              <p className="border-rule border-t pt-4 text-sm text-text-muted">
                Push isn&rsquo;t configured on this deployment, so nothing can be sent
                to a device. The bell still works.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
