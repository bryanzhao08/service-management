"use server";

import { revalidatePath } from "next/cache";

import { requireUnlockedActor } from "@/lib/auth/guards";
import { record as recordAudit } from "@/lib/db/audit";
import { enqueue } from "@/lib/db/jobs";
import { db } from "@/lib/db/scoped";
import { producesReport } from "@/lib/sites/logging-mode";
import type { LoggingMode } from "@/generated/prisma/enums";
import {
  addOneOffDelivery,
  endEndFlow,
  findEndFlowShift,
  writeSummary,
} from "@/lib/db/shift-end";

/**
 * Section 9.4. The four steps that end a shift.
 *
 * Each step is its own action rather than one submit at the end, because the
 * guard is explicitly allowed to walk away after step 3 and the flow has to
 * survive the tab closing between any two of them. That also means every
 * action must be safe to run twice: a guard on bad hotel wifi taps "Build
 * report" again the moment nothing appears to happen.
 */

export type EndState = { error: string | null; ok?: boolean };

/**
 * Only the guard working the shift can end it.
 *
 * A supervisor can read it (section 8) but not clock it out: clock-out is a
 * statement about where a specific person physically was, and nobody else can
 * make that statement for them.
 */
async function ownShift(shiftId: string) {
  const actor = await requireUnlockedActor();
  const shift = await db(actor).shift.findByIdWithSite(shiftId);
  if (!shift) return { error: "That shift is not available." };
  if (shift.guardId !== actor.userId) {
    return { error: "Only the guard on this shift can end it." };
  }
  return { actor, shift, error: null };
}

/**
 * The site declined a report, so there is nothing here to build or send.
 *
 * This is checked server-side and not only by hiding the buttons, because a
 * `"use server"` export is a live POST endpoint whether or not anything on
 * screen points at it. The middle school in the research asked for verbal
 * handover; the failure this prevents is us emailing a document about a school
 * to a list that school never agreed to.
 */
function refusesReports(shift: { site: { loggingMode: LoggingMode } }): string | null {
  if (producesReport(shift.site.loggingMode)) return null;
  return "This site is set to verbal handover, so shifts here do not produce a report.";
}

/** Step 1 save. The shift summary and the handoff note for the next guard. */
export async function saveSummary(
  shiftId: string,
  input: { summary: string; handoffNote: string },
): Promise<EndState> {
  const owned = await ownShift(shiftId);
  if (owned.error) return { error: owned.error };

  await writeSummary(shiftId, {
    summary: input.summary.trim() || null,
    handoffNote: input.handoffNote.trim() || null,
  });
  revalidatePath(`/shift/${shiftId}/end`);
  return { error: null, ok: true };
}

/**
 * Step 2. Enqueue the build.
 *
 * A build already in flight is left alone instead of being joined by a second
 * one, so a double tap does not produce two versions of the same night. A
 * *finished* report is different: re-running after clock-out is the documented
 * correction path, and that is supposed to make a new version.
 */
export async function buildReport(shiftId: string): Promise<EndState> {
  const owned = await ownShift(shiftId);
  if (owned.error) return { error: owned.error };

  const refused = refusesReports(owned.shift!);
  if (refused) return { error: refused };

  const state = await findEndFlowShift(shiftId);
  if (state?.buildInFlight) return { error: null, ok: true };

  await enqueue("GENERATE_REPORT", { shiftId, requestedById: owned.actor!.userId });
  // Audited here rather than in the handler: the handler runs later on
  // whichever process picks the job up and has no session, so "who asked for
  // this report" is only knowable at this point.
  await recordAudit({
    companyId: owned.actor!.companyId,
    actorId: owned.actor!.userId,
    action: "report.generate",
    entityType: "Shift",
    entityId: shiftId,
  });
  revalidatePath(`/shift/${shiftId}/end`);
  return { error: null, ok: true };
}

/**
 * Step 3. Enqueue the send.
 *
 * The handler only sends to QUEUED and FAILED delivery rows, so a retry here
 * costs a job row, never a second copy in somebody's inbox.
 */
export async function sendReport(shiftId: string, reportId: string): Promise<EndState> {
  const owned = await ownShift(shiftId);
  if (owned.error) return { error: owned.error };

  const refused = refusesReports(owned.shift!);
  if (refused) return { error: refused };

  const report = await db(owned.actor!).report.findById(reportId);
  if (!report || report.shiftId !== shiftId) {
    return { error: "That report is not available." };
  }
  if (!report.storageKey) {
    return { error: "The report has not finished building yet." };
  }

  await enqueue("SEND_REPORT", { reportId });
  revalidatePath(`/shift/${shiftId}/end`);
  return { error: null, ok: true };
}

/**
 * A one-off CC, section 9.4 step 3.
 *
 * Deliberately not a `Recipient` row: "CC my regional manager on tonight's
 * report" is not the same statement as "this address gets every report from
 * this site forever", and quietly turning the first into the second is how a
 * guard accidentally subscribes someone to a year of 6am email.
 */
export async function addOneOffRecipient(
  shiftId: string,
  reportId: string,
  email: string,
): Promise<EndState> {
  const owned = await ownShift(shiftId);
  if (owned.error) return { error: owned.error };

  const refused = refusesReports(owned.shift!);
  if (refused) return { error: refused };

  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { error: "That does not look like an email address." };
  }

  const report = await db(owned.actor!).report.findById(reportId);
  if (!report || report.shiftId !== shiftId) {
    return { error: "That report is not available." };
  }

  const added = await addOneOffDelivery(reportId, address);
  if (!added) return { error: "That address is already on this report." };

  await recordAudit({
    companyId: owned.actor!.companyId,
    actorId: owned.actor!.userId,
    action: "recipient.add",
    entityType: "Report",
    entityId: reportId,
    metadata: { email: address, oneOff: true },
  });
  revalidatePath(`/shift/${shiftId}/end`);
  return { error: null, ok: true };
}

/**
 * Step 4. Clock out.
 *
 * The CLOCK_OUT entry and the shift close happen together: a shift marked
 * ENDED with no closing entry leaves a hole in the timeline exactly where the
 * record of when the guard left the property should be.
 */
export async function clockOut(shiftId: string): Promise<EndState> {
  const owned = await ownShift(shiftId);
  if (owned.error) return { error: owned.error };
  if (owned.shift!.clockOutAt) return { error: null, ok: true };

  const now = new Date();
  await db(owned.actor!).entry.upsert({
    shiftId,
    // Deterministic, so a retry after a lost response reuses the same row
    // instead of stacking a second clock-out onto the timeline.
    clientId: `clockout-${shiftId}`,
    type: "CLOCK_OUT",
    occurredAt: now,
    text: "Clocked out",
  });
  await endEndFlow(shiftId, now);
  await recordAudit({
    companyId: owned.actor!.companyId,
    actorId: owned.actor!.userId,
    action: "shift.end",
    entityType: "Shift",
    entityId: shiftId,
    at: now,
  });

  revalidatePath(`/shift/${shiftId}`);
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}
