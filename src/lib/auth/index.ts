import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import {
  createAuthAdapter,
  findSessionClaims,
  findSignInUserByEmail,
} from "@/lib/db/auth-adapter";
import { record as recordAudit } from "@/lib/db/audit";
import { authConfig, MAGIC_LINK_MAX_AGE_SECONDS } from "./config";
import { deliverMagicLink } from "./magic-link";
import { authorizePinSignIn, PIN_SIGN_IN_ENABLED } from "./pin-sign-in";

/**
 * Node-only. Adds the adapter and the magic-link provider to the edge-safe
 * `authConfig`.
 *
 * `type: "email"` is what makes the link single-use and time-limited: Auth.js
 * stores a one-time token via the adapter and deletes it on redemption, so
 * neither property is reimplemented here.
 */
const magicLink: Provider = {
  id: "magic-link",
  type: "email",
  name: "Email",
  from: process.env.EMAIL_FROM ?? "Transient <reports@transient.local>",
  maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
  options: {},

  // Transient has no self-registration, so a link to an unknown address would
  // be undeliverable anyway. `deliverMagicLink` returns quietly for an unknown
  // address *and* for a failed send, which is what keeps the sign-in form's
  // response identical either way, so it cannot be used to enumerate who has
  // an account. It never throws by design; see that module for why.
  sendVerificationRequest: deliverMagicLink,
};

/**
 * Email + PIN, registered only when `PIN_SIGN_IN_ENABLED` is "1". See
 * `pin-sign-in.ts` for why it is off by default.
 *
 * Credentials providers require the JWT session strategy, which `config.ts`
 * already sets for unrelated reasons, so nothing else changes. `authorize`
 * returns null for every failure, which Auth.js surfaces as a single
 * `CredentialsSignin` error; the form renders one message for all of them.
 *
 * The magic-link provider stays registered alongside it. The flag replaces the
 * sign-in *screen*, not the wiring, so outstanding links still redeem and
 * turning the flag back off needs no deploy-ordering care.
 */
const pinCredentials: Provider = Credentials({
  id: "pin",
  name: "Email and PIN",
  credentials: {
    email: { label: "Work email", type: "email" },
    pin: { label: "PIN", type: "password" },
  },
  authorize: authorizePinSignIn,
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: createAuthAdapter(),
  providers: PIN_SIGN_IN_ENABLED ? [magicLink, pinCredentials] : [magicLink],
  callbacks: {
    ...authConfig.callbacks,

    /**
     * Second gate behind `createUser` throwing. A user must already exist and
     * must belong to a company; a row without one could not be scoped, so it is
     * refused rather than allowed through with a null tenant.
     *
     * Auth.js runs this callback twice for an email provider: once when the
     * link is *requested* and again when it is *redeemed*. Refusing on the
     * request leg throws AccessDenied, which the sign-in form renders as an
     * error, so the page would answer "does this account exist" — measured,
     * not theorised: an unknown address stayed on /sign-in while a known one
     * advanced. The request leg is therefore always allowed through and
     * `sendVerificationRequest` is what quietly declines to deliver. Nothing
     * is weakened, because the redemption leg below still runs.
     */
    async signIn({ user, email }) {
      if (email?.verificationRequest) return true;
      if (!user.email) return false;
      const known = await findSignInUserByEmail(user.email);
      return Boolean(known?.companyId);
    },

    /**
     * Mints the token. Reads claims from the database only when the token is
     * first created or a caller explicitly asks for a refresh, so ordinary
     * navigation costs no query.
     */
    async jwt({ token, user, trigger }) {
      if (!user && trigger !== "update") return token;

      const id = user?.id ?? token.sub;
      if (!id) return token;

      const claims = await findSessionClaims(id);
      if (!claims) return token;

      token.sub = claims.id;
      token.companyId = claims.companyId;
      token.role = claims.role;
      token.name = claims.name;
      token.email = claims.email;
      token.hasPin = claims.pinHash !== null;
      return token;
    },
  },

  events: {
    /**
     * Section 20 wants sign-in in the audit log.
     *
     * An `event` rather than the `signIn` callback above, because the callback
     * is the access gate: it runs twice per magic link and its return value
     * decides whether the user gets in. Writing from there would log the
     * request leg as if it were an entry, and a throw would lock a legitimate
     * guard out of their own shift. Events fire only after the sign-in has
     * actually succeeded and their result is discarded.
     */
    async signIn({ user }) {
      if (!user?.id) return;
      const claims = await findSessionClaims(user.id);
      if (!claims?.companyId) return;
      await recordAudit({
        companyId: claims.companyId,
        actorId: claims.id,
        action: "auth.sign_in",
        entityType: "User",
        entityId: claims.id,
      });
    },
  },
});
