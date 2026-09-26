import { prisma } from "./client";

export interface UserSettings {
  email: string;
  name: string;
  theme: "SYSTEM" | "DARK" | "LIGHT";
  largeText: boolean;
  dictationLang: string;
  hasPin: boolean;
}

/**
 * The account's own preferences.
 *
 * Deliberately not scoped through `db(actor)`: the caller passes its own
 * `actor.userId` and there is no path here that could read another account.
 * `hasPin` is a boolean rather than the hash — the settings page only needs to
 * know whether one exists, and shipping the argon2 digest to a React tree that
 * serialises into the HTML would put it on disk in the browser cache.
 */
export async function userSettings(userId: string): Promise<UserSettings> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      theme: true,
      largeText: true,
      dictationLang: true,
      pinHash: true,
    },
  });

  return {
    email: user.email,
    name: user.name,
    theme: user.theme,
    largeText: user.largeText,
    dictationLang: user.dictationLang,
    hasPin: user.pinHash !== null,
  };
}

/** Writes the appearance preferences. Same reasoning as the read above. */
export async function saveUserAppearance(
  userId: string,
  theme: "SYSTEM" | "DARK" | "LIGHT",
  largeText: boolean,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { theme, largeText },
  });
}

/** Writes the dictation language. */
export async function saveUserDictationLanguage(
  userId: string,
  dictationLang: string,
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { dictationLang },
  });
}
