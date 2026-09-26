import { NotificationBell } from "@/components/notification-bell";
import { OfflineProvider } from "@/components/offline-provider";

/**
 * The strip that sits above every signed-in screen (sections 13 and 14).
 *
 * Deliberately not in the root layout. The marketing pages are statically
 * generated and measured against a Lighthouse target in section 7, and this
 * mounts two client components that poll and open IndexedDB. A visitor reading
 * the pricing page should not download a notification poller.
 *
 * The banner renders nothing when online with an empty queue, so on a normal
 * shift this is just the bell.
 */
export function AppChrome() {
  return (
    <>
      <OfflineProvider />
      <div className="flex justify-end px-2 pt-2">
        <NotificationBell />
      </div>
    </>
  );
}
