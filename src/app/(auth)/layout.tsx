import Link from "next/link";
import { Wordmark } from "@/components/brand";

/**
 * Shared shell for sign-in, verify and PIN. Centred, single column, nothing
 * else on screen — these are the only three places in the app where the user
 * has no session, so there is no nav to render and nothing to be distracted by.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-center px-6 pt-10 pb-2">
        <Link
          href="/"
          aria-label="Transient home"
          className="tap-target rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
        >
          {/* Wordmark already carries role="img" + aria-label, so the link's
              own label is set above rather than adding a second announcement. */}
          <Wordmark className="text-2xl" title="" />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
