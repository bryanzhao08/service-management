import { Role, SubscriptionStatus } from "@/generated/prisma/enums";
import type { SignUpInput } from "@/lib/auth/sign-up-token";
import { isPlanId, TRIAL_DAYS } from "@/lib/billing/plans";
import { DEFAULT_ENTRY_TYPES, siteCodeFromName } from "@/lib/sites/defaults";
import { record as recordAudit } from "./audit";
import { prisma } from "./client";

/**
 * Self-serve sign-up: the first company, the first owner and the first site,
 * in one transaction.
 *
 * `createAuthAdapter.createUser` still throws, and nothing here loosens it.
 * That guard exists to stop a magic link minting a user with no tenant, and it
 * keeps doing exactly that — this module creates the tenant and the user
 * together, which is the case the guard was always carving out for.
 *
 * All of it in one transaction because the partial states are all worse than
 * failing: a company with no owner is unreachable forever, an owner with no
 * site opens the app to an empty screen with no way to add one, and a site
 * with no entry types gives a guard nothing to tap.
 */

/** What the marketing CTA carries, when it carries anything. */
export function trialPlanId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Falling back to null rather than throwing. A stale or edited `?plan=` is
  // not worth failing a sign-up over, and null is a real supported state that
  // resolves to "trialing, plan not chosen yet".
  return isPlanId(raw) ? raw : null;
}

/**
 * A URL-safe company slug. Not shown anywhere yet, but `Company.slug` is
 * `@unique`, so it is the one field a new company can collide on.
 */
export function companySlugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // A company named entirely in a non-Latin script slugs to nothing, and an
  // empty string would collide with the next one that did the same.
  return slug || "company";
}

export type SignUpResult =
  | { created: true; userId: string; companyId: string }
  | { created: false; userId: string; companyId: string };

/**
 * Create everything, or return the existing account.
 *
 * The `created: false` branch is the replay guard. A sign-up link can be
 * clicked twice — mail clients prefetch, people double-tap, a link gets
 * forwarded — and the second click must not produce a second company. The
 * check is cheap, and `User.email @unique` is the backstop underneath it if
 * two clicks race.
 */
export async function createCompanyFromSignUp(
  input: SignUpInput,
  options: { planId?: string | null } = {},
): Promise<SignUpResult> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, companyId: true },
  });
  if (existing) {
    return {
      created: false,
      userId: existing.id,
      companyId: existing.companyId,
    };
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const baseSlug = companySlugFromName(input.companyName);

  const result = await prisma.$transaction(async (tx) => {
    // Resolve the slug inside the transaction so the read and the write see
    // the same rows. Bounded rather than a `while (true)`: 25 companies with
    // the same name is a signal something is wrong, and a suffixed cuid is a
    // working slug rather than a failed sign-up.
    let slug = baseSlug;
    for (let n = 2; n <= 25; n += 1) {
      const taken = await tx.company.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!taken) break;
      slug = `${baseSlug}-${n}`;
    }

    const company = await tx.company.create({
      data: {
        name: input.companyName,
        slug,
        planId: options.planId ?? null,
        // Trialing with no plan is a real state: they have 30 days and have
        // not picked a tier yet. `companySubscription` reads `inTrial` off the
        // status and the date alone, never off the plan.
        subscriptionStatus: SubscriptionStatus.TRIALING,
        trialEndsAt,
        currentPeriodEnd: trialEndsAt,
      },
      select: { id: true },
    });

    const site = await tx.site.create({
      data: {
        companyId: company.id,
        name: input.siteName,
        code: siteCodeFromName(input.siteName),
        address: input.siteAddress,
        timezone: input.timezone,
      },
      select: { id: true },
    });

    await tx.siteEntryType.createMany({
      data: DEFAULT_ENTRY_TYPES.map((type, order) => ({
        siteId: site.id,
        ...type,
        order,
      })),
    });

    const user = await tx.user.create({
      data: {
        companyId: company.id,
        email: input.email,
        name: input.name,
        role: Role.OWNER,
        // They got here by clicking a link sent to this address, which is the
        // same proof the magic-link flow accepts. Recording it means the
        // account is not asked to verify an address it just verified.
        emailVerified: new Date(),
        // An OWNER already sees every site in the company, so this row grants
        // nothing. It is written so the owner shows up on the site's roster
        // rather than the site looking unstaffed on day one.
        assignments: { create: { siteId: site.id } },
      },
      select: { id: true },
    });

    return { companyId: company.id, userId: user.id };
  });

  await recordAudit({
    companyId: result.companyId,
    actorId: result.userId,
    action: "company.create",
    entityType: "Company",
    entityId: result.companyId,
    metadata: {
      email: input.email,
      siteName: input.siteName,
      planId: options.planId ?? null,
    },
  });

  return { created: true, ...result };
}
