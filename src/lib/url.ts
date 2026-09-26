/**
 * Where this instance thinks it lives.
 *
 * Every link we put in an email is absolute and is opened days later by
 * someone who is not signed in, on a device that has never touched this app.
 * There is no relative-path fallback and no second chance: a wrong origin here
 * is a receipt link that 404s in a manager's inbox during the argument it
 * exists to settle.
 *
 * So this is one function rather than a `process.env` read at each call site.
 * The failure mode of the latter is two senders disagreeing -- one reading
 * `NEXTAUTH_URL`, one reading `NEXT_PUBLIC_APP_URL` -- which produces working
 * links in some emails and broken ones in others, from the same deploy.
 */
export function baseUrl(): string {
  return (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3210"
  );
}

/** An absolute URL for a path like `/confirm/abc`, safe to put in an email. */
export function appUrl(path: string): string {
  return new URL(path, baseUrl()).toString();
}
