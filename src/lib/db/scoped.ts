import { Role } from "@/generated/prisma/enums";
import { prisma } from "./client";

/**
 * The single data-access layer. Company isolation is enforced here and nowhere
 * else, which is only true because `eslint.config.mjs` forbids importing
 * `lib/db/client` or the generated client from anywhere outside `lib/db/**`.
 * That lint rule is the enforcement; this file is the implementation.
 *
 * Two axes of visibility, and they are different questions:
 *
 *   1. Tenancy — which company owns the row. Never optional, never role-
 *      dependent. A cross-company read is a bug at any privilege level.
 *   2. Scope — which of that company's rows this actor may see, from section 8:
 *        GUARD       assigned sites; own reports and receipts
 *        SUPERVISOR  assigned sites; all shifts and reports at those sites
 *        ADMIN       every site in the company
 *        OWNER       admin, plus company settings and deletion
 *
 * Both are expressed as relational filters rather than by pre-loading the
 * actor's site ids, so the database does the join and the filter cannot drift
 * out of date between the load and the query.
 */

export type Actor = {
  userId: string;
  companyId: string;
  role: Role;
};

const COMPANY_WIDE: readonly Role[] = [Role.ADMIN, Role.OWNER];

function seesEverySite(actor: Actor): boolean {
  return COMPANY_WIDE.includes(actor.role);
}

/**
 * Where-fragments pinning each model to what `actor` may see. Every read and
 * write below is built from one of these, and they are exported so that a test
 * can assert the shape directly rather than inferring it from behaviour.
 *
 * The chain of custody back to Company, which is what makes these safe:
 *   Site    -> companyId
 *   Shift   -> site
 *   Entry   -> shift -> site
 *   Media   -> shift -> site
 *   Report  -> shift -> site
 */
export const visible = {
  site(actor: Actor) {
    const tenancy = { companyId: actor.companyId };
    if (seesEverySite(actor)) return tenancy;
    return {
      ...tenancy,
      assignments: { some: { userId: actor.userId } },
    };
  },

  user(actor: Actor) {
    return { companyId: actor.companyId };
  },

  shift(actor: Actor) {
    // Deliberately not narrowed to `guardId` for a GUARD. Section 8 scopes a
    // guard's *reports* to their own, not their shifts: acknowledging a handoff
    // requires reading the outgoing guard's shift at the same site.
    return { site: visible.site(actor) };
  },

  entry(actor: Actor) {
    return { shift: visible.shift(actor) };
  },

  media(actor: Actor) {
    return { shift: visible.shift(actor) };
  },

  report(actor: Actor) {
    const atVisibleSites = { shift: visible.shift(actor) };
    if (actor.role !== Role.GUARD) return atVisibleSites;
    return { shift: { ...visible.shift(actor), guardId: actor.userId } };
  },

  recipient(actor: Actor) {
    return { site: visible.site(actor) };
  },
} as const;

/**
 * Accessors. Each one takes the actor first so a call site physically cannot
 * omit the scope.
 *
 * Note every single-row read is `findFirst`, never `findUnique`. `findUnique`
 * only accepts unique fields in its where-clause, so the company filter cannot
 * be attached to it — `findUnique({ where: { id } })` would happily return
 * another company's row. That is the exact mistake this layer exists to
 * prevent, so `findUnique` does not appear in this file at all.
 */
export function db(actor: Actor) {
  return {
    actor,

    site: {
      findMany() {
        return prisma.site.findMany({
          where: visible.site(actor),
          orderBy: { name: "asc" },
        });
      },
      findById(id: string) {
        return prisma.site.findFirst({
          where: { id, ...visible.site(actor) },
        });
      },
      withConfig(id: string) {
        return prisma.site.findFirst({
          where: { id, ...visible.site(actor) },
          include: {
            areas: { orderBy: { order: "asc" } },
            blindSpots: { orderBy: { order: "asc" } },
            entryTypes: { orderBy: { order: "asc" } },
            shiftTemplates: { orderBy: { order: "asc" } },
            reportTemplate: true,
            recipients: { orderBy: { name: "asc" } },
          },
        });
      },
    },

    user: {
      findMany() {
        return prisma.user.findMany({
          where: visible.user(actor),
          orderBy: { name: "asc" },
        });
      },
      findById(id: string) {
        return prisma.user.findFirst({
          where: { id, ...visible.user(actor) },
        });
      },
    },

    shift: {
      findById(id: string) {
        return prisma.shift.findFirst({
          where: { id, ...visible.shift(actor) },
        });
      },
      findByIdWithSite(id: string) {
        return prisma.shift.findFirst({
          where: { id, ...visible.shift(actor) },
          include: { site: true, guard: true },
        });
      },
      /** The actor's own shift that is currently clocked in, if any. */
      findActiveForActor() {
        return prisma.shift.findFirst({
          where: {
            ...visible.shift(actor),
            guardId: actor.userId,
            status: "ACTIVE",
          },
          include: { site: true },
        });
      },
    },

    report: {
      findById(id: string) {
        return prisma.report.findFirst({
          where: { id, ...visible.report(actor) },
        });
      },
    },
  };
}

export type ScopedDb = ReturnType<typeof db>;
