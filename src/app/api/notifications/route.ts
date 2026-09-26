import { NextResponse } from "next/server";
import { z } from "zod";

import { currentActor } from "@/lib/auth/guards";
import { listForUser, markRead, unreadCount } from "@/lib/db/notifications";

/**
 * `GET /api/notifications` and `POST` to mark read (section 13).
 *
 * The bell polls this. Both halves filter on the session's own `userId` inside
 * the data layer rather than accepting one from the caller, which is what
 * makes "mark all read" safe to expose as a body-less POST.
 */

export const runtime = "nodejs";

const markSchema = z.object({
  // Absent means "everything unread". Present means exactly these, which is
  // what clicking a single row sends.
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

export async function GET() {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const [items, unread] = await Promise.all([
    listForUser(actor.userId),
    unreadCount(actor.userId),
  ]);

  return NextResponse.json(
    {
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        url: n.url,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
    },
    // Never cached. A bell showing a count from thirty seconds ago is a bell
    // that tells a guard their report bounced after they have driven home.
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const actor = await currentActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = markSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const marked = await markRead({
    userId: actor.userId,
    ...(parsed.data.ids ? { ids: parsed.data.ids } : {}),
  });
  const unread = await unreadCount(actor.userId);
  return NextResponse.json({ ok: true, marked, unread });
}
