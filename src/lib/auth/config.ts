import type { NextAuthConfig } from "next-auth";

/**
 * The edge-safe half of the Auth.js configuration: no adapter, no database
 * client, no native module, so `middleware.ts` can import it and still run on
 * the edge runtime. Everything that touches Prisma or argon2 is added in
 * `lib/auth/index.ts`, which is node-only.
 *
 * Session strategy is JWT rather than database. With database sessions every
 * navigation costs a query and middleware cannot run on the edge at all. The
 * tradeoff is that revocation is not instant; claims are re-read whenever the
 * token is minted or a caller asks for an update.
 */

export const MAGIC_LINK_MAX_AGE_SECONDS = 10 * 60;
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const authConfig = {
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/verify",
    error: "/sign-in",
  },
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  providers: [],
  callbacks: {
    /**
     * Pure: reshapes the token that `lib/auth/index.ts` minted. No I/O, so it
     * is safe on the edge.
     */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.companyId = token.companyId;
        session.user.role = token.role;
        session.user.hasPin = token.hasPin ?? false;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
