import { NextResponse } from "next/server";

import { requireUnlockedActor } from "@/lib/auth/guards";
import {
  auditCsv,
  auditEventsForExport,
  canViewAudit,
  parseAuditDay,
} from "@/lib/db/audit";
import { companyHasEntitlement } from "@/lib/db/billing";
import { csvFilename, csvResponseHeaders } from "@/lib/export/csv";

/**
 * `GET /api/audit/export` — the bulk audit-log export.
 *
 * Two gates, in this order, because they answer different questions and only
 * one of them is safe to answer honestly. `canViewAudit` decides whether this
 * person may see the log at all and returns 404, exactly as the page does, so
 * a plan response can never confirm to a guard that a company audit log
 * exists. Only once someone is allowed to see it does the plan get a say.
 *
 * The 402 is the only one in the app. This is the one place where the honest
 * answer really is "your plan does not include this", and saying that plainly
 * beats a 403 that reads like a broken permission. Nothing in
 * `ALWAYS_INCLUDED` can reach this path: reading the log on screen is never
 * gated, only bulk extraction of it is.
 */
export async function GET(request: Request) {
  const actor = await requireUnlockedActor();
  if (!canViewAudit(actor)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!(await companyHasEntitlement(actor.companyId, "audit_export"))) {
    return NextResponse.json(
      {
        error: "Bulk audit export is part of the Assurance plan and up.",
        code: "PLAN_REQUIRED",
        entitlement: "audit_export",
      },
      { status: 402 },
    );
  }

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) || undefined;

  // The same keys the page reads, so whatever was filtered on screen is what
  // lands in the file.
  const { rows, truncated } = await auditEventsForExport(actor, {
    action: get("action"),
    actorId: get("actor"),
    entityType: get("entity"),
    from: parseAuditDay(get("from")),
    to: parseAuditDay(get("to"), true),
  });

  return new NextResponse(auditCsv(rows), {
    headers: {
      ...csvResponseHeaders(csvFilename("transient-audit")),
      // A header, not a row appended to the file: a trailing "truncated" line
      // inside a CSV becomes a data row in every spreadsheet that opens it.
      "X-Transient-Truncated": truncated ? "true" : "false",
    },
  });
}
