"use client";

import { Activity, Clock3, FileText, Settings2 } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

const icons = { Shifts: Clock3, Reports: FileText, Activity, Settings: Settings2 };

export function AppNavigation({
  links,
  activeHref,
}: {
  links: { href: string; label: string }[];
  activeHref?: string;
}) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <nav
        aria-label="Main"
        data-app-nav
        className="glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] rounded-[28px] p-2 sm:static sm:rounded-full sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none"
      >
        <ul className="flex items-center justify-around gap-1 sm:justify-start">
          {links.map(({ href, label }) => {
            const selected = activeHref
              ? activeHref === href
              : pathname === href ||
                pathname.startsWith(`${href}/`) ||
                (href === "/dashboard" && pathname.startsWith("/shift/"));
            const Icon = icons[label as keyof typeof icons];
            return (
              <li key={href} className="min-w-0 flex-1 sm:flex-none">
                <Link
                  href={href}
                  aria-current={selected ? "page" : undefined}
                  className="relative inline-flex min-h-16 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-[20px] px-2 text-xs font-medium text-text-muted active:opacity-70 sm:min-h-12 sm:w-auto sm:min-w-16 sm:flex-row sm:gap-2 sm:rounded-full sm:px-3 sm:text-sm"
                >
                  {selected && (
                    <motion.span
                      layoutId="nav-lens"
                      className="glass-lens absolute inset-0 rounded-[20px] sm:rounded-full"
                      transition={
                        reducedMotion
                          ? { duration: 0 }
                          : { type: "spring", bounce: 0, visualDuration: 0.35 }
                      }
                    />
                  )}
                  {Icon && (
                    <Icon
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className={`relative size-5 ${selected ? "text-accent" : ""}`}
                    />
                  )}
                  <span className={`relative ${selected ? "text-text" : ""}`}>
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </LayoutGroup>
  );
}
