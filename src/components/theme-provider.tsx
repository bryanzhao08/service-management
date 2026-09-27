"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  isThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const CHANGE = "transient:theme-change";
let sessionPreference: ThemePreference = "dark";

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : sessionPreference;
  } catch {
    return sessionPreference;
  }
}

function readMode(): "dark" | "light" {
  const pref = readPreference();
  return pref === "system"
    ? window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark"
    : pref;
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  window.addEventListener(CHANGE, callback);
  window.addEventListener("storage", callback);
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener(CHANGE, callback);
    window.removeEventListener("storage", callback);
    media.removeEventListener("change", callback);
  };
}

export function setThemePreference(preference: ThemePreference) {
  sessionPreference = preference;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still works in memory when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function useThemePreference() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => "dark" as const,
  );
  const mode = useSyncExternalStore(subscribe, readMode, () => "dark" as const);
  return { preference, mode };
}

/** One theme source for the quick control, Settings, OS changes and native bars. */
export function ThemeProvider() {
  const { mode } = useThemePreference();
  useEffect(() => {
    // Hydration starts with the server snapshot. Preserve the pre-paint choice
    // until the external store has caught up with the stored preference.
    if (mode !== readMode()) return;
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(`theme-${mode}`);
    root.style.colorScheme = mode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", mode === "dark" ? "#000000" : "#ffffff");
    window.dispatchEvent(new CustomEvent("transient:theme-applied", { detail: mode }));
  }, [mode]);
  return null;
}
