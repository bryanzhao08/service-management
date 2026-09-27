import Link from "next/link";

/**
 * One footer nav for every public page.
 *
 * There were three copies of this with three different link sets, and the
 * legal pages quietly omitted the pricing page -- so someone reading the terms
 * had no route to what anything costs. One list means adding a public page
 * links it everywhere at once instead of in whichever file you remembered.
 *
 * `width` matches the container of the page it sits under; the legal pages are
 * a narrower measure than the marketing pages, and a footer that does not line
 * up with the content above it reads as a rendering bug.
 */
const LINKS = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/sign-in", label: "Sign in" },
] as const;

const WIDTHS = {
  narrow: "max-w-3xl",
  wide: "max-w-5xl",
  page: "max-w-6xl",
} as const;

export function SiteFooter({
  width = "wide",
  status = false,
  omit = [],
}: {
  width?: keyof typeof WIDTHS;
  status?: boolean;
  omit?: readonly string[];
}) {
  const links = LINKS.filter((l) => !omit.includes(l.href));
  return (
    <footer className="border-t border-border px-6 py-10">
      <div
        className={`mx-auto flex w-full ${WIDTHS[width]} flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}
      >
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-text-muted hover:text-text"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {status ? (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
            Status: all systems normal
          </p>
        ) : null}
      </div>
    </footer>
  );
}
