/**
 * What a brand-new site starts life with.
 *
 * Until now the only way a `Site` existed was `prisma/seed.ts`, so these
 * defaults lived there. Self-serve sign-up creates the first site for real
 * customers, and a site with no entry types is not broken so much as useless:
 * `siteEntryTypeId` is optional everywhere, so nothing throws — the guard just
 * opens the incident sheet and finds no categories to tap.
 *
 * So the list moves here and both callers read it, for the same reason
 * `setCompanyPlan` exists: the seed, the tests and the sign-up path should
 * write the same rows through the same definition, rather than the demo
 * company quietly being better configured than a paying one.
 */

/** Incident categories offered as one-tap chips in the quick-incident sheet. */
export const DEFAULT_ENTRY_TYPES = [
  {
    key: "transient",
    label: "Transient / trespass",
    icon: "user-x",
    color: "ember",
  },
  { key: "intoxicated", label: "Intoxicated guest", icon: "wine", color: "ember" },
  { key: "noise", label: "Noise complaint", icon: "volume-2", color: "olive" },
  { key: "dispute", label: "Guest dispute", icon: "users", color: "olive" },
  { key: "damage", label: "Property damage", icon: "hammer", color: "copper" },
  { key: "medical", label: "Medical", icon: "heart-pulse", color: "copper" },
  { key: "suspicious", label: "Suspicious activity", icon: "eye", color: "ember" },
  { key: "alarm", label: "Alarm", icon: "bell-ring", color: "copper" },
  { key: "other", label: "Other", icon: "circle-dot", color: "khaki" },
] as const;

/** Words that carry no identifying signal in a site name. */
const NOISE_WORDS = new Set([
  "the",
  "of",
  "at",
  "and",
  "a",
  "an",
  "on",
  "in",
]);

/**
 * A 2-4 character site code derived from its name, matching what the seed
 * picked by hand ("Westside Hotel — Sunset Strip" -> "WHSS", capped at 4).
 *
 * The code prefixes every incident number a client ever reads (WH-0924-03),
 * so it has to be short, stable and typeable. It is only a starting point:
 * `@@unique([companyId, code])` is the real constraint, and the caller is
 * responsible for resolving a collision.
 *
 * Returns "S1" for a name with nothing usable in it, because an empty code
 * would render incident numbers as "-0924-03" rather than failing loudly.
 */
export function siteCodeFromName(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE_WORDS.has(w.toLowerCase()));

  const initials = words
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (initials.length >= 2) return initials.slice(0, 4);

  // One usable word ("Warehouse"), so fall back to its opening letters.
  const letters = words
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 3);

  return "S1";
}
