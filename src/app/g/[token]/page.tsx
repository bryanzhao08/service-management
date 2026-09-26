import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Wordmark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { galleryByToken } from "@/lib/db/gallery";
import { formatDateTimeArchival } from "@/lib/time";

export const metadata: Metadata = {
  title: "Shift photos",
  robots: { index: false, follow: false },
};

/**
 * The gallery the report links to when photos did not fit inside the 8 MB cap
 * (section 11).
 *
 * Plain <img> rather than next/image on purpose: every source here is a signed
 * URL that expires, and putting those through the optimiser would cache a
 * rewritten copy of private evidence under a public /_next/image path.
 */
export default async function GalleryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await galleryByToken(token);
  // Expired and forged both 404. Distinguishing them would tell someone
  // guessing tokens when they had guessed a real one.
  if (!data) notFound();

  const at = (when: Date | null) =>
    when ? formatDateTimeArchival(when, data.timeZone) : "—";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-16">
      <header className="flex flex-col gap-1">
        <Wordmark className="h-6 w-auto" />
        <h1 className="text-lg font-semibold">
          {data.siteName} &middot; v{data.version}
        </h1>
        <p className="text-sm text-text-muted">
          {data.companyName} &middot; {at(data.shiftStart)} &rarr; {at(data.shiftEnd)}
        </p>
        <p className="text-xs text-text-muted">
          {data.items.length} item{data.items.length === 1 ? "" : "s"}
          {data.expiresAt ? ` · link expires ${at(data.expiresAt)}` : ""}
        </p>
      </header>

      {data.items.length === 0 ? (
        <p className="text-sm text-text-muted">
          No photos were captured on this shift.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {data.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <a
                href={item.fullUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden rounded-md border bg-surface"
              >
                {item.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbUrl}
                    alt={item.caption ?? `Photo taken ${at(item.capturedAt)}`}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs text-text-muted">
                    Unavailable
                  </span>
                )}
              </a>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-text-muted tabular-nums">
                  {at(item.capturedAt)}
                </span>
                {item.incidentCode ? (
                  <Badge tone="outline" className="font-mono text-[10px]">
                    {item.incidentCode}
                  </Badge>
                ) : null}
              </div>
              {item.caption ? (
                <p className="line-clamp-2 text-xs">{item.caption}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-muted">
        Shared by {data.companyName}. Images open in a new tab and their links expire.
      </p>
    </main>
  );
}
