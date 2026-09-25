import Link from "next/link";

import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * Placeholder. The real marketing page is milestone 12, where it has to hit
 * Lighthouse >= 95 and therefore stays statically generated.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6">
      <Logo />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Log the shift. Leave on time.
        </h1>
        <p className="text-text-muted">
          A night of timestamps, photos, and incidents becomes one clean report and one
          deliverable email, with proof it arrived.
        </p>
      </div>
      <div>
        <Button asChild size="lg">
          <Link href="/dev/ui">View the component gallery</Link>
        </Button>
      </div>
    </main>
  );
}
