"use client";

import { Moon, Sun } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId } from "react";

import { setThemePreference, useThemePreference } from "@/components/theme-provider";

export function ThemeToggle() {
  const { mode } = useThemePreference();
  const reducedMotion = useReducedMotion();
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div
        className="glass-control inline-flex shrink-0 rounded-full p-1"
        role="group"
        aria-label="Color mode"
      >
        {(
          [
            { value: "dark", Icon: Moon },
            { value: "light", Icon: Sun },
          ] as const
        ).map(({ value, Icon }) => (
          <button
            key={value}
            type="button"
            aria-label={`${value === "dark" ? "Dark" : "Light"} mode`}
            aria-pressed={mode === value}
            onClick={() => setThemePreference(value)}
            className="relative flex size-12 items-center justify-center rounded-full text-text-muted active:opacity-70"
          >
            {mode === value && (
              <motion.span
                layoutId="theme-lens"
                className="glass-lens absolute inset-0 rounded-full"
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { type: "spring", bounce: 0, visualDuration: 0.3 }
                }
              />
            )}
            <Icon
              aria-hidden="true"
              strokeWidth={1.75}
              className={`relative size-5 ${mode === value ? "text-text" : ""}`}
            />
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}
