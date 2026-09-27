"use client";

import * as React from "react";

import { saveAppearance } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { setThemePreference, useThemePreference } from "@/components/theme-provider";
import {
  LARGE_TEXT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "Default. Black glass with burgundy accents." },
  { value: "light", label: "Light", hint: "White and black. Clear in daylight." },
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
  saveToAccount = true,
}: {
  theme: ThemePreference;
  largeText: boolean;
  saveToAccount?: boolean;
}) {
  const { preference: current } = useThemePreference();
  const [large, setLarge] = React.useState(largeText);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      if (!window.localStorage.getItem(THEME_STORAGE_KEY)) setThemePreference(theme);
    } catch {
      // Keep the current session choice when storage is unavailable.
    }
  }, [theme]);

  React.useEffect(() => {
    document.documentElement.classList.toggle("text-larger", large);
    try {
      window.localStorage.setItem(LARGE_TEXT_STORAGE_KEY, large ? "1" : "0");
    } catch {
      // Larger text remains active for this session.
    }
  }, [large]);

  async function persist(next: ThemePreference, nextLarge: boolean) {
    // State first: the effect above repaints from it, so the screen changes
    // on the tap rather than after the round trip. A guard in a bright lobby
    // should not watch a spinner to find out whether the theme took.
    setThemePreference(next);
    setLarge(nextLarge);
    if (!saveToAccount) return;
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
              variant={current === option.value ? "primary" : "ghost"}
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
