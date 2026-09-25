import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { LoggingMode, Role } from "@/generated/prisma/enums";

/**
 * Helpers for the database-backed tests.
 *
 * This file is the one place outside `src/lib/db` allowed to hold a raw client:
 * a test that proves the scoped layer blocks a read has to be able to write the
 * row it is denied, and it must do that *around* the layer or it is only
 * testing itself. `eslint.config.mjs` exempts `tests/db/**` for exactly this,
 * and nothing else.
 */
const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("tests/db: DATABASE_URL is not set");
}
if (!/transient_test/.test(connectionString)) {
  // These helpers truncate every table. If the URL ever resolved to the dev or
  // production database this would quietly destroy real data, so refuse rather
  // than trust the config.
  throw new Error(
    `tests/db: refusing to run against a database not named transient_test (got ${connectionString.replace(/:[^:@/]*@/, ":***@")})`,
  );
}

export const raw = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Truncate rather than delete-in-order: the schema has enough foreign keys that
 * a hand-maintained delete order would rot the first time a model is added.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await raw.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await raw.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

/**
 * A complete, isolated tenant: company, site, an owner, a guard assigned to the
 * site, and one shift. Returns the ids the tests assert against.
 */
export async function createTenant(slug: string) {
  const company = await raw.company.create({
    data: { name: `Company ${slug}`, slug },
  });

  const site = await raw.site.create({
    data: {
      companyId: company.id,
      name: `${slug} site`,
      code: slug.slice(0, 2).toUpperCase(),
      address: "1 Test Street",
      loggingMode: LoggingMode.FULL,
    },
  });

  const owner = await raw.user.create({
    data: {
      companyId: company.id,
      email: `owner@${slug}.test`,
      name: `${slug} owner`,
      role: Role.OWNER,
    },
  });

  const guard = await raw.user.create({
    data: {
      companyId: company.id,
      email: `guard@${slug}.test`,
      name: `${slug} guard`,
      role: Role.GUARD,
      assignments: { create: { siteId: site.id } },
    },
  });

  const shift = await raw.shift.create({
    data: {
      siteId: site.id,
      guardId: guard.id,
      clientId: `${slug}-shift-1`,
      scheduledStart: new Date("2026-02-01T06:00:00.000Z"),
      scheduledEnd: new Date("2026-02-01T16:00:00.000Z"),
    },
  });

  return { company, site, owner, guard, shift };
}
