import { Logo, Mark } from "@/components/brand";
import { AppNavigation } from "@/components/app-navigation";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppHeader({
  links,
  activeHref,
  children,
}: {
  links: { href: string; label: string }[];
  activeHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <header className="pt-safe sticky top-0 z-30 mx-auto mb-4 max-w-3xl px-3">
        <div className="glass flex items-center justify-between gap-2 rounded-[28px] p-2">
          <div className="px-2 sm:hidden">
            <span className="hidden min-[360px]:inline">
              <Logo />
            </span>
            <Mark className="min-[360px]:hidden" />
          </div>
          <div className="hidden sm:block sm:flex-1">
            <AppNavigation links={links} activeHref={activeHref} />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {children}
          </div>
        </div>
      </header>
      <div className="sm:hidden">
        <AppNavigation links={links} activeHref={activeHref} />
      </div>
    </>
  );
}
