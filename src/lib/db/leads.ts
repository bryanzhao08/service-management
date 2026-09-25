import { prisma } from "./client";

/**
 * The only write in the app that is deliberately **not** company-scoped.
 *
 * A `Lead` is a row about someone who is not a customer yet, submitted from the
 * public landing page with no session. There is no `companyId` to scope it by,
 * so `db(actor)` cannot express it.
 *
 * It lives here rather than as a raw `prisma` call in the server action so the
 * exemption is one named function in `lib/db/**` that a reviewer can find,
 * instead of a loose client in the app directory that looks like every other
 * query. `Lead` is also referenced nowhere else, so nothing tenant-owned can be
 * reached through this path.
 */
export async function createLead(input: {
  name: string;
  email: string;
  company: string;
  message: string;
}): Promise<void> {
  await prisma.lead.create({ data: input });
}
