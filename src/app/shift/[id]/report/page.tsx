import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";

import { CopyReceiptLink } from "@/components/report/copy-receipt-link";
import { ReportReceipt } from "@/components/report/report-receipt";
import { RevokeGallery } from "@/components/report/revoke-gallery";
import { Button } from "@/components/ui/button";
import { can, requireUnlockedActor } from "@/lib/auth/guards";
import { latestReportId, receiptData } from "@/lib/db/receipt";
import { db } from "@/lib/db/scoped";

export const metadata: Metadata = { title: "Report" };

/**
 * Section 9.5. The screen a guard opens when someone asks "did they get it".
 *
 * Always shows the newest version, because "the report" in that conversation
 * means the one that went out last. Older versions are listed rather than
 * hidden, since a correction does not erase what the client already received.
 */
export default async function ReportReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const actor = await requireUnlockedActor();
  const scoped = db(actor);

  // The scoped read is the authorisation gate; `receiptData` below is
  // deliberately unscoped so the public link can reuse it, which means this
  // page must never call it on an id it has not already proven access to.
  const reports = await scoped.report.listForShift(id);
  if (reports.length === 0) notFound();

  const chosen = v
    ? (reports.find((r) => String(r.version) === v) ?? null)
    : (reports[0] ?? null);
  if (!chosen) notFound();

  const reportId = chosen.id ?? (await latestReportId(id));
  if (!reportId) notFound();

  const data = await receiptData(reportId);
  if (!data) notFound();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-16">
      <header className="flex items-center gap-3">
        <Link
          href={`/shift/${id}`}
          className="text-text-muted hover:text-text"
          aria-label="Back to the shift"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Report receipt</h1>
          <p className="text-sm text-text-muted">{data.siteName}</p>
        </div>
      </header>

      <ReportReceipt
        data={data}
        pdfHref={`/api/reports/${data.reportId}/pdf`}
        galleryHref={
          // Read off the scoped row rather than threaded through `receiptData`,
          // which the public link also calls. The token is a bearer credential
          // and has no business travelling anywhere it isn't rendered.
          data.hasGallery && chosen.galleryToken ? `/g/${chosen.galleryToken}` : null
        }
        actions={
          <Button variant="secondary" asChild>
            <a
              href={`/api/reports/${data.reportId}/receipt`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileDown className="size-4" aria-hidden="true" />
              Download receipt PDF
            </a>
          </Button>
        }
      />

      <CopyReceiptLink reportId={data.reportId} />

      {can.configureSite(actor) && data.hasGallery && chosen.galleryToken ? (
        <div className="border-rule border-t pt-4">
          <RevokeGallery reportId={data.reportId} />
        </div>
      ) : null}
    </main>
  );
}
