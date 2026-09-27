import { CloudOff } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/**
 * The navigation fallback the service worker serves when a page is not cached
 * and the network is gone (section 14).
 *
 * Its job is to stop a guard concluding the app is broken. So it names what
 * still works and where their data is, rather than apologising. The two facts
 * that matter are that nothing typed has been lost, and that the shift screen
 * is the one that stays usable — everything else can wait for signal.
 *
 * No client JavaScript and no data fetching, because by definition this is
 * rendered when neither is available.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <CloudOff className="size-8 text-text-muted" aria-hidden="true" />

      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-text">No signal here</h1>
        <p className="text-text-muted">
          This page needs a connection and there isn&rsquo;t one. Nothing you&rsquo;ve
          logged is lost — notes, photos and incidents are saved on this phone and go
          out the moment you have bars again.
        </p>
      </div>

      <div className="border-rule space-y-3 rounded-xl border bg-surface p-4">
        <p className="text-sm font-semibold text-text">What still works</p>
        <ul className="space-y-1.5 text-sm text-text-muted">
          <li>Your current shift, including the timeline and the clock.</li>
          <li>Writing notes and incidents, and taking photos.</li>
        </ul>
        <p className="text-sm font-semibold text-text">What needs signal</p>
        <ul className="space-y-1.5 text-sm text-text-muted">
          <li>Generating the report and sending it.</li>
          <li>Anything about another shift or another site.</li>
        </ul>
      </div>

      {/*
        A full navigation, deliberately, not a <Link>. This page is served by
        the service worker after a navigation failed, so the router state it
        would need for a client transition is not there. /dashboard is also
        the only URL that knows which shift is open — there is no bare /shift
        route — and retrying it is exactly what someone back in signal wants.
      */}
      <a
        href="/dashboard"
        className="text-sm font-medium text-accent underline underline-offset-4"
      >
        Try again
      </a>
    </main>
  );
}
