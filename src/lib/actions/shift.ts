"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  BlindSpotMethod,
  EntryType,
  PropertyCheckResult,
} from "@/generated/prisma/enums";
import { requireActor } from "@/lib/auth/guards";
import { NotVisibleError, db } from "@/lib/db/scoped";

/**
 * Shift lifecycle actions (section 16).
 *
 * Every one of these is reachable offline and replayed by the outbox, so every
 * one is idempotent on a client-generated key. The caller decides the identity
 * of the thing it is creating before it knows whether the network is up;
 * replaying a clock-in must produce the same shift, not a second one.
 *
 * None of these touch Prisma. Tenancy lives in `lib/db/scoped`, and the lint
 * rule forbidding the raw client outside `lib/db/**` is what keeps that true.
 */

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: string; message: string };

function failure(code: string, message: string): ActionResult<never> {
  return { ok: false, code, message };
}

/**
 * Turns `NotVisibleError` into the same answer a missing row produces, so a
 * cross-company probe cannot tell "exists but not yours" from "does not
 * exist". Anything else re-throws: swallowing unknown errors here would turn a
 * database outage into a polite "not found" and hide a real fault.
 */
async function guarded<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof NotVisibleError) {
      return failure("NOT_FOUND", "That is no longer available to you.");
    }
    throw error;
  }
}

/** Offline replay means client ids are attacker-controlled. Keep them opaque. */
const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

// ---------------------------------------------------------------------------
// Clock in
// ---------------------------------------------------------------------------

const startShiftSchema = z.object({
  shiftId: z.string().min(1),
  isEventNight: z.boolean(),
  clientId,
  occurredAt: z.coerce.date().optional(),
});

export async function startShift(
  input: z.input<typeof startShiftSchema>,
): Promise<ActionResult<{ shiftId: string; clockInAt: string }>> {
  const parsed = startShiftSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not start that shift.");
  const scoped = db(await requireActor());

  return guarded(async () => {
    const shift = await scoped.clockIn({
      shiftId: parsed.data.shiftId,
      isEventNight: parsed.data.isEventNight,
      clientId: parsed.data.clientId,
      at: parsed.data.occurredAt ?? new Date(),
    });
    revalidatePath(`/shift/${shift.id}`);
    revalidatePath("/dashboard");
    return {
      shiftId: shift.id,
      clockInAt: (shift.clockInAt ?? new Date()).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Open an unscheduled shift
// ---------------------------------------------------------------------------

const openShiftSchema = z.object({
  siteId: z.string().min(1),
  clientId,
  occurredAt: z.coerce.date().optional(),
});

/**
 * Creates the `Shift` row for a guard who was never scheduled, then hands back
 * its id so the caller can send them to the normal start screen. Everything
 * after this point — clock in, checklist, entries, report — is the existing
 * path; this only removes the precondition that someone in an office had to
 * create the row first.
 */
export async function openUnscheduledShift(
  input: z.input<typeof openShiftSchema>,
): Promise<ActionResult<{ shiftId: string }>> {
  const parsed = openShiftSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not open that shift.");
  const scoped = db(await requireActor());

  return guarded(async () => {
    const shift = await scoped.openUnscheduledShift({
      siteId: parsed.data.siteId,
      clientId: parsed.data.clientId,
      at: parsed.data.occurredAt ?? new Date(),
    });
    revalidatePath("/dashboard");
    return { shiftId: shift.id };
  });
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

const handoffSchema = z.object({
  shiftId: z.string().min(1),
  fromShiftId: z.string().min(1),
  clientId,
  note: z.string().max(4000).optional(),
});

/**
 * Section 9.2 step 2. Writes `HANDOFF_RECEIVED` on the incoming shift and
 * `HANDOFF_GIVEN` on the outgoing one, so neither guard's report is missing
 * half the story.
 */
export async function acknowledgeHandoff(
  input: z.input<typeof handoffSchema>,
): Promise<ActionResult<{ acknowledgedAt: string }>> {
  const parsed = handoffSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not record handoff.");
  const scoped = db(await requireActor());
  const at = new Date();

  return guarded(async () => {
    await scoped.acknowledgeHandoff({
      shiftId: parsed.data.shiftId,
      fromShiftId: parsed.data.fromShiftId,
      clientId: parsed.data.clientId,
      note: parsed.data.note ?? null,
      at,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return { acknowledgedAt: at.toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Break cover
// ---------------------------------------------------------------------------

const breakCoverSchema = z.object({
  shiftId: z.string().min(1),
  clientId,
  phase: z.enum(["START", "END"]),
  occurredAt: z.coerce.date().optional(),
  text: z.string().max(2000).optional(),
});

export async function logBreakCover(
  input: z.input<typeof breakCoverSchema>,
): Promise<ActionResult<{ entryId: string }>> {
  const parsed = breakCoverSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not log break cover.");
  const scoped = db(await requireActor());

  return guarded(async () => {
    const entry = await scoped.entry.upsert({
      shiftId: parsed.data.shiftId,
      clientId: parsed.data.clientId,
      type:
        parsed.data.phase === "START"
          ? EntryType.BREAK_COVER_START
          : EntryType.BREAK_COVER_END,
      occurredAt: parsed.data.occurredAt ?? new Date(),
      text: parsed.data.text ?? null,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return { entryId: entry.id };
  });
}

// ---------------------------------------------------------------------------
// Clock-in checklists
// ---------------------------------------------------------------------------

const propertyCheckSchema = z.object({
  shiftId: z.string().min(1),
  areaId: z.string().min(1),
  result: z.enum(PropertyCheckResult),
  note: z.string().max(2000).optional(),
  mediaId: z.string().optional(),
});

export async function submitPropertyCheck(
  input: z.input<typeof propertyCheckSchema>,
): Promise<ActionResult<{ checkId: string }>> {
  const parsed = propertyCheckSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not save that check.");

  // Section 9.2 step 3: a skip must carry a reason and damage must carry a
  // description, or the finding is unactionable. Enforced here rather than in
  // the form because the form is not the only caller once the outbox replays.
  if (parsed.data.result !== PropertyCheckResult.CLEAR && !parsed.data.note?.trim()) {
    return failure(
      "REASON_REQUIRED",
      parsed.data.result === PropertyCheckResult.SKIPPED
        ? "Say why this area was skipped."
        : "Describe the damage you found.",
    );
  }

  const scoped = db(await requireActor());
  return guarded(async () => {
    const check = await scoped.propertyCheck.submit({
      shiftId: parsed.data.shiftId,
      areaId: parsed.data.areaId,
      result: parsed.data.result,
      note: parsed.data.note ?? null,
      mediaId: parsed.data.mediaId ?? null,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}/start`);
    return { checkId: check.id };
  });
}

const blindSpotCheckSchema = z.object({
  shiftId: z.string().min(1),
  blindSpotId: z.string().min(1),
  method: z.enum(BlindSpotMethod),
  verifiedById: z.string().optional(),
  reason: z.string().max(2000).optional(),
  mediaId: z.string().optional(),
});

export async function submitBlindSpotCheck(
  input: z.input<typeof blindSpotCheckSchema>,
): Promise<ActionResult<{ checkId: string }>> {
  const parsed = blindSpotCheckSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not save that check.");

  if (
    parsed.data.method === BlindSpotMethod.NOT_CHECKED &&
    !parsed.data.reason?.trim()
  ) {
    return failure("REASON_REQUIRED", "Say why this spot was not checked.");
  }

  const scoped = db(await requireActor());
  return guarded(async () => {
    const check = await scoped.blindSpotCheck.submit({
      shiftId: parsed.data.shiftId,
      blindSpotId: parsed.data.blindSpotId,
      method: parsed.data.method,
      verifiedById: parsed.data.verifiedById ?? null,
      reason: parsed.data.reason ?? null,
      mediaId: parsed.data.mediaId ?? null,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}/start`);
    return { checkId: check.id };
  });
}
