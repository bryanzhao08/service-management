"use server";

import { revalidatePath } from "next/cache";

import { signOut } from "@/lib/auth";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { pinSchema, setPin } from "@/lib/auth/pin";
import { revokeUnlock } from "@/lib/auth/unlock";
import { saveUserAppearance, saveUserDictationLanguage } from "@/lib/db/settings";
import { DICTATION_LANGUAGES } from "@/lib/dictation";

export type SettingsResult = { ok: boolean; error: string | null };

const THEME_VALUES = ["SYSTEM", "DARK", "LIGHT"] as const;
type ThemeValue = (typeof THEME_VALUES)[number];

/**
 * Appearance (section 9.10).
 *
 * Written to the account, not only to the device. `themeInitScript` reads
 * localStorage before first paint so there is no flash, but localStorage is
 * per-browser: a guard who set large text on their phone and then picks up
 * the depot tablet would otherwise find it reset. The database is the durable
 * answer and localStorage is the cache in front of it, which is why the client
 * writes both and neither one alone is authoritative.
 */
export async function saveAppearance(
  theme: string,
  largeText: boolean,
): Promise<SettingsResult> {
  const actor = await requireUnlockedActor();
  if (!THEME_VALUES.includes(theme as ThemeValue)) {
    return { ok: false, error: "Unknown theme." };
  }

  await saveUserAppearance(actor.userId, theme as ThemeValue, largeText);
  revalidatePath("/settings");
  return { ok: true, error: null };
}

/**
 * Dictation language (section 9.10).
 *
 * Constrained to a list rather than accepting any BCP-47 tag. The value is
 * handed straight to `SpeechRecognition.lang`, and an unrecognised tag makes
 * the browser fall back silently to the page language — so a guard who typed
 * their own locale would get English recognition and no error saying why.
 */
export async function saveDictationLanguage(lang: string): Promise<SettingsResult> {
  const actor = await requireUnlockedActor();
  if (!DICTATION_LANGUAGES.some((option) => option.value === lang)) {
    return { ok: false, error: "That language isn't available." };
  }

  await saveUserDictationLanguage(actor.userId, lang);
  revalidatePath("/settings");
  return { ok: true, error: null };
}

/**
 * Change the PIN from settings.
 *
 * Reaching this screen already required an unlocked session, so the current
 * PIN has been entered during this session. Asking for it again would be
 * theatre: anyone who could get here could already read every entry on the
 * device.
 */
export async function changePin(pin: string, confirm: string): Promise<SettingsResult> {
  const actor = await requireUnlockedActor();
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid PIN." };
  }
  if (pin !== confirm) {
    return { ok: false, error: "The two PINs do not match." };
  }

  await setPin(actor.userId, pin);
  revalidatePath("/settings");
  return { ok: true, error: null };
}

/**
 * Sign out (section 9.10).
 *
 * A server action rather than a link because NextAuth's sign-out has to clear
 * a httpOnly cookie, which client JavaScript cannot touch. It also clears the
 * PIN unlock, since leaving that behind would let the next person on the
 * device skip the lock screen after signing in as someone else.
 */
export async function signOutEverywhere(): Promise<void> {
  await requireUnlockedActor();
  await revokeUnlock();
  await signOut({ redirectTo: "/sign-in" });
}
