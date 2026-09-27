import type { Metadata } from "next";
import Link from "next/link";

import { AppChrome } from "@/components/app-chrome";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Role } from "@/generated/prisma/enums";
import { atLeast, can, requireUnlockedActor } from "@/lib/auth/guards";
import { assignableSites, listTeam } from "@/lib/db/team";
import { notFound } from "next/navigation";

import { InviteForm, type RoleOption } from "./invite-form";

export const metadata: Metadata = { title: "Team" };

const ROLE_COPY: Record<Role, { label: string; hint: string }> = {
  [Role.GUARD]: { label: "Guard", hint: "works shifts at assigned sites" },
  [Role.SUPERVISOR]: { label: "Supervisor", hint: "plus configures those sites" },
  [Role.ADMIN]: { label: "Admin", hint: "all sites, manages people" },
  [Role.OWNER]: { label: "Owner", hint: "plus billing and company settings" },
};

/**
 * The team screen (section 8).
 *
 * Transient has no self-registration, so this page is the only way a person
 * joins a company. That makes it the thing the sign-in page has always
 * promised — "accounts are created by your supervisor" — and until now could
 * not deliver.
 *
 * `notFound` rather than a forbidden page, matching `requireRole`: a guard who
 * pokes at this URL should not learn that a team screen exists.
 */
export default async function TeamPage() {
  const actor = await requireUnlockedActor();
  if (!can.manageUsers(actor)) notFound();

  const [team, sites] = await Promise.all([listTeam(actor), assignableSites(actor)]);

  // Only roles at or below the actor's own. The server refuses anything higher
  // anyway; offering it here would just be a button that always fails.
  const roles: RoleOption[] = (
    [Role.GUARD, Role.SUPERVISOR, Role.ADMIN, Role.OWNER] as const
  )
    .filter((role) => atLeast(actor.role, role))
    .map((role) => ({ value: role, ...ROLE_COPY[role] }));

  const awaiting = team.filter((member) => member.awaitingSetup).length;

  return (
    <>
      <AppChrome />
      <main className="mx-auto max-w-2xl space-y-6 px-4 pb-16" data-team-page>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-text">Team</h1>
          <p className="text-sm text-text-muted">
            {team.length} {team.length === 1 ? "person" : "people"}
            {awaiting > 0 ? `, ${awaiting} not set up yet` : ""}.{" "}
            <Link href="/settings" className="underline">
              Back to settings
            </Link>
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Add someone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-muted">
              They get an email telling them they have been added. It does not sign
              them in on its own — they request a link from the sign-in page and pick
              a PIN, so a mistyped address never becomes a working account.
            </p>
            <InviteForm roles={roles} sites={sites} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Everyone</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {team.map((member) => (
                <li
                  key={member.id}
                  className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
                  data-team-member
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-text">
                      {member.name}
                      {member.isSelf ? (
                        <span className="text-text-muted"> (you)</span>
                      ) : null}
                    </p>
                    <p className="break-all text-sm text-text-muted">{member.email}</p>
                    {member.sites.length > 0 ? (
                      <p className="text-sm text-text-muted">
                        {member.sites.map((site) => site.name).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {member.awaitingSetup ? (
                      // Says what is true and knowable. We cannot tell whether
                      // the email was opened, only that no PIN exists yet, and
                      // no PIN is exactly what stops them working a shift.
                      <Badge tone="attention">No PIN yet</Badge>
                    ) : null}
                    <Badge tone="neutral">{ROLE_COPY[member.role].label}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <p className="text-sm text-text-muted">
          Removing someone and changing a role are not built yet. Deleting a user
          would cascade to their shifts, entries and reports, and those are the
          evidence record — that needs a deactivation flag, not a delete button.
        </p>
      </main>
    </>
  );
}
