/**
 * Dictation languages (section 9.10).
 *
 * A fixed list, not free text. The value goes straight to
 * `SpeechRecognition.lang`, and an unrecognised BCP-47 tag does not throw —
 * the browser quietly falls back to the document language. A guard who typed
 * their own locale would get English recognition with nothing telling them
 * why, so the list is the error message.
 *
 * Short on purpose. These are the languages a US contract-security crew
 * actually dictates in; adding one is a one-line change once somebody asks.
 */
export const DICTATION_LANGUAGES = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "es-US", label: "Spanish (United States)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "fr-CA", label: "French (Canada)" },
  { value: "tl-PH", label: "Tagalog (Philippines)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
] as const;

export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number]["value"];

export const DICTATION_STORAGE_KEY = "transient.dictationLang";

export const DEFAULT_DICTATION_LANGUAGE: DictationLanguage = "en-US";

export function isDictationLanguage(value: unknown): value is DictationLanguage {
  return (
    typeof value === "string" &&
    DICTATION_LANGUAGES.some((option) => option.value === value)
  );
}

/**
 * The language the recogniser should use, resolved on the client.
 *
 * Order matters: the stored preference beats the browser's locale, because a
 * guard whose phone is set to English but who dictates in Spanish made that
 * choice deliberately in settings. `navigator.language` is only the guess we
 * make before anyone has chosen.
 */
export function resolveDictationLanguage(): string {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(DICTATION_STORAGE_KEY);
      if (isDictationLanguage(stored)) return stored;
    } catch {
      // Private mode or a blocked origin. Fall through to the locale.
    }
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return DEFAULT_DICTATION_LANGUAGE;
}
