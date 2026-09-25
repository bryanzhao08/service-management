import Link from "next/link";

import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * Chrome shared by the public legal pages. Separate from the app shell, which
 * gets a nav, an offline banner and a session.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="px-6 py-5">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          {/* No aria-label here. The Wordmark inside already exposes "Transient"
              as its accessible name, and an aria-label of "Transient home"
              does not contain the visible glyphs (the wordmark renders a
              dotless U+0131), which trips axe's label-content-name-mismatch
              and, more importantly, breaks speech-input activation. */}
          <Link href="/">
            <Logo />
          </Link>
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated {updated}</p>
        <div className="mt-10 flex flex-col gap-8">{children}</div>
      </main>

      <footer className="border-t border-border px-6 py-10">
        <nav
          aria-label="Footer"
          className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-6 gap-y-2 text-sm"
        >
          <Link href="/" className="text-text-muted hover:text-text">
            Home
          </Link>
          <Link href="/privacy" className="text-text-muted hover:text-text">
            Privacy
          </Link>
          <Link href="/terms" className="text-text-muted hover:text-text">
            Terms
          </Link>
        </nav>
      </footer>
    </>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="flex flex-col gap-3 text-text-muted">{children}</div>
    </section>
  );
}
