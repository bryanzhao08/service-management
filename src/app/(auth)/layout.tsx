import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared shell for sign-in, verify and PIN. Centred, single column, nothing
 * else on screen — these are the only three places in the app where the user
 * has no session, so there is no nav to render and nothing to be distracted by.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="pt-safe mx-auto flex w-full max-w-md items-center justify-between gap-3 px-6 pb-8">
        <Link
          href="/"
          aria-label="Transient home"
          className="tap-target relative rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring"
        >
          {/* Wordmark already carries role="img" + aria-label, so the link's
              own label is set above rather than adding a second announcement. */}
          <Wordmark className="text-2xl" title="" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
