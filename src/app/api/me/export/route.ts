import { NextResponse } from "next/server";

import { requireUnlockedActor } from "@/lib/auth/guards";
import { csvFilename, csvResponseHeaders } from "@/lib/export/csv";
import { entriesCsv, entriesJson, myEntries } from "@/lib/export/entries";

/**
 * `GET /api/me/export?format=json|csv` — section 9.10.
 *
 * One route rather than two, because the two formats must always answer from
 * the same query. Split across separate routes they drift: someone widens the
 * JSON select and the CSV quietly keeps exporting the old column set, and the
 * person reconciling them has no reason to suspect it.
 *
 * No role gate. This returns only the requesting user's own entries, so the
 * session is the authorisation.
 */
export async function GET(request: Request) {
  const actor = await requireUnlockedActor();
  const format = new URL(request.url).searchParams.get("format") ?? "json";

  if (format === "csv") {
    const rows = await myEntries(actor);
    return new NextResponse(entriesCsv(rows), {
      headers: csvResponseHeaders(csvFilename("transient-my-entries")),
    });
  }

  if (format !== "json") {
    return NextResponse.json(
      { error: "Ask for format=json or format=csv." },
      { status: 400 },
    );
  }

  const payload = await entriesJson(actor);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("transient-my-entries").replace(/\.csv$/, ".json")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
