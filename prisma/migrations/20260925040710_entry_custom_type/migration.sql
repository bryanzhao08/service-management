-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "siteEntryTypeId" TEXT;

-- CreateIndex
CREATE INDEX "Entry_siteEntryTypeId_idx" ON "Entry"("siteEntryTypeId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_siteEntryTypeId_fkey" FOREIGN KEY ("siteEntryTypeId") REFERENCES "SiteEntryType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
