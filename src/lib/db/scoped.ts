import {
  BlindSpotMethod,
  EntryType,
  MediaKind,
  IncidentStatus,
  PropertyCheckResult,
  Role,
  Severity,
  ShiftStatus,
} from "@/generated/prisma/enums";
import { formatIncidentCode, incidentCodePrefix, nextSequence } from "@/lib/incidents";
import { prisma } from "./client";

/**
 * The single data-access layer. Company isolation is enforced here and nowhere
 * else, which is only true because `eslint.config.mjs` forbids importing
 * `lib/db/client` or the generated client from anywhere outside `lib/db/**`.
 * That lint rule is the enforcement; this file is the implementation.
 *
 * Two axes of visibility, and they are different questions:
 *
 *   1. Tenancy — which company owns the row. Never optional, never role-
 *      dependent. A cross-company read is a bug at any privilege level.
 *   2. Scope — which of that company's rows this actor may see, from section 8:
 *        GUARD       assigned sites; own reports and receipts
 *        SUPERVISOR  assigned sites; all shifts and reports at those sites
 *        ADMIN       every site in the company
 *        OWNER       admin, plus company settings and deletion
 *
 * Both are expressed as relational filters rather than by pre-loading the
 * actor's site ids, so the database does the join and the filter cannot drift
 * out of date between the load and the query.
 */

export type Actor = {
  userId: string;
  companyId: string;
  role: Role;
};

const COMPANY_WIDE: readonly Role[] = [Role.ADMIN, Role.OWNER];

function seesEverySite(actor: Actor): boolean {
  return COMPANY_WIDE.includes(actor.role);
}

/**
 * Where-fragments pinning each model to what `actor` may see. Every read and
 * write below is built from one of these, and they are exported so that a test
 * can assert the shape directly rather than inferring it from behaviour.
 *
 * The chain of custody back to Company, which is what makes these safe:
 *   Site    -> companyId
 *   Shift   -> site
 *   Entry   -> shift -> site
 *   Media   -> shift -> site
 *   Report  -> shift -> site
 */
export const visible = {
  site(actor: Actor) {
    const tenancy = { companyId: actor.companyId };
    if (seesEverySite(actor)) return tenancy;
    return {
      ...tenancy,
      assignments: { some: { userId: actor.userId } },
    };
  },

  user(actor: Actor) {
    return { companyId: actor.companyId };
  },

  shift(actor: Actor) {
    // Deliberately not narrowed to `guardId` for a GUARD. Section 8 scopes a
    // guard's *reports* to their own, not their shifts: acknowledging a handoff
    // requires reading the outgoing guard's shift at the same site.
    return { site: visible.site(actor) };
  },

  entry(actor: Actor) {
    return { shift: visible.shift(actor) };
  },

  media(actor: Actor) {
    return { shift: visible.shift(actor) };
  },

  report(actor: Actor) {
    const atVisibleSites = { shift: visible.shift(actor) };
    if (actor.role !== Role.GUARD) return atVisibleSites;
    return { shift: { ...visible.shift(actor), guardId: actor.userId } };
  },

  recipient(actor: Actor) {
    return { site: visible.site(actor) };
  },
} as const;

/**
 * Accessors. Each one takes the actor first so a call site physically cannot
 * omit the scope.
 *
 * Note every single-row read is `findFirst`, never `findUnique`. `findUnique`
 * only accepts unique fields in its where-clause, so the company filter cannot
 * be attached to it — `findUnique({ where: { id } })` would happily return
 * another company's row. That is the exact mistake this layer exists to
 * prevent, so `findUnique` does not appear in this file at all.
 */
export function db(actor: Actor) {
  /**
   * `areaId` and `siteEntryTypeId` arrive from the client and are *not*
   * covered by `visible.*`, which scopes to the company. A company with two
   * properties could therefore tag a Westside Hotel entry with the Riverside
   * Depot's "Loading dock", and that heading would then appear on a report for
   * a property that has no loading dock.
   *
   * Both foreign keys must belong to the same site as the shift being written
   * to. Kept in one place so the entry path and the incident path cannot
   * drift apart.
   */
  async function assertBelongsToSite(
    siteId: string,
    input: { areaId?: string | null; siteEntryTypeId?: string | null },
  ) {
    if (input.areaId) {
      const area = await prisma.area.findFirst({
        where: { id: input.areaId, siteId },
        select: { id: true },
      });
      if (!area) throw new NotVisibleError("area", input.areaId);
    }
    if (input.siteEntryTypeId) {
      const type = await prisma.siteEntryType.findFirst({
        where: { id: input.siteEntryTypeId, siteId },
        select: { id: true },
      });
      if (!type) throw new NotVisibleError("siteEntryType", input.siteEntryTypeId);
    }
  }

  return {
    actor,

    site: {
      findMany() {
        return prisma.site.findMany({
          where: visible.site(actor),
          orderBy: { name: "asc" },
        });
      },
      findById(id: string) {
        return prisma.site.findFirst({
          where: { id, ...visible.site(actor) },
        });
      },
      withConfig(id: string) {
        return prisma.site.findFirst({
          where: { id, ...visible.site(actor) },
          include: {
            areas: { orderBy: { order: "asc" } },
            blindSpots: { orderBy: { order: "asc" } },
            entryTypes: { orderBy: { order: "asc" } },
            shiftTemplates: { orderBy: { order: "asc" } },
            reportTemplate: true,
            recipients: { orderBy: { name: "asc" } },
          },
        });
      },
      /**
       * The supervisor dashboard row (section 9.1): who is on duty right now,
       * and what is unresolved. `shifts` is capped at the single active shift
       * rather than loaded whole — a site with a year of history would
       * otherwise pull every shift to render one cell.
       */
      findManyWithDuty() {
        return prisma.site.findMany({
          where: visible.site(actor),
          include: {
            recipients: { select: { id: true, name: true, status: true } },
            shifts: {
              where: { status: "ACTIVE", clockOutAt: null },
              include: { guard: { select: { id: true, name: true } } },
              orderBy: { clockInAt: "desc" },
              take: 1,
            },
            _count: {
              select: {
                shifts: {
                  where: {
                    entries: {
                      some: {
                        deletedAt: null,
                        incident: { status: { in: ["OPEN", "ONGOING"] } },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { name: "asc" },
        });
      },
    },

    user: {
      findMany() {
        return prisma.user.findMany({
          where: visible.user(actor),
          orderBy: { name: "asc" },
        });
      },
      findById(id: string) {
        return prisma.user.findFirst({
          where: { id, ...visible.user(actor) },
        });
      },
    },

    shift: {
      findById(id: string) {
        return prisma.shift.findFirst({
          where: { id, ...visible.shift(actor) },
        });
      },
      findByIdWithSite(id: string) {
        return prisma.shift.findFirst({
          where: { id, ...visible.shift(actor) },
          include: { site: true, guard: true },
        });
      },
      /** The actor's own shift that is currently clocked in, if any. */
      findActiveForActor() {
        return prisma.shift.findFirst({
          where: {
            ...visible.shift(actor),
            guardId: actor.userId,
            status: "ACTIVE",
          },
          include: { site: true },
        });
      },
      /**
       * Shifts the actor could start now: their own, not yet ended, at a site
       * they are assigned to. Ordered by scheduled start so the imminent one
       * is first, which is what the dashboard's "Start shift" card needs.
       */
      findStartableForActor() {
        return prisma.shift.findMany({
          where: {
            ...visible.shift(actor),
            guardId: actor.userId,
            status: { not: "ENDED" },
          },
          include: { site: true, template: true },
          orderBy: { scheduledStart: "asc" },
        });
      },
      /**
       * Another guard's shift at the same site that is still open — section
       * 9.2 step 2's trigger for showing the handoff step. Scoped through
       * `visible.shift`, so it cannot surface a shift from another company.
       */
      findOpenHandoffSource(input: { siteId: string; excludeShiftId: string }) {
        return prisma.shift.findFirst({
          where: {
            ...visible.shift(actor),
            siteId: input.siteId,
            id: { not: input.excludeShiftId },
            status: "ACTIVE",
            clockOutAt: null,
          },
          include: {
            guard: { select: { id: true, name: true, email: true } },
            entries: {
              where: {
                deletedAt: null,
                incident: { status: { in: ["OPEN", "ONGOING"] } },
              },
              include: { incident: true },
              orderBy: { occurredAt: "desc" },
            },
          },
          orderBy: { clockInAt: "desc" },
        });
      },
      /** Recent reports for the dashboard's "last three" strip. */
      recentReportsForActor(take: number) {
        return prisma.report.findMany({
          where: visible.report(actor),
          include: {
            shift: { include: { site: true } },
            deliveries: true,
          },
          orderBy: { createdAt: "desc" },
          take,
        });
      },
    },

    report: {
      findById(id: string) {
        return prisma.report.findFirst({
          where: { id, ...visible.report(actor) },
        });
      },
    },

    // -----------------------------------------------------------------------
    // Writes
    //
    // Prisma's `create` takes no where-clause, so a write cannot carry a
    // tenancy filter the way a read can. Every write below therefore resolves
    // its parent through a *scoped read* first and uses the ids off that row,
    // never ids off the request. `assertShift` is that gate, and the fact that
    // it returns the row (rather than a boolean) is what stops a caller from
    // checking one shift and then writing to another.
    // -----------------------------------------------------------------------

    /** Loads a shift the actor may write to, or throws. */
    async assertShift(shiftId: string) {
      const shift = await prisma.shift.findFirst({
        where: { id: shiftId, ...visible.shift(actor) },
        include: { site: true },
      });
      if (!shift) throw new NotVisibleError("shift", shiftId);
      return shift;
    },

    entry: {
      /**
       * Reverse-chronological, which is the order the timeline renders in.
       * Soft-deleted rows are included for supervisors and hidden from guards:
       * section 9.3 says a deleted entry still appears struck through *to
       * supervisors*, and that distinction is enforced here rather than in the
       * component, so a future caller cannot forget it.
       */
      async listForShift(shiftId: string) {
        return prisma.entry.findMany({
          where: {
            shiftId,
            shift: visible.shift(actor),
            ...(actor.role === Role.GUARD ? { deletedAt: null } : {}),
          },
          orderBy: { occurredAt: "desc" },
          include: {
            incident: true,
            packageInfo: true,
            area: true,
            media: true,
            revisions: { orderBy: { editedAt: "desc" } },
          },
        });
      },

      async findById(id: string) {
        return prisma.entry.findFirst({
          where: { id, shift: visible.shift(actor) },
          include: {
            incident: true,
            packageInfo: true,
            area: true,
            media: true,
            shift: { include: { site: true } },
          },
        });
      },

      /**
       * Idempotent on `clientId`, which is what makes the offline outbox safe
       * to replay (section 14). A duplicate sync updates the row it already
       * created instead of adding a second one.
       */
      async upsert(input: {
        shiftId: string;
        clientId: string;
        type: EntryType;
        occurredAt: Date;
        text?: string | null;
        transcriptRaw?: string | null;
        areaId?: string | null;
        siteEntryTypeId?: string | null;
      }) {
        const shift = await prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          select: { id: true, siteId: true },
        });
        if (!shift) throw new NotVisibleError("shift", input.shiftId);
        await assertBelongsToSite(shift.siteId, input);

        const writable = {
          text: input.text ?? null,
          transcriptRaw: input.transcriptRaw ?? null,
          areaId: input.areaId ?? null,
          siteEntryTypeId: input.siteEntryTypeId ?? null,
        };
        return prisma.entry.upsert({
          where: { clientId: input.clientId },
          create: {
            shiftId: shift.id,
            clientId: input.clientId,
            type: input.type,
            occurredAt: input.occurredAt,
            ...writable,
          },
          // First write wins. A replay is a *retry of a create*, not a new
          // statement of truth: if the response was lost, the row may already
          // have been edited (and versioned) on the server, and applying the
          // original payload again would silently destroy that edit with no
          // revision recorded. An offline edit is a separate `update` call —
          // before first sync the client coalesces it into this payload, and
          // after first sync it has a real entry id to send.
          update: {},
          include: { incident: true, packageInfo: true, media: true },
        });
      },

      /**
       * Edits are versioned: section 9.3 requires the original never be lost.
       * The revision stores the text *being replaced*, so replaying the
       * revisions newest-last reconstructs every state the entry has held.
       */
      async update(input: { id: string; text: string; editedById: string }) {
        const existing = await prisma.entry.findFirst({
          where: { id: input.id, shift: visible.shift(actor) },
          select: { id: true, text: true },
        });
        if (!existing) throw new NotVisibleError("entry", input.id);

        return prisma.$transaction(async (tx) => {
          if (existing.text !== null && existing.text !== input.text) {
            await tx.entryRevision.create({
              data: {
                entryId: existing.id,
                text: existing.text,
                editedById: input.editedById,
              },
            });
          }
          return tx.entry.update({
            where: { id: existing.id },
            data: { text: input.text },
            include: { incident: true, packageInfo: true, media: true },
          });
        });
      },

      /** Soft delete. A security log that can be erased is not a log. */
      async softDelete(input: { id: string; reason: string }) {
        const existing = await prisma.entry.findFirst({
          where: { id: input.id, shift: visible.shift(actor) },
          select: { id: true },
        });
        if (!existing) throw new NotVisibleError("entry", input.id);
        return prisma.entry.update({
          where: { id: existing.id },
          data: { deletedAt: new Date(), deleteReason: input.reason },
        });
      },
    },

    media: {
      async listForShift(shiftId: string) {
        return prisma.media.findMany({
          where: { shiftId, shift: visible.shift(actor) },
          orderBy: { capturedAt: "desc" },
        });
      },
      async findById(id: string) {
        return prisma.media.findFirst({
          where: { id, shift: visible.shift(actor) },
        });
      },

      /**
       * Records an upload that has already landed in storage.
       *
       * Idempotent on `clientId` for the same reason `entry.upsert` is: an
       * offline outbox retries, and the retry is the *same* photo, not a
       * second one. `update: {}` keeps the first write, so a replay can never
       * repoint a row at a different storage key.
       *
       * The shift is re-read through `visible.shift` before the write. The
       * presign route already checked it, but a presigned URL outlives the
       * request that minted it, so the ownership question has to be asked
       * again at the moment the row is created.
       */
      async record(input: {
        shiftId: string;
        entryId?: string | null;
        clientId: string;
        kind: MediaKind;
        storageKeyOriginal: string;
        bytes: number;
        width?: number | null;
        height?: number | null;
        capturedAt: Date;
      }) {
        const shift = await prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          select: { id: true },
        });
        if (!shift) throw new NotVisibleError("Shift", input.shiftId);

        if (input.entryId) {
          const entry = await prisma.entry.findFirst({
            where: { id: input.entryId, shiftId: input.shiftId },
            select: { id: true },
          });
          if (!entry) throw new NotVisibleError("Entry", input.entryId);
        }

        return prisma.media.upsert({
          where: { clientId: input.clientId },
          update: {},
          create: {
            shiftId: input.shiftId,
            entryId: input.entryId ?? null,
            clientId: input.clientId,
            kind: input.kind,
            status: "PENDING",
            storageKeyOriginal: input.storageKeyOriginal,
            bytes: input.bytes,
            width: input.width ?? null,
            height: input.height ?? null,
            capturedAt: input.capturedAt,
          },
        });
      },

      /**
       * Links already-uploaded media to the entry that now describes them.
       *
       * The `shiftId` in the where clause is the tenancy check and it is not
       * redundant with the id list: without it a caller could name media ids
       * belonging to another shift and pull someone else's photos onto their
       * own entry. `updateMany` silently skips the ones that do not match,
       * which is the behaviour wanted — a replayed save should not fail
       * because one photo was already attached.
       */
      async attachToEntry(input: {
        shiftId: string;
        entryId: string;
        mediaIds: readonly string[];
      }) {
        if (input.mediaIds.length === 0) return { count: 0 };
        return prisma.media.updateMany({
          where: {
            id: { in: [...input.mediaIds] },
            shiftId: input.shiftId,
            entryId: null,
            shift: visible.shift(actor),
          },
          data: { entryId: input.entryId },
        });
      },
    },

    incident: {
      async listForShift(shiftId: string) {
        return prisma.incident.findMany({
          where: { entry: { shiftId, shift: visible.shift(actor) } },
          include: { entry: { include: { media: true, area: true } } },
          orderBy: { entry: { occurredAt: "desc" } },
        });
      },

      /**
       * Creates the entry and its incident together, allocating the daily
       * sequence number inside the same transaction.
       *
       * The allocation is serialized by a Postgres advisory lock keyed on the
       * code prefix (site + date). Without it, two guards tapping "Incident"
       * in the same second both read the same max and both write `WH-0924-03`
       * — and two different incidents sharing one code is precisely the
       * ambiguity the code exists to remove. The lock is transaction-scoped,
       * so it releases on commit or rollback with no cleanup path to forget.
       */
      async create(input: {
        shiftId: string;
        clientId: string;
        occurredAt: Date;
        categoryKey: string;
        siteEntryTypeId?: string | null;
        severity?: Severity | null;
        text?: string | null;
        transcriptRaw?: string | null;
        areaId?: string | null;
        status?: IncidentStatus;
      }) {
        const shift = await prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          include: { site: { select: { id: true, code: true, timezone: true } } },
        });
        if (!shift) throw new NotVisibleError("shift", input.shiftId);
        await assertBelongsToSite(shift.site.id, input);

        // Replay: the entry already exists, so return its incident rather than
        // burning a second sequence number on the same real-world event.
        const replay = await prisma.entry.findUnique({
          where: { clientId: input.clientId },
          include: { incident: true },
        });
        if (replay?.incident) return replay.incident;

        const prefix = incidentCodePrefix(
          shift.site.code,
          input.occurredAt,
          shift.site.timezone,
        );

        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix}))`;

          // Every code for that night, not just the lexically-highest one:
          // `orderBy code desc` would rank "WH-0924-99" above "WH-0924-100"
          // and start re-issuing numbers once a night passes 99 incidents.
          // `nextSequence` parses the tails as integers instead.
          const issued = await tx.incident.findMany({
            where: {
              code: { startsWith: prefix },
              entry: { shift: { siteId: shift.site.id } },
            },
            select: { code: true },
          });
          // max + 1, never count + 1: counting re-issues a code after a soft
          // delete. Gaps in the sequence are correct and intentional.
          const sequence = nextSequence(issued.map((row) => row.code));

          const entry = await tx.entry.upsert({
            where: { clientId: input.clientId },
            create: {
              shiftId: shift.id,
              clientId: input.clientId,
              type: EntryType.INCIDENT,
              occurredAt: input.occurredAt,
              text: input.text ?? null,
              transcriptRaw: input.transcriptRaw ?? null,
              areaId: input.areaId ?? null,
              siteEntryTypeId: input.siteEntryTypeId ?? null,
            },
            update: {},
          });
          return tx.incident.create({
            data: {
              entryId: entry.id,
              code: formatIncidentCode(
                shift.site.code,
                input.occurredAt,
                shift.site.timezone,
                sequence,
              ),
              categoryKey: input.categoryKey,
              siteEntryTypeId: input.siteEntryTypeId ?? null,
              severity: input.severity ?? null,
              status: input.status ?? IncidentStatus.OPEN,
              ongoingSince:
                input.status === IncidentStatus.ONGOING ? input.occurredAt : null,
            },
          });
        });
      },

      async resolve(input: { incidentId: string; resolutionNote: string; at: Date }) {
        const existing = await prisma.incident.findFirst({
          where: {
            id: input.incidentId,
            entry: { shift: visible.shift(actor) },
          },
          select: { id: true, status: true },
        });
        if (!existing) throw new NotVisibleError("incident", input.incidentId);
        // Re-resolving would move `resolvedAt` forward and overwrite the note
        // that was written when it actually closed.
        if (existing.status === IncidentStatus.RESOLVED) {
          return prisma.incident.findFirstOrThrow({
            where: { id: existing.id },
          });
        }
        return prisma.incident.update({
          where: { id: existing.id },
          data: {
            status: IncidentStatus.RESOLVED,
            resolvedAt: input.at,
            resolutionNote: input.resolutionNote,
          },
        });
      },
    },

    packageInfo: {
      listForShift(shiftId: string) {
        return prisma.package.findMany({
          where: { entry: { shiftId, shift: visible.shift(actor) } },
          include: { entry: true },
          orderBy: { entry: { occurredAt: "desc" } },
        });
      },

      async create(input: {
        shiftId: string;
        clientId: string;
        occurredAt: Date;
        carrier?: string | null;
        trackingNumber?: string | null;
        recipientName?: string | null;
        room?: string | null;
        text?: string | null;
      }) {
        const shift = await prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          select: { id: true },
        });
        if (!shift) throw new NotVisibleError("shift", input.shiftId);

        const replay = await prisma.entry.findUnique({
          where: { clientId: input.clientId },
          include: { packageInfo: true },
        });
        if (replay?.packageInfo) return replay.packageInfo;

        return prisma.$transaction(async (tx) => {
          const entry = await tx.entry.upsert({
            where: { clientId: input.clientId },
            create: {
              shiftId: shift.id,
              clientId: input.clientId,
              type: EntryType.PACKAGE,
              occurredAt: input.occurredAt,
              text: input.text ?? null,
            },
            update: {},
          });
          return tx.package.create({
            data: {
              entryId: entry.id,
              carrier: input.carrier ?? null,
              trackingNumber: input.trackingNumber ?? null,
              recipientName: input.recipientName ?? null,
              room: input.room ?? null,
            },
          });
        });
      },

      async deliver(input: {
        packageId: string;
        deliveredTo: string;
        signatureMediaId?: string | null;
        at: Date;
      }) {
        const existing = await prisma.package.findFirst({
          where: {
            id: input.packageId,
            entry: { shift: visible.shift(actor) },
          },
          select: { id: true, deliveredAt: true },
        });
        if (!existing) throw new NotVisibleError("package", input.packageId);
        // Already handed over: keep the first delivery's record rather than
        // letting a retry rewrite who signed for it.
        if (existing.deliveredAt) {
          return prisma.package.findFirstOrThrow({ where: { id: existing.id } });
        }
        return prisma.package.update({
          where: { id: existing.id },
          data: {
            deliveredAt: input.at,
            deliveredTo: input.deliveredTo,
            signatureMediaId: input.signatureMediaId ?? null,
          },
        });
      },
    },

    // -----------------------------------------------------------------------
    // Shift lifecycle writes
    // -----------------------------------------------------------------------

    /**
     * Clock in. Idempotent twice over, because this is the single most likely
     * action to be replayed: it happens at the door, often on one bar of
     * signal, and the guard will tap it again if the button does not respond.
     *
     * `clockInAt` is only written when it is still null, so a replay cannot
     * move the start of the shift forward and quietly erase minutes worked.
     */
    async clockIn(input: {
      shiftId: string;
      isEventNight: boolean;
      clientId: string;
      at: Date;
    }) {
      const shift = await prisma.shift.findFirst({
        where: { id: input.shiftId, ...visible.shift(actor) },
        select: { id: true, guardId: true, clockInAt: true },
      });
      if (!shift) throw new NotVisibleError("shift", input.shiftId);
      // Reading another guard's shift at your site is legitimate (handoff
      // needs it), so the ownership rule for *writing* lives here.
      if (shift.guardId !== actor.userId) {
        throw new NotVisibleError("shift", input.shiftId);
      }

      const clockInAt = shift.clockInAt ?? input.at;
      return prisma.$transaction(async (tx) => {
        const updated = await tx.shift.update({
          where: { id: shift.id },
          data: {
            isEventNight: input.isEventNight,
            status: ShiftStatus.ACTIVE,
            ...(shift.clockInAt ? {} : { clockInAt }),
          },
          include: { site: true },
        });
        await tx.entry.upsert({
          where: { clientId: input.clientId },
          create: {
            shiftId: shift.id,
            clientId: input.clientId,
            type: EntryType.CLOCK_IN,
            occurredAt: clockInAt,
          },
          update: {},
        });
        return updated;
      });
    },

    /**
     * Records the handoff on *both* shifts in one transaction. A half-written
     * handoff is worse than none: it reads as complete on the incoming guard's
     * timeline while the outgoing guard's report shows they walked off without
     * handing over.
     */
    async acknowledgeHandoff(input: {
      shiftId: string;
      fromShiftId: string;
      clientId: string;
      note?: string | null;
      at: Date;
    }) {
      const [incoming, outgoing] = await Promise.all([
        prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          select: { id: true, siteId: true },
        }),
        prisma.shift.findFirst({
          where: { id: input.fromShiftId, ...visible.shift(actor) },
          select: { id: true, siteId: true, handoffNote: true },
        }),
      ]);
      if (!incoming) throw new NotVisibleError("shift", input.shiftId);
      // Scoped on its own, so naming a shift as a handoff source cannot be
      // used to read one at a site this actor is not assigned to.
      if (!outgoing || outgoing.siteId !== incoming.siteId) {
        throw new NotVisibleError("shift", input.fromShiftId);
      }

      await prisma.$transaction(async (tx) => {
        await tx.shift.update({
          where: { id: incoming.id },
          data: { handoffFromShiftId: outgoing.id },
        });
        await tx.entry.upsert({
          where: { clientId: input.clientId },
          create: {
            shiftId: incoming.id,
            clientId: input.clientId,
            type: EntryType.HANDOFF_RECEIVED,
            occurredAt: input.at,
            text: input.note ?? outgoing.handoffNote ?? null,
          },
          update: {},
        });
        await tx.entry.upsert({
          // Derived from the same key, so the paired entry is idempotent
          // without the client tracking two ids.
          where: { clientId: `${input.clientId}-given` },
          create: {
            shiftId: outgoing.id,
            clientId: `${input.clientId}-given`,
            type: EntryType.HANDOFF_GIVEN,
            occurredAt: input.at,
            text: outgoing.handoffNote ?? null,
          },
          update: {},
        });
      });
    },

    propertyCheck: {
      listForShift(shiftId: string) {
        return prisma.propertyCheck.findMany({
          where: { shiftId, shift: visible.shift(actor) },
          include: { area: true },
        });
      },
      /**
       * One check per area per shift, so re-answering corrects the record
       * instead of appending a contradictory second row.
       */
      async submit(input: {
        shiftId: string;
        areaId: string;
        result: PropertyCheckResult;
        note?: string | null;
        mediaId?: string | null;
      }) {
        const shift = await prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          select: { id: true, siteId: true },
        });
        if (!shift) throw new NotVisibleError("shift", input.shiftId);
        // The area has to belong to *this shift's site*, or a check would be
        // recorded against a place the guard never stood.
        const area = await prisma.area.findFirst({
          where: { id: input.areaId, siteId: shift.siteId },
          select: { id: true },
        });
        if (!area) throw new NotVisibleError("area", input.areaId);

        const data = {
          result: input.result,
          note: input.note ?? null,
          mediaId: input.mediaId ?? null,
          at: new Date(),
        };
        const existing = await prisma.propertyCheck.findFirst({
          where: { shiftId: shift.id, areaId: area.id },
          select: { id: true },
        });
        return existing
          ? prisma.propertyCheck.update({ where: { id: existing.id }, data })
          : prisma.propertyCheck.create({
              data: { shiftId: shift.id, areaId: area.id, ...data },
            });
      },
    },

    blindSpotCheck: {
      listForShift(shiftId: string) {
        return prisma.blindSpotCheck.findMany({
          where: { shiftId, shift: visible.shift(actor) },
          include: { blindSpot: true, verifiedBy: true },
        });
      },
      async submit(input: {
        shiftId: string;
        blindSpotId: string;
        method: BlindSpotMethod;
        verifiedById?: string | null;
        reason?: string | null;
        mediaId?: string | null;
      }) {
        const shift = await prisma.shift.findFirst({
          where: { id: input.shiftId, ...visible.shift(actor) },
          select: { id: true, siteId: true },
        });
        if (!shift) throw new NotVisibleError("shift", input.shiftId);
        const spot = await prisma.blindSpot.findFirst({
          where: { id: input.blindSpotId, siteId: shift.siteId },
          select: { id: true },
        });
        if (!spot) throw new NotVisibleError("blindSpot", input.blindSpotId);

        const data = {
          method: input.method,
          // CAMERA_ROOM is the legitimate workaround in section 9.2 step 4:
          // nobody walks to the spot, someone watching the cameras confirms
          // it. Recording *who* confirmed is what separates that from a skip.
          verifiedById: input.verifiedById ?? null,
          reason: input.reason ?? null,
          mediaId: input.mediaId ?? null,
          at: new Date(),
        };
        const existing = await prisma.blindSpotCheck.findFirst({
          where: { shiftId: shift.id, blindSpotId: spot.id },
          select: { id: true },
        });
        return existing
          ? prisma.blindSpotCheck.update({ where: { id: existing.id }, data })
          : prisma.blindSpotCheck.create({
              data: { shiftId: shift.id, blindSpotId: spot.id, ...data },
            });
      },
    },
  };
}

/**
 * Thrown when a scoped read finds nothing. Callers turn this into a 404, never
 * a 403 — telling someone "that exists but is not yours" confirms the id, which
 * is the same enumeration leak the sign-in form was fixed for in milestone 2.
 */
export class NotVisibleError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`No visible ${entity} with id ${id}`);
    this.name = "NotVisibleError";
  }
}

export type ScopedDb = ReturnType<typeof db>;
