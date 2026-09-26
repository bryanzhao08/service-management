/**
 * Where to send someone after they sign in.
 *
 * The `from` value is attacker-controlled: it arrives in the query string of a
 * link anyone can send. If it could name another origin, a real link to the
 * real domain would bounce the user onto a phishing page wearing our name, and
 * the URL they checked before clicking would have been genuine.
 *
 * So the rule is narrow: a same-site path, or the dashboard. It lives in its own
 * module rather than beside the server action because the action imports
 * next-auth, which cannot load in a unit test, and a rule this sharp should be
 * tested directly rather than only through a browser.
 */
export const SIGN_IN_FALLBACK = "/dashboard";

export function safeRedirect(raw: unknown): string {
  if (typeof raw !== "string") return SIGN_IN_FALLBACK;

  // Backslashes are rejected rather than normalised because browsers disagree
  // about them: some read `/\evil.test` as `//evil.test` and leave the origin.
  const sameSite = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\");
  return sameSite ? raw : SIGN_IN_FALLBACK;
}
