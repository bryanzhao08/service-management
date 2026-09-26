import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Wordmark } from "@/components/brand";
import { ReportReceipt } from "@/components/report/report-receipt";
import { receiptData } from "@/lib/db/receipt";
import { verifyReceiptToken } from "@/lib/storage/tokens";

export const metadata: Metadata = {
  title: "Report receipt",
  // A bearer link. Keeping it out of search indexes is the cheap half of not
  // leaking it; the expiry on the token is the half that actually binds.
  robots: { index: false, follow: false },
};

/**
 * The signed receipt link from section 9.5: a manager opens it with no account.
 *
 * Read-only by construction — there is nothing on this page to act on, and no
 * session is created, so holding the link never becomes holding an account.
 * The PDF is deliberately *not* offered here: the receipt says what was sent
 * and to whom, which is what the link is for, while the report itself contains
 * the photos and the incident detail and should follow the email it was
 * attached to.
 */
export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const claims = verifyReceiptToken(token);
  // An expired link and a forged one both land here. That is on purpose: a
  // distinct "this link expired" message would confirm to someone guessing
  // that they had guessed a real report id.
  if (!claims) notFound();

  const data = await receiptData(claims.reportId);
  if (!data) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 pb-16">
      <header className="flex flex-col gap-1">
        <Wordmark className="h-6 w-auto" />
        <p className="text-sm text-text-muted">
          Delivery receipt for {data.companyName} at {data.siteName}. Read-only.
        </p>
      </header>

      <ReportReceipt data={data} pdfHref={null} galleryHref={null} />

      <p className="text-xs text-text-muted">
        This link was shared by {data.companyName}. It shows delivery status only, not
        the report itself.
      </p>
    </main>
  );
}
