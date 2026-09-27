import { z } from "zod";
import { createCompanyFromSignUp, trialPlanId } from "@/lib/db/sign-up";
import { readSignUpToken } from "./sign-up-token";

/**
 * Redeeming a sign-up link.
 *
 * This is a Credentials provider rather than a plain route handler because the
 * session strategy is JWT (`config.ts`), so there is no Session row to write —
 * the only supported way to mint a session is to go through Auth.js. Doing it
 * here rather than hand-signing a cookie means the new owner passes through
 * every gate an existing user does: the `signIn` callback still refuses a user
 * without a company, the `jwt` callback still reads claims from the database,
 * and the `signIn` event still writes `auth.sign_in` to the audit log.
 *
 * It also means `createAuthAdapter.createUser` can go on throwing. The account
 * is created here, explicitly, with a company around it; Auth.js is never asked
 * to invent one.
 *
 * The link is the credential, which is the same trust the magic-link provider
 * already places in an emailed URL. It differs in one way worth stating: a
 * magic link is single-use because Auth.js spends the stored token, while this
 * token is stateless and stays valid until it expires. That is why redemption
 * is idempotent rather than exclusive — `createCompanyFromSignUp` returns the
 * existing account on a second click instead of building a second company.
 */

const schema = z.object({
  token: z.string().min(1),
  plan: z.string().optional(),
});

export type SignUpUser = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Returns the owner on success, null on any bad token.
 *
 * One null for a forged signature, an expired link and a payload that no
 * longer parses, for the same reason `authorizePinSignIn` collapses its
 * failures: the page renders one message, so the link cannot be used to probe
 * which of those it was.
 */
export async function authorizeSignUp(
  raw: unknown,
): Promise<SignUpUser | null> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;

  const input = readSignUpToken(parsed.data.token);
  if (!input) return null;

  const result = await createCompanyFromSignUp(input, {
    planId: trialPlanId(parsed.data.plan ?? null),
  });

  // Signs in either way. On a second click the account already exists and
  // belongs to this address, which the signature just proved, so refusing
  // would strand someone whose mail client prefetched the link.
  return { id: result.userId, email: input.email, name: input.name };
}
