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
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/dev/") ||
    // Provider callbacks carry no session cookie and never will. The route
    // authenticates the *payload* with a Svix signature instead, which is a
    // stronger check than a cookie would be: it proves the body was not
    // altered, not merely that someone was logged in.
    pathname.startsWith("/api/webhooks/");

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
  if (req.auth && (pathname === "/sign-in" || pathname === "/verify")) {
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
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
