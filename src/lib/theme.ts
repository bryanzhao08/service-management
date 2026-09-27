export const THEMES = ["dark", "light", "system"] as const;
export type ThemePreference = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "transient.theme";
export const LARGE_TEXT_STORAGE_KEY = "transient.largeText";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Runs before first paint, inlined in <head>.
 *
 * The class has to be on <html> before the browser paints or the guard gets a
 * flash of the wrong theme — which on a phone at 4 AM means a full-screen
 * flash of white. Kept as a string so it ships as a synchronous inline script
 * rather than a hydration-time effect.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var pref = stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
    var resolved = pref === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : pref;
    var root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add("theme-" + resolved);
    root.style.colorScheme = resolved;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "light" ? "#ffffff" : "#000000");
    if (localStorage.getItem(${JSON.stringify(LARGE_TEXT_STORAGE_KEY)}) === "1") {
      root.classList.add("text-larger");
    }
  } catch (e) {
    document.documentElement.classList.add("theme-dark");
  }
})();
`.trim();
