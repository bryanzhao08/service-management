import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

/**
 * Auth.js ships a deliberately minimal session shape. Transient needs
 * `companyId` on every request — it is the argument to every scoped query — so
 * it is added here rather than re-fetched in each page.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      companyId: string;
      role: Role;
      /** Whether this user has set a device PIN. Drives the lock screen. */
      hasPin: boolean;
    } & DefaultSession["user"];
  }
}

/**
 * Augmented on `@auth/core/jwt`, not `next-auth/jwt`. The latter is a bare
 * `export * from "@auth/core/jwt"`, and TypeScript does not merge an
 * augmentation of a re-exporting module into the original interface — the
 * fields silently stay `unknown`, which is what `JWT extends
 * Record<string, unknown>` degrades to. `@auth/core` is therefore a direct
 * dependency, pinned to the version next-auth resolves, so both refer to one
 * interface.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    companyId: string;
    role: Role;
    hasPin: boolean;
  }
}

export {};
