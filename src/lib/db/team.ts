import { Role } from "@/generated/prisma/enums";
import { prisma } from "./client";
import { record as recordAudit } from "./audit";
import { visible, type Actor } from "./scoped";

/**
 * The people in a company, and how one more gets added.
 *
 * Transient has no self-registration (see `createAuthAdapter`), so this module
 * is the only way a user comes into existence outside the seed. `can.manageUsers`
 * was written in section 8 and had no caller until this file.
 *
 * There is deliberately no `Invitation` model. A `User` row that has never set
 * a PIN and has never held a session *is* the pending invite, and the way in is
 * the magic-link flow that already exists. A second token system would be a
 * second thing to expire, revoke and rate-limit, and the first one is already
 * hardened against account enumeration in `deliverMagicLink`.
 */

/** Roles an admin picks from. `OWNER` is included but rank-gated below. */
export const ASSIGNABLE_ROLES = [
  Role.GUARD,
  Role.SUPERVISOR,
  Role.ADMIN,
  Role.OWNER,
] as const;

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Sites this person is assigned to. Empty for ADMIN/OWNER, who see all. */
  sites: { id: string; name: string; code: string }[];
  /**
   * True until they have set a PIN. The closest thing to "invite pending" that
   * the data actually supports, and it is the honest one: a PIN is what they
   * need before a shift, so this says "cannot work yet" rather than "has not
   * opened the email", which we do not know.
   */
  awaitingSetup: boolean;
  createdAt: Date;
  isSelf: boolean;
};

/**
 * Everyone in the actor's company.
 *
 * Scoped by `visible.user`, which is company-wide by design: an admin managing
 * a team has to see the guard who is not assigned anywhere yet, and that guard
 * would be invisible under a site-scoped read.
 *
 * Ordered by who needs attention. Someone who cannot sign in yet is the row an
 * admin opened this page for, so they come first; after that it is alphabetical
 * so a large team stays scannable.
 */
export async function listTeam(actor: Actor): Promise<TeamMemberRow[]> {
  const rows = await prisma.user.findMany({
    where: visible.user(actor),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      pinHash: true,
      createdAt: true,
      assignments: {
        select: { site: { select: { id: true, name: true, code: true } } },
      },
    },
  });

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      sites: row.assignments.map((a) => a.site),
      awaitingSetup: row.pinHash === null,
      createdAt: row.createdAt,
      isSelf: row.id === actor.userId,
    }))
    .sort((a, b) => {
      if (a.awaitingSetup !== b.awaitingSetup) return a.awaitingSetup ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export type InviteInput = {
  email: string;
  name: string;
  role: Role;
  siteIds: string[];
};

export type InviteResult =
  | { ok: true; userId: string; email: string; name: string }
  | { ok: false; error: string };

const RANK: Record<Role, number> = {
  [Role.GUARD]: 0,
  [Role.SUPERVISOR]: 1,
  [Role.ADMIN]: 2,
  [Role.OWNER]: 3,
};

/**
 * Creates the account and returns what the caller needs to send the email.
 *
 * Sending is deliberately not done here. This function owns one database
 * transaction and the rules that guard it; a mail provider that times out must
 * not be able to leave a half-created user behind, and an admin who never got
 * confirmation must not be tempted to click again and hit the unique index.
 *
 * Four rules, all enforced here rather than in the form, because a server
 * action is not the only thing that could ever call this:
 *
 * 1. `companyId` comes from the actor's session and is never accepted from
 *    input. It is the entire tenancy boundary.
 * 2. Nobody may invite above their own rank. Without this an ADMIN mints an
 *    OWNER at an address they control and has company settings and deletion a
 *    minute later, which is privilege escalation with an audit trail that
 *    looks like onboarding.
 * 3. Site assignments are filtered through `visible.site(actor)`, so a
 *    supervisor-shaped id from another company is dropped rather than written.
 * 4. The address is checked before the insert, so the global unique index on
 *    `User.email` surfaces as a sentence instead of a 500.
 */
export async function inviteUser(
  actor: Actor,
  input: InviteInput,
): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!name) return { ok: false, error: "Enter their name." };

  if (RANK[input.role] > RANK[actor.role]) {
    return { ok: false, error: "You cannot add someone above your own role." };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, companyId: true },
  });
  if (existing) {
    // Precise inside the company, vague outside it. The anonymous surfaces in
    // this codebase are enumeration-hardened on purpose (`deliverMagicLink`
    // answers identically for a real and a fake address); this one is not
    // anonymous. An admin who cannot be told "she is already on your team"
    // files a bug instead, and the alternative disclosure is one bit to a
    // signed-in business user. Cross-company still gets no name and no
    // company, so the oracle stops at "in use".
    return existing.companyId === actor.companyId
      ? { ok: false, error: `${existing.name} is already on your team.` }
      : { ok: false, error: "That address is already in use on Transient." };
  }

  // Filtering rather than rejecting: an id that is not visible is dropped and
  // the invite still lands. The admin sees the assigned sites on the list
  // afterwards, and a guard with no sites is a supported state anyway.
  const sites =
    input.siteIds.length > 0
      ? await prisma.site.findMany({
          where: { id: { in: input.siteIds }, ...visible.site(actor) },
          select: { id: true },
        })
      : [];

  const created = await prisma.user.create({
    data: {
      companyId: actor.companyId,
      email,
      name,
      role: input.role,
      assignments: { create: sites.map((site) => ({ siteId: site.id })) },
    },
    select: { id: true },
  });

  await recordAudit({
    companyId: actor.companyId,
    actorId: actor.userId,
    action: "user.invite",
    entityType: "User",
    entityId: created.id,
    metadata: { email, role: input.role, siteIds: sites.map((s) => s.id) },
  });

  return { ok: true, userId: created.id, email, name };
}

/** Sites an admin can assign an invite to, for the form. */
export async function assignableSites(actor: Actor) {
  return prisma.site.findMany({
    where: visible.site(actor),
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
}

/** What the invite email needs to name the sender, all of it server-side. */
export async function inviteContext(
  actor: Actor,
): Promise<{ companyName: string; inviterName: string }> {
  const [company, inviter] = await Promise.all([
    prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { name: true },
    }),
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    }),
  ]);
  return {
    companyName: company?.name ?? "your team",
    // Never taken from the form. This string is the "who added you" line the
    // recipient trusts, and a spoofable one makes the email a better phishing
    // template than an empty inbox.
    inviterName: inviter?.name ?? "An administrator",
  };
}
