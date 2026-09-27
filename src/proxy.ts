import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";

/**
 * Route protection. Next 16 renamed the `middleware` file convention to
 * `proxy`; the export and `config.matcher` shape are unchanged.
 *
 * Imports only `authConfig`, never `lib/auth/index`, so no adapter, Prisma
 * client or native argon2 binding is pulled into the edge bundle.
 *
 * This is a coarse gate: is there a session at all. It is not the authorization
 * boundary — that is `lib/db/scoped.ts`, which filters by company on every
 * query. Middleware alone would be the wrong place for it, because a matcher is
 * a string pattern and the thing being protected is a row.
 */
const { auth } = NextAuth(authConfig);

/** Reachable with no session. Everything else requires one. */
const PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/sign-in",
  "/verify",
  "/privacy",
  "/terms",
  "/sample-report",
  // The service worker precaches this at install. `Cache.put` rejects a
  // redirected response, so gating it would make install throw and leave the
  // app with no worker at all — failing in exactly the situation the page
  // exists for. It holds no data; it is a static "you're offline" shell.
  "/offline",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    // Sign-up, and the two pages the link walks through. Everyone who reaches
    // these has no account by definition — that is the entire feature — so a
    // session check here does not protect anything, it closes the only door
    // in. Gating it was a real bug, not a theoretical one: the marketing
    // page's "Start 30 days free" button landed on a sign-in form telling
    // people to ask their supervisor for an account.
    //
    // Nothing here writes to the database without a valid signed token, and
    // `/sign-up/verify` checks that token itself, the same argument as the
    // signed links below.
    pathname === "/sign-up" ||
    pathname.startsWith("/sign-up/") ||
    pathname.startsWith("/dev/") ||
    // Provider callbacks carry no session cookie and never will. The route
    // authenticates the *payload* with a Svix signature instead, which is a
    // stronger check than a cookie would be: it proves the body was not
    // altered, not merely that someone was logged in.
    pathname.startsWith("/api/webhooks/") ||
    // Signed links. These carry their own credential in the URL and verify it
    // themselves, so a session check here would not add security — it would
    // remove the feature. Every one of them exists for somebody with no
    // account: the property manager opening the receipt we emailed them
    // (`/r`), the same manager looking at the photos (`/g`), and the image
    // requests that gallery makes (`/api/uploads/local`, which is this app's
    // stand-in for an S3 presigned URL and authorises off the signature).
    //
    // Gating them was a real bug, not a theoretical one: every report already
    // sent carries a `/g/<token>` link in its footer and a QR code pointing at
    // it, and both landed on a sign-in page.
    pathname.startsWith("/r/") ||
    pathname.startsWith("/g/") ||
    // The recipient confirming their address. They are, by definition, someone
    // with no account: a duty manager at a hotel whose security vendor added
    // them to a list. Sending them to a sign-in page would make the
    // verification loop impossible to close, which would leave every recipient
    // permanently UNVERIFIED and the bounce-detection story with nothing to
    // stand on.
    pathname.startsWith("/confirm/") ||
    // The cron endpoint. A scheduled invocation carries no session cookie and
    // never will, so gating it here meant the queue could not be drained by
    // the only thing that is supposed to drain it: every report would sit
    // QUEUED forever in production and nothing would say why, because the
    // 401 is returned before the route is reached.
    //
    // Letting it past costs nothing. The route authenticates itself with a
    // constant-time comparison against CRON_SECRET and returns 503 when the
    // secret is unset, so it fails closed rather than open — the same
    // argument as the Svix-signed webhook above, and a stronger check than a
    // cookie for a caller that is a machine.
    pathname === "/api/jobs/sweep" ||
    pathname === "/api/uploads/local";

  if (!req.auth && !isPublic) {
    // An API caller gets a status, not a login page. A 307 to HTML on a fetch
    // surfaces as "unexpected token <" three layers away from the real cause,
    // and an upload retry loop would happily replay it forever.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "Sign in first." } },
        { status: 401 },
      );
    }
    const url = new URL("/sign-in", req.nextUrl.origin);
    // Round-trip the destination so a link into the app lands where it meant to
    // after sign-in. Only the path is carried, never an absolute URL, so it
    // cannot be turned into an open redirect.
    url.searchParams.set("from", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // A signed-in user has no reason to see the sign-in form.
  if (
    req.auth &&
    (pathname === "/sign-in" || pathname === "/verify" || pathname === "/sign-up")
  ) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the auth endpoints themselves, and
     * static files. Matching those would either break sign-in or burn a
     * middleware invocation on every icon request.
     *
     * `sw.js` has to be here rather than in PUBLIC_PATHS: the spec fails a
     * service worker registration outright if the script request redirects,
     * so a signed-out visitor being sent to /sign-in does not cost a slow
     * worker, it costs no worker at all — and nothing in the UI would say so.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
