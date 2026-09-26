"use client";

import * as React from "react";

import { saveAppearance } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import {
  LARGE_TEXT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "Default. Built for night shifts." },
  { value: "light", label: "Light", hint: "Daylight and bright lobbies." },
  { value: "system", label: "System", hint: "Follow the phone." },
];

/**
 * Theme and larger text (section 9.10).
 *
 * The class goes on `<html>` immediately, before the server round trip, and
 * the preference is saved in the background. A guard tapping "Light" in a
 * bright lobby should not watch a spinner to find out whether the screen will
 * change; the write is durable but it is not what makes the UI respond.
 */
export function AppearanceSettings({
  theme,
  largeText,
}: {
  theme: ThemePreference;
  largeText: boolean;
}) {
  const [current, setCurrent] = React.useState<ThemePreference>(theme);
  const [large, setLarge] = React.useState(largeText);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * The document is mutated here, not in the click handler.
   *
   * `<html>` is outside React's tree, so writing to it during an event is a
   * side effect on something the component does not own — the compiler's
   * immutability rule catches exactly that. Doing it in an effect keyed on
   * state also makes the DOM follow state rather than the other way round, so
   * the two cannot drift if a save later fails and we roll `current` back.
   */
  React.useEffect(() => {
    const resolved =
      current === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : current;
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(`theme-${resolved}`);
    root.style.colorScheme = resolved;
    root.classList.toggle("text-larger", large);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, current);
      window.localStorage.setItem(LARGE_TEXT_STORAGE_KEY, large ? "1" : "0");
    } catch {
      // Private mode. The server value still applies for this session, and
      // the next cold open falls back to the default rather than breaking.
    }
  }, [current, large]);

  async function persist(next: ThemePreference, nextLarge: boolean) {
    // State first: the effect above repaints from it, so the screen changes
    // on the tap rather than after the round trip. A guard in a bright lobby
    // should not watch a spinner to find out whether the theme took.
    setCurrent(next);
    setLarge(nextLarge);
    const result = await saveAppearance(next.toUpperCase(), nextLarge);
    setError(result.error);
  }

  return (
    <div className="space-y-4" data-appearance>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">Theme</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={current === option.value ? "primary" : "secondary"}
              onClick={() => void persist(option.value, large)}
              aria-pressed={current === option.value}
              data-theme-option={option.value}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-text-muted">
          {OPTIONS.find((option) => option.value === current)?.hint}
        </p>
      </fieldset>

      <label className="border-rule flex min-h-11 items-center gap-3 border-t pt-4 text-sm text-text">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={large}
          onChange={(e) => void persist(current, e.target.checked)}
          data-large-text
        />
        Larger text
      </label>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
