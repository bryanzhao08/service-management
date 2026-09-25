import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * One PrismaClient per process. Next's dev server re-evaluates modules on every
 * hot reload, and a fresh client each time exhausts the connection pool within
 * a few saves, so the instance is parked on `globalThis` in development.
 *
 * Prisma 7 requires a driver adapter — there is no built-in engine to fall back
 * on, and `new PrismaClient({ log })` alone does not typecheck. `PrismaPg` runs
 * queries through `pg`, which is also what lets the client work on runtimes
 * that cannot load a native binary.
 *
 * Nothing outside `lib/db` should import this directly — see `scoped.ts`.
 */
const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
