import { AppHeader } from "@/components/app-header";

import { NotificationBell } from "@/components/notification-bell";
import { OfflineProvider } from "@/components/offline-provider";
import { currentActor } from "@/lib/auth/guards";
import { canViewAudit } from "@/lib/db/audit";

/**
 * The strip that sits above every signed-in screen (sections 13 and 14).
 *
 * Deliberately not in the root layout. The marketing pages are statically
 * generated and measured against a Lighthouse target in section 7, and this
 * mounts two client components that poll and open IndexedDB. A visitor reading
 * the pricing page should not download a notification poller.
 *
 * The banner renders nothing when online with an empty queue, so on a normal
 * shift this is just the nav and the bell.
 */
export async function AppChrome() {
  const actor = await currentActor();

  /**
   * `/settings` shipped with the push toggle and no link to it from anywhere,
   * so the only way in was to type the URL. A setting nobody can reach is the
   * same as a setting that does not exist, which is why the nav lives here
   * rather than being added per-page and forgotten again.
   */
  const links: { href: string; label: string }[] = [
    { href: "/dashboard", label: "Shifts" },
    { href: "/reports", label: "Reports" },
    ...(actor && canViewAudit(actor) ? [{ href: "/audit", label: "Activity" }] : []),
    { href: "/settings", label: "Settings" },
  ];

  return (
    <>
      <OfflineProvider />
      <AppHeader links={links}>
        <NotificationBell />
      </AppHeader>
    </>
  );
}
