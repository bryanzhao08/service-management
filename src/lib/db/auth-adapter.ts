import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { prisma } from "./client";

/**
 * Unscoped by necessity: authentication happens before there is a session to
 * scope by. It lives in `lib/db` rather than `lib/auth` so that the "raw Prisma
 * only inside the data layer" lint rule stays intact, and so that every
 * unscoped query in the codebase is in one directory a reviewer can read.
 *
 * `createUser` is removed on purpose. The stock adapter creates a user for any
 * address that completes a magic link, which would let a stranger mint an
 * account — and, because `User.companyId` is required, one with no tenant.
 * Users exist only by invite or seed, so account creation is a hard error here
 * rather than a check somewhere downstream that can be forgotten.
 */
export function createAuthAdapter(): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    createUser: () => {
      throw new Error(
        "Transient does not self-register. Users are created by invite (ADMIN) or by the seed.",
      );
    },
  };
}

/**
 * Pre-session lookup for the sign-in flow. Returns only what the magic-link
 * sender needs to decide whether to send, never the PIN hash.
 */
export async function findSignInUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, name: true, companyId: true, role: true },
  });
}

/** Pre-session lookup used only by PIN verification. */
export async function findPinHash(userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { pinHash: true },
  });
  return row?.pinHash ?? null;
}

export async function setPinHash(userId: string, pinHash: string | null) {
  await prisma.user.update({ where: { id: userId }, data: { pinHash } });
}

/**
 * Loads the claims the session token carries. Kept here so `lib/auth` never
 * touches Prisma directly.
 */
export async function findSessionClaims(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      companyId: true,
      role: true,
      name: true,
      email: true,
      largeText: true,
      theme: true,
      dictationLang: true,
      pinHash: true,
    },
  });
}
