import { rollUpReportStatus } from "@/lib/db/deliveries";

/**
 * Called after a webhook moves a delivery. One job: roll the report's own
 * status up from its deliveries.
 *
 * It writes no audit event -- `applyDeliveryWebhook` already wrote one for the
 * delivery itself, and a second row saying the same thing would make the audit
 * trail count every bounce twice.
 *
 * This is also the single place milestone 10 hangs the "delivered to everyone"
 * push off, so the push cannot drift from the condition that decides status.
 */

type Applied = {
  delivery: { id: string; reportId: string; status: string };
  report: { id: string; status: string };
};

export async function notifyDelivery(
  applied: Applied,
): Promise<{ reportStatus: string; complete: boolean }> {
  return rollUpReportStatus(applied.report.id, applied.report.status);
}
