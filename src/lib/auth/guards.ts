import { redirect } from "next/navigation";
import { Role } from "@/generated/prisma/enums";
import { db, type Actor } from "@/lib/db/scoped";
import { auth } from "./index";
import { hasUnlock } from "./unlock";

/**
 * Role guards. Section 8, in order of privilege:
 *
 *   GUARD       start/end shifts and log entries at assigned sites;
 *               view own reports and receipts
 *   SUPERVISOR  everything a guard can do, plus configure assigned sites and
 *               view all shifts and reports at those sites
 *   ADMIN       all sites in the company, manage users and assignments
 *   OWNER       admin, plus company settings and deletion
 *
 * Roles nest, so the check is a rank comparison rather than a set membership
 * test. Expressing it as a rank is what keeps `SUPERVISOR` automatically able
 * to do everything a `GUARD` can without listing it twice.
 */
const RANK: Record<Role, number> = {
  [Role.GUARD]: 0,
  [Role.SUPERVISOR]: 1,
  [Role.ADMIN]: 2,
  [Role.OWNER]: 3,
};

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export const can = {
  /** Configure a site: recipients, blind spots, templates, report sections. */
  configureSite: (actor: Actor) => atLeast(actor.role, Role.SUPERVISOR),
  /** See every shift and report at a visible site, not just their own. */
  viewAllShiftsAtSite: (actor: Actor) => atLeast(actor.role, Role.SUPERVISOR),
  /** Invite users and change site assignments. */
  manageUsers: (actor: Actor) => atLeast(actor.role, Role.ADMIN),
  /** Company settings, billing, deletion. */
  manageCompany: (actor: Actor) => atLeast(actor.role, Role.OWNER),
} as const;

/** The signed-in actor, or null. Use in a layout that renders either way. */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) return null;
  return {
    userId: session.user.id,
    companyId: session.user.companyId,
    role: session.user.role,
  };
}

/**
 * The signed-in actor, or a redirect to sign-in. This is the normal entry
 * point for an authenticated page or server action.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in");
  return actor;
}

/**
 * Actor plus their scoped data client, so a page cannot accidentally obtain one
 * without the other.
 */
export async function requireScopedDb() {
  const actor = await requireActor();
  return { actor, db: db(actor) };
}

export async function requireRole(minimum: Role): Promise<Actor> {
  const actor = await requireActor();
  if (!atLeast(actor.role, minimum)) {
    // Not found rather than forbidden: a supervisor probing an admin URL should
    // not learn that it exists.
    redirect("/dashboard");
  }
  return actor;
}

/**
 * The PIN gate. Checked here rather than in `middleware.ts` because the unlock
 * cookie is an HMAC over `AUTH_SECRET` and verifying it needs node crypto,
 * which the edge runtime does not have. Middleware answers "is there a
 * session"; this answers "is this device unlocked", and every authenticated
 * layout calls it.
 */
export async function requireUnlockedActor(): Promise<Actor> {
  const actor = await requireActor();
  if (!(await hasUnlock(actor.userId))) redirect("/pin");
  return actor;
}
