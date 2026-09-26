"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { EntryType, IncidentStatus, Severity } from "@/generated/prisma/enums";
import { requireActor } from "@/lib/auth/guards";
import { record as recordAudit } from "@/lib/db/audit";
import { NotVisibleError, db } from "@/lib/db/scoped";

/**
 * Timeline actions (sections 9.3 and 16): notes, incidents and packages.
 *
 * Same contract as `shift.ts` — idempotent on a client-generated key, no raw
 * Prisma, `NotVisibleError` answers 404 so a cross-company probe learns
 * nothing from the difference between "not yours" and "not there".
 */

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: string; message: string };

function failure(code: string, message: string): ActionResult<never> {
  return { ok: false, code, message };
}

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

const clientId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const createEntrySchema = z.object({
  shiftId: z.string().min(1),
  clientId,
  type: z.enum(EntryType),
  occurredAt: z.coerce.date(),
  text: z.string().max(8000).optional(),
  transcriptRaw: z.string().max(8000).optional(),
  areaId: z.string().optional(),
  siteEntryTypeId: z.string().optional(),
  /**
   * Media already uploaded and recorded against this shift. Section 10 starts
   * the upload as soon as a photo is picked, before the entry exists, so the
   * rows are attached here rather than created here.
   */
  mediaIds: z.array(z.string().min(1)).max(20).optional(),
});

export async function createEntry(
  input: z.input<typeof createEntrySchema>,
): Promise<ActionResult<{ entryId: string }>> {
  const parsed = createEntrySchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not save that note.");

  // Incidents and packages carry extra rows and a sequence number, so they
  // have their own actions. Letting them through here would create a bare
  // entry with no incident attached and no code — a note that looks like an
  // incident in the timeline and is missing from the incident summary.
  if (
    parsed.data.type === EntryType.INCIDENT ||
    parsed.data.type === EntryType.PACKAGE
  ) {
    return failure("WRONG_ACTION", "Use the incident or package form.");
  }

  const scoped = db(await requireActor());
  return guarded(async () => {
    const entry = await scoped.entry.upsert({
      shiftId: parsed.data.shiftId,
      clientId: parsed.data.clientId,
      type: parsed.data.type,
      occurredAt: parsed.data.occurredAt,
      text: parsed.data.text ?? null,
      transcriptRaw: parsed.data.transcriptRaw ?? null,
      areaId: parsed.data.areaId ?? null,
      siteEntryTypeId: parsed.data.siteEntryTypeId ?? null,
    });
    if (parsed.data.mediaIds?.length) {
      await scoped.media.attachToEntry({
        shiftId: parsed.data.shiftId,
        entryId: entry.id,
        mediaIds: parsed.data.mediaIds,
      });
    }
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return { entryId: entry.id };
  });
}

const updateEntrySchema = z.object({
  entryId: z.string().min(1),
  shiftId: z.string().min(1),
  text: z.string().min(1).max(8000),
});

export async function updateEntry(
  input: z.input<typeof updateEntrySchema>,
): Promise<ActionResult<{ entryId: string }>> {
  const parsed = updateEntrySchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not save that edit.");
  const actor = await requireActor();
  const scoped = db(actor);

  return guarded(async () => {
    const entry = await scoped.entry.update({
      id: parsed.data.entryId,
      text: parsed.data.text,
      editedById: actor.userId,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    await recordAudit({
      companyId: actor.companyId,
      actorId: actor.userId,
      action: "entry.edit",
      entityType: "Entry",
      entityId: entry.id,
      metadata: { shiftId: parsed.data.shiftId },
    });
    return { entryId: entry.id };
  });
}

const softDeleteSchema = z.object({
  entryId: z.string().min(1),
  shiftId: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

/**
 * Soft delete only. A security log that can be silently erased is not a log,
 * so the row survives, the reason is mandatory, and the report renders it
 * struck through (section 9.3).
 */
export async function softDeleteEntry(
  input: z.input<typeof softDeleteSchema>,
): Promise<ActionResult<{ entryId: string }>> {
  const parsed = softDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return failure("REASON_REQUIRED", "Say why you are removing this.");
  }
  const actor = await requireActor();
  const scoped = db(actor);

  return guarded(async () => {
    const entry = await scoped.entry.softDelete({
      id: parsed.data.entryId,
      reason: parsed.data.reason,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    await recordAudit({
      companyId: actor.companyId,
      actorId: actor.userId,
      action: "entry.delete",
      entityType: "Entry",
      entityId: entry.id,
      // The reason is the whole point of a soft delete. Storing it here too
      // means the log answers "why did this disappear" without a second read.
      metadata: { shiftId: parsed.data.shiftId, reason: parsed.data.reason },
    });
    return { entryId: entry.id };
  });
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

const createIncidentSchema = z.object({
  shiftId: z.string().min(1),
  clientId,
  occurredAt: z.coerce.date(),
  categoryKey: z.string().min(1).max(64),
  siteEntryTypeId: z.string().optional(),
  severity: z.enum(Severity).optional(),
  status: z.enum(IncidentStatus).optional(),
  text: z.string().max(8000).optional(),
  transcriptRaw: z.string().max(8000).optional(),
  areaId: z.string().optional(),
});

export async function createIncident(
  input: z.input<typeof createIncidentSchema>,
): Promise<
  ActionResult<{
    incidentId: string;
    // The timeline keys and links on the *entry*, not the incident, so the
    // caller needs both ids back. Returning only `incidentId` would force the
    // client to refetch the shift just to render the row it already has.
    entryId: string;
    code: string;
    status: IncidentStatus;
  }>
> {
  const parsed = createIncidentSchema.safeParse(input);
  if (!parsed.success) {
    return failure("INVALID", "Could not log that incident.");
  }
  // An incident closed at the moment it is opened is a contradiction, and
  // allowing it would let a bad client skip the resolution note entirely.
  if (parsed.data.status === IncidentStatus.RESOLVED) {
    return failure("INVALID", "Log the incident first, then resolve it.");
  }

  const scoped = db(await requireActor());
  return guarded(async () => {
    const incident = await scoped.incident.create({
      shiftId: parsed.data.shiftId,
      clientId: parsed.data.clientId,
      occurredAt: parsed.data.occurredAt,
      categoryKey: parsed.data.categoryKey,
      siteEntryTypeId: parsed.data.siteEntryTypeId ?? null,
      severity: parsed.data.severity ?? null,
      status: parsed.data.status,
      text: parsed.data.text ?? null,
      transcriptRaw: parsed.data.transcriptRaw ?? null,
      areaId: parsed.data.areaId ?? null,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return {
      incidentId: incident.id,
      entryId: incident.entryId,
      code: incident.code,
      status: incident.status,
    };
  });
}

const resolveIncidentSchema = z.object({
  incidentId: z.string().min(1),
  shiftId: z.string().min(1),
  resolutionNote: z.string().min(1).max(4000),
});

export async function resolveIncident(
  input: z.input<typeof resolveIncidentSchema>,
): Promise<ActionResult<{ incidentId: string }>> {
  const parsed = resolveIncidentSchema.safeParse(input);
  if (!parsed.success) {
    return failure("NOTE_REQUIRED", "Say how this was resolved.");
  }
  const scoped = db(await requireActor());

  return guarded(async () => {
    const incident = await scoped.incident.resolve({
      incidentId: parsed.data.incidentId,
      resolutionNote: parsed.data.resolutionNote,
      at: new Date(),
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return { incidentId: incident.id };
  });
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

const createPackageSchema = z.object({
  shiftId: z.string().min(1),
  clientId,
  occurredAt: z.coerce.date(),
  carrier: z.string().max(120).optional(),
  trackingNumber: z.string().max(120).optional(),
  recipientName: z.string().max(200).optional(),
  room: z.string().max(60).optional(),
  text: z.string().max(4000).optional(),
});

export async function createPackage(
  input: z.input<typeof createPackageSchema>,
): Promise<ActionResult<{ packageId: string; entryId: string }>> {
  const parsed = createPackageSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID", "Could not log that package.");
  const scoped = db(await requireActor());

  return guarded(async () => {
    const pkg = await scoped.packageInfo.create({
      shiftId: parsed.data.shiftId,
      clientId: parsed.data.clientId,
      occurredAt: parsed.data.occurredAt,
      carrier: parsed.data.carrier ?? null,
      trackingNumber: parsed.data.trackingNumber ?? null,
      recipientName: parsed.data.recipientName ?? null,
      room: parsed.data.room ?? null,
      text: parsed.data.text ?? null,
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return { packageId: pkg.id, entryId: pkg.entryId };
  });
}

const deliverPackageSchema = z.object({
  packageId: z.string().min(1),
  shiftId: z.string().min(1),
  deliveredTo: z.string().min(1).max(200),
  signatureMediaId: z.string().optional(),
});

export async function deliverPackage(
  input: z.input<typeof deliverPackageSchema>,
): Promise<ActionResult<{ packageId: string }>> {
  const parsed = deliverPackageSchema.safeParse(input);
  if (!parsed.success) {
    return failure("RECIPIENT_REQUIRED", "Record who collected it.");
  }
  const scoped = db(await requireActor());

  return guarded(async () => {
    const pkg = await scoped.packageInfo.deliver({
      packageId: parsed.data.packageId,
      deliveredTo: parsed.data.deliveredTo,
      signatureMediaId: parsed.data.signatureMediaId ?? null,
      at: new Date(),
    });
    revalidatePath(`/shift/${parsed.data.shiftId}`);
    return { packageId: pkg.id };
  });
}
