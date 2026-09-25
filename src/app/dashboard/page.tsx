import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUnlockedActor } from "@/lib/auth/guards";
import { db } from "@/lib/db/scoped";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Placeholder. The real dashboard — guard start-shift card, supervisor site
 * table, delivery chips — is milestone 4 onward (section 9.1).
 *
 * It exists now because milestone 2's claim is that the auth chain works end to
 * end, and "works" means a signed-in, unlocked user reaching a page that reads
 * their own company's data through the scoped layer. Without a destination
 * there is nothing to verify.
 */
export default async function DashboardPage() {
  const actor = await requireUnlockedActor();
  const scoped = db(actor);
  const [sites, me] = await Promise.all([
    scoped.site.findMany(),
    scoped.user.findById(actor.userId),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-text">{me?.name ?? "Signed in"}</h1>
        <p className="text-sm text-text-muted">
          {actor.role.toLowerCase()} · {sites.length}{" "}
          {sites.length === 1 ? "site" : "sites"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your sites</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {sites.map((site) => (
              <li key={site.id} className="flex justify-between py-3">
                <span className="text-text">{site.name}</span>
                <span className="font-mono text-sm text-text-muted">{site.code}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
