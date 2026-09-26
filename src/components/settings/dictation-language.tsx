"use client";

import * as React from "react";

import { saveDictationLanguage } from "@/app/settings/actions";
import { DICTATION_LANGUAGES, DICTATION_STORAGE_KEY } from "@/lib/dictation";

/**
 * Dictation language (section 9.10).
 *
 * Saved twice on purpose: to the account so it follows the guard to another
 * device, and to localStorage because `useDictation` runs inside a press-and-
 * hold handler where there is no time for a server read. The account is the
 * durable copy; localStorage is what the recogniser actually reads.
 */
export function DictationLanguageSetting({ value }: { value: string }) {
  const [current, setCurrent] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(DICTATION_STORAGE_KEY, value);
    } catch {
      // Private mode: the browser locale is used instead, which is the
      // pre-settings behaviour rather than a broken one.
    }
  }, [value]);

  async function choose(next: string) {
    setCurrent(next);
    try {
      window.localStorage.setItem(DICTATION_STORAGE_KEY, next);
    } catch {
      // As above.
    }
    const result = await saveDictationLanguage(next);
    setError(result.error);
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-text" htmlFor="dictation-language">
        Dictation language
      </label>
      <select
        id="dictation-language"
        className="border-rule min-h-11 w-full rounded-lg border bg-surface px-3 text-text"
        value={current}
        onChange={(e) => void choose(e.target.value)}
        data-dictation-language
      >
        {DICTATION_LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-sm text-text-muted">
        Used for press-and-hold dictation. Recognition quality depends on the phone, not
        on us.
      </p>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
