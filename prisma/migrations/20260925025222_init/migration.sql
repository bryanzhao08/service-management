-- CreateEnum
CREATE TYPE "Role" AS ENUM ('GUARD', 'SUPERVISOR', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "LoggingMode" AS ENUM ('FULL', 'LIGHT', 'VERBAL');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'NOTE', 'MEDIA', 'INCIDENT', 'PACKAGE', 'PATROL', 'PROPERTY_CHECK', 'BLIND_SPOT_CHECK', 'BREAK_COVER_START', 'BREAK_COVER_END', 'HANDOFF_GIVEN', 'HANDOFF_RECEIVED', 'VISITOR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ONGOING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'UPLOADED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'SENDING', 'SENT', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNCONFIRMED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('GENERATE_REPORT', 'SEND_REPORT', 'PROCESS_MEDIA', 'VERIFY_RECIPIENT', 'SEND_PUSH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "BlindSpotMethod" AS ENUM ('PHOTO', 'CAMERA_ROOM', 'PATROL', 'NOT_CHECKED');

-- CreateEnum
CREATE TYPE "PropertyCheckResult" AS ENUM ('CLEAR', 'DAMAGE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'DARK', 'LIGHT');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'GUARD',
    "pinHash" TEXT,
    "largeText" BOOLEAN NOT NULL DEFAULT false,
    "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "dictationLang" TEXT NOT NULL DEFAULT 'en-US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "loggingMode" "LoggingMode" NOT NULL DEFAULT 'FULL',
    "footerDisclaimer" TEXT,
    "includeLocation" BOOLEAN NOT NULL DEFAULT false,
    "sendIndividually" BOOLEAN NOT NULL DEFAULT true,
    "replyToGuard" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAssignment" (
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAssignment_pkey" PRIMARY KEY ("userId","siteId")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlindSpot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "referenceMediaId" TEXT,
    "requiredAtClockIn" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BlindSpot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEntryType" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SiteEntryType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftTemplate" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "requirePropertyCheck" BOOLEAN NOT NULL DEFAULT true,
    "requireBlindSpots" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "headerText" TEXT,
    "maxPhotosPerIncident" INTEGER NOT NULL DEFAULT 6,
    "maxPhotosPerEntry" INTEGER NOT NULL DEFAULT 3,
    "embedPhotos" BOOLEAN NOT NULL DEFAULT true,
    "coverPage" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecipientStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifyToken" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastBounceAt" TIMESTAMP(3),
    "lastBounceReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "guardId" TEXT NOT NULL,
    "templateId" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "isEventNight" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "handoffNote" TEXT,
    "handoffFromShiftId" TEXT,
    "endFlowStartedAt" TIMESTAMP(3),
    "endFlowCompletedAt" TIMESTAMP(3),
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "EntryType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "text" TEXT,
    "transcriptRaw" TEXT,
    "areaId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deleteReason" TEXT,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryRevision" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "siteEntryTypeId" TEXT,
    "severity" "Severity",
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "ongoingSince" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "recipientName" TEXT,
    "room" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveredTo" TEXT,
    "signatureMediaId" TEXT,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlindSpotCheck" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "blindSpotId" TEXT NOT NULL,
    "method" "BlindSpotMethod" NOT NULL,
    "verifiedById" TEXT,
    "reason" TEXT,
    "mediaId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlindSpotCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyCheck" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "result" "PropertyCheckResult" NOT NULL,
    "note" TEXT,
    "mediaId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "entryId" TEXT,
    "kind" "MediaKind" NOT NULL DEFAULT 'PHOTO',
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "storageKeyOriginal" TEXT NOT NULL,
    "storageKeyThumb" TEXT,
    "storageKeyPdf" TEXT,
    "posterKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "exif" JSONB,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "storageKey" TEXT,
    "bytes" INTEGER,
    "pages" INTEGER,
    "sha256" TEXT,
    "sizeSteps" JSONB,
    "generatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "recipientId" TEXT,
    "email" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "statusAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bounceReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_companyId_role_idx" ON "User"("companyId", "role");

-- CreateIndex
CREATE INDEX "Site_companyId_idx" ON "Site"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_companyId_code_key" ON "Site"("companyId", "code");

-- CreateIndex
CREATE INDEX "SiteAssignment_siteId_idx" ON "SiteAssignment"("siteId");

-- CreateIndex
CREATE INDEX "Area_siteId_idx" ON "Area"("siteId");

-- CreateIndex
CREATE INDEX "BlindSpot_siteId_idx" ON "BlindSpot"("siteId");

-- CreateIndex
CREATE INDEX "BlindSpot_referenceMediaId_idx" ON "BlindSpot"("referenceMediaId");

-- CreateIndex
CREATE INDEX "SiteEntryType_siteId_idx" ON "SiteEntryType"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteEntryType_siteId_key_key" ON "SiteEntryType"("siteId", "key");

-- CreateIndex
CREATE INDEX "ShiftTemplate_siteId_idx" ON "ShiftTemplate"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_siteId_key" ON "ReportTemplate"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_verifyToken_key" ON "Recipient"("verifyToken");

-- CreateIndex
CREATE INDEX "Recipient_siteId_idx" ON "Recipient"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_siteId_email_key" ON "Recipient"("siteId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_clientId_key" ON "Shift"("clientId");

-- CreateIndex
CREATE INDEX "Shift_siteId_scheduledStart_idx" ON "Shift"("siteId", "scheduledStart");

-- CreateIndex
CREATE INDEX "Shift_guardId_idx" ON "Shift"("guardId");

-- CreateIndex
CREATE INDEX "Shift_templateId_idx" ON "Shift"("templateId");

-- CreateIndex
CREATE INDEX "Shift_handoffFromShiftId_idx" ON "Shift"("handoffFromShiftId");

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_clientId_key" ON "Entry"("clientId");

-- CreateIndex
CREATE INDEX "Entry_shiftId_occurredAt_idx" ON "Entry"("shiftId", "occurredAt");

-- CreateIndex
CREATE INDEX "Entry_areaId_idx" ON "Entry"("areaId");

-- CreateIndex
CREATE INDEX "Entry_type_idx" ON "Entry"("type");

-- CreateIndex
CREATE INDEX "EntryRevision_entryId_idx" ON "EntryRevision"("entryId");

-- CreateIndex
CREATE INDEX "EntryRevision_editedById_idx" ON "EntryRevision"("editedById");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_entryId_key" ON "Incident"("entryId");

-- CreateIndex
CREATE INDEX "Incident_code_idx" ON "Incident"("code");

-- CreateIndex
CREATE INDEX "Incident_siteEntryTypeId_idx" ON "Incident"("siteEntryTypeId");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Package_entryId_key" ON "Package"("entryId");

-- CreateIndex
CREATE INDEX "Package_signatureMediaId_idx" ON "Package"("signatureMediaId");

-- CreateIndex
CREATE INDEX "BlindSpotCheck_shiftId_idx" ON "BlindSpotCheck"("shiftId");

-- CreateIndex
CREATE INDEX "BlindSpotCheck_blindSpotId_idx" ON "BlindSpotCheck"("blindSpotId");

-- CreateIndex
CREATE INDEX "BlindSpotCheck_verifiedById_idx" ON "BlindSpotCheck"("verifiedById");

-- CreateIndex
CREATE INDEX "BlindSpotCheck_mediaId_idx" ON "BlindSpotCheck"("mediaId");

-- CreateIndex
CREATE INDEX "PropertyCheck_shiftId_idx" ON "PropertyCheck"("shiftId");

-- CreateIndex
CREATE INDEX "PropertyCheck_areaId_idx" ON "PropertyCheck"("areaId");

-- CreateIndex
CREATE INDEX "PropertyCheck_mediaId_idx" ON "PropertyCheck"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_clientId_key" ON "Media"("clientId");

-- CreateIndex
CREATE INDEX "Media_shiftId_idx" ON "Media"("shiftId");

-- CreateIndex
CREATE INDEX "Media_entryId_idx" ON "Media"("entryId");

-- CreateIndex
CREATE INDEX "Media_status_idx" ON "Media"("status");

-- CreateIndex
CREATE INDEX "Report_shiftId_idx" ON "Report"("shiftId");

-- CreateIndex
CREATE INDEX "Report_generatedById_idx" ON "Report"("generatedById");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Report_shiftId_version_key" ON "Report"("shiftId", "version");

-- CreateIndex
CREATE INDEX "ReportDelivery_reportId_idx" ON "ReportDelivery"("reportId");

-- CreateIndex
CREATE INDEX "ReportDelivery_recipientId_idx" ON "ReportDelivery"("recipientId");

-- CreateIndex
CREATE INDEX "ReportDelivery_providerMessageId_idx" ON "ReportDelivery"("providerMessageId");

-- CreateIndex
CREATE INDEX "ReportDelivery_status_idx" ON "ReportDelivery"("status");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_at_idx" ON "AuditEvent"("companyId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_type_idx" ON "Job"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssignment" ADD CONSTRAINT "SiteAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssignment" ADD CONSTRAINT "SiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpot" ADD CONSTRAINT "BlindSpot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpot" ADD CONSTRAINT "BlindSpot_referenceMediaId_fkey" FOREIGN KEY ("referenceMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEntryType" ADD CONSTRAINT "SiteEntryType_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShiftTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_handoffFromShiftId_fkey" FOREIGN KEY ("handoffFromShiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryRevision" ADD CONSTRAINT "EntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryRevision" ADD CONSTRAINT "EntryRevision_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_siteEntryTypeId_fkey" FOREIGN KEY ("siteEntryTypeId") REFERENCES "SiteEntryType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_signatureMediaId_fkey" FOREIGN KEY ("signatureMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpotCheck" ADD CONSTRAINT "BlindSpotCheck_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpotCheck" ADD CONSTRAINT "BlindSpotCheck_blindSpotId_fkey" FOREIGN KEY ("blindSpotId") REFERENCES "BlindSpot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpotCheck" ADD CONSTRAINT "BlindSpotCheck_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlindSpotCheck" ADD CONSTRAINT "BlindSpotCheck_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCheck" ADD CONSTRAINT "PropertyCheck_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCheck" ADD CONSTRAINT "PropertyCheck_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCheck" ADD CONSTRAINT "PropertyCheck_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
