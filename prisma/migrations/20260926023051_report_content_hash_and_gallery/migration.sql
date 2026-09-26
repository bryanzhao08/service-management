-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "galleryExpiresAt" TIMESTAMP(3),
ADD COLUMN     "galleryToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Report_galleryToken_key" ON "Report"("galleryToken");

