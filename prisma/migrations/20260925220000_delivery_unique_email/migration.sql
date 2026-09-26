-- One delivery row per address per report.
--
-- The existing unique is on (reportId, recipientId), which cannot cover a
-- one-off CC: those carry a null recipientId and Postgres treats every NULL as
-- distinct, so a retried send would insert a second row for the same person and
-- leave two contradictory delivery states for one email.
CREATE UNIQUE INDEX "ReportDelivery_reportId_email_key" ON "ReportDelivery"("reportId", "email");
