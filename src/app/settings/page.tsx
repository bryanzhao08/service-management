import type { Metadata } from "next";
import Link from "next/link";

import { AppChrome } from "@/components/app-chrome";
import { PushToggle } from "@/components/push-toggle";
import { AppearanceSettings } from "@/components/settings/appearance";
import { ChangePin } from "@/components/settings/change-pin";
import { DictationLanguageSetting } from "@/components/settings/dictation-language";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { userSettings } from "@/lib/db/settings";
import { hasSubscription } from "@/lib/db/notifications";
import type { ThemePreference } from "@/lib/theme";

import { signOutEverywhere } from "./actions";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (sections 9.10, 13 and 18).
 *
 * One screen rather than a settings tree. There are six things to change here
 * and a guard finds them faster by scrolling than by guessing which submenu
 * holds "larger text".
 */
export default async function SettingsPage() {
  const actor = await requireUnlockedActor();

  const [user, registeredSomewhere] = await Promise.all([
    userSettings(actor.userId),
    // Read on the server so the page can say whether *any* device is
    // registered. The toggle itself can only speak for the browser it runs in,
    // and those two facts genuinely differ — a guard with the depot tablet
    // registered and their own phone not should see both.
    hasSubscription(actor.userId),
  ]);

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
  const theme = user.theme.toLowerCase() as ThemePreference;

  return (
    <>
      <AppChrome />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pb-16" data-settings-page>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-text">Settings</h1>
          <p className="text-sm text-text-muted">
            Signed in as {user.name} ({user.email}).
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <AppearanceSettings theme={theme} largeText={user.largeText} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dictation</CardTitle>
          </CardHeader>
          <CardContent>
            <DictationLanguageSetting value={user.dictationLang} />
          </CardContent>
        </Card>

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

        <Card>
          <CardHeader>
            <CardTitle>Device lock</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePin hasPin={user.hasPin} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-muted">
              Everything you logged, in full: the text, the times, the site, and
              anything later edited or deleted. Photos aren&rsquo;t included &mdash;
              they live in the report and the gallery.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <a href="/api/me/export?format=json" data-export-json>
                  Download JSON
                </a>
              </Button>
              <Button asChild variant="secondary">
                <a href="/api/me/export?format=csv" data-export-my-csv>
                  Download CSV
                </a>
              </Button>
            </div>
            <p className="border-rule border-t pt-4 text-sm text-text-muted">
              Deleted entries are in the export too, with the reason. Deleting an entry
              hides it from the report; it doesn&rsquo;t erase what you wrote.
            </p>
          </CardContent>
        </Card>

        {/*
          Admin and above. A supervisor configures sites but does not decide
          who works for the company, which is the line section 8 already drew
          in `can.manageUsers`.
        */}
        {actor.role === "ADMIN" || actor.role === "OWNER" ? (
          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-text-muted">
                Who is in this company, and how a new guard gets an account.
                Transient has no sign-up page, so this is the only way someone
                joins.
              </p>
              <Button asChild variant="secondary">
                <Link href="/settings/team" data-team-link>
                  Manage team
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/*
          Owner-only. A supervisor cannot act on a billing fact and does not
          need to carry one into a shift.
        */}
        {actor.role === "OWNER" ? (
          <Card>
            <CardHeader>
              <CardTitle>Plan and billing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-text-muted">
                What your company is on, the sites it covers this month, and what that
                costs. Recording, reports and delivery are included on every plan and
                never depend on a payment.
              </p>
              <Button asChild variant="secondary">
                <Link href="/settings/billing" data-billing-link>
                  View plan
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-muted">
              Signing out clears this device, including the PIN unlock. Your shifts,
              entries and reports stay where they are.
            </p>
            <form action={signOutEverywhere}>
              <Button type="submit" variant="danger" data-sign-out>
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
