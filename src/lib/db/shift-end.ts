import type {
  EntryType,
  IncidentStatus,
  LoggingMode,
  Severity,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/client";

/**
 * Everything step 1 of the end-of-shift flow puts in front of the guard.
 *
 * It is one query set rather than a handful of component-level fetches because
 * the guard is tired and the screen has to be right on first paint. A count
 * that arrives a beat late reads as a count that changed.
 */

export type ShiftSummaryData = {
  siteName: string;
  siteTimezone: string;
  /**
   * What this site agreed to. Carried on the summary rather than fetched
   * separately by the screen, because the one question the end-of-shift flow
   * must never get wrong is whether this site wanted a document at all.
   */
  loggingMode: LoggingMode;
  guardName: string;
  counts: Record<EntryType, number>;
  incidents: {
    id: string;
    entryId: string;
    code: string;
    text: string;
    severity: Severity | null;
    ongoingSince: Date | null;
    status: IncidentStatus;
    resolvedAt: Date | null;
  }[];
  packageCount: number;
  /** Photos attached to the shift but not to any incident entry. */
  unattachedPhotos: number;
  blindSpots: { checked: number; total: number };
  propertyChecks: { done: number; total: number };
  handoff: { fromName: string | null; at: Date | null };
  summary: string | null;
  handoffNote: string | null;
  endFlowStartedAt: Date | null;
  clockInAt: Date | null;
  clockOutAt: Date | null;
};

export async function endOfShiftData(
  shiftId: string,
): Promise<ShiftSummaryData | null> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: {
      site: { select: { name: true, timezone: true, loggingMode: true } },
      guard: { select: { name: true, email: true } },
      handoffFrom: {
        select: { guard: { select: { name: true } }, clockOutAt: true },
      },
    },
  });
  if (!shift) return null;

  const [
    entries,
    blindSpotTotal,
    blindSpotChecks,
    areaTotal,
    propertyChecks,
    looseMedia,
  ] = await Promise.all([
    prisma.entry.findMany({
      where: { shiftId, deletedAt: null },
      select: {
        id: true,
        type: true,
        text: true,
        occurredAt: true,
        incident: {
          select: {
            id: true,
            code: true,
            severity: true,
            ongoingSince: true,
            status: true,
            resolvedAt: true,
          },
        },
      },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.blindSpot.count({ where: { siteId: shift.siteId } }),
    prisma.blindSpotCheck.count({ where: { shiftId } }),
    prisma.area.count({ where: { siteId: shift.siteId } }),
    prisma.propertyCheck.count({ where: { shiftId } }),
    // Media hanging off the shift with no entry, or on an entry that is not
    // an incident. Both are "in the general gallery" from the guard's point
    // of view, and both are what the nudge in step 1 is about.
    prisma.media.count({
      where: {
        shiftId,
        OR: [{ entryId: null }, { entry: { incident: { is: null } } }],
      },
    }),
  ]);

  const counts = {} as Record<EntryType, number>;
  for (const entry of entries) {
    counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  }

  const incidents = entries
    .filter((e) => e.incident)
    .map((e) => ({
      id: e.incident!.id,
      entryId: e.id,
      code: e.incident!.code,
      text: e.text ?? "",
      severity: e.incident!.severity,
      ongoingSince: e.incident!.ongoingSince,
      status: e.incident!.status,
      resolvedAt: e.incident!.resolvedAt,
    }));

  return {
    siteName: shift.site.name,
    siteTimezone: shift.site.timezone,
    loggingMode: shift.site.loggingMode,
    guardName: shift.guard.name ?? shift.guard.email ?? "Guard",
    counts,
    incidents,
    packageCount: counts["PACKAGE"] ?? 0,
    unattachedPhotos: looseMedia,
    blindSpots: { checked: blindSpotChecks, total: blindSpotTotal },
    propertyChecks: { done: propertyChecks, total: areaTotal },
    handoff: {
      fromName: shift.handoffFrom?.guard.name ?? null,
      at: shift.handoffFrom?.clockOutAt ?? null,
    },
    summary: shift.summary,
    handoffNote: shift.handoffNote,
    endFlowStartedAt: shift.endFlowStartedAt,
    clockInAt: shift.clockInAt,
    clockOutAt: shift.clockOutAt,
  };
}

/**
 * The pre-filled shift summary, section 9.4 step 1.
 *
 * Deterministic on purpose. A language model writing the guard's account of
 * their own night is the one thing in this product that must not happen: the
 * summary is evidence, it goes to a client, and it can end up in an insurance
 * file. A template the guard edits is theirs. A generated paragraph they
 * skim-approve at 6am is not, and neither of them could say later which words
 * were whose.
 *
 * It also has to read like a person wrote it, because the guard is going to
 * send it with their name on it. Hence the breakdown in words rather than
 * "incidents: 2 (HIGH: 1, LOW: 1)".
 */
export function summaryTemplate(
  data: Pick<
    ShiftSummaryData,
    | "siteName"
    | "incidents"
    | "packageCount"
    | "blindSpots"
    | "handoff"
    | "siteTimezone"
  >,
  formatTime: (when: Date, tz: string) => string,
): string {
  const parts: string[] = [];

  const incidentCount = data.incidents.length;
  if (incidentCount === 0) {
    parts.push(`Routine shift at ${data.siteName}. Nothing to report.`);
  } else {
    const bySeverity = new Map<string, number>();
    for (const incident of data.incidents) {
      const key = incident.severity ? incident.severity.toLowerCase() : "ungraded";
      bySeverity.set(key, (bySeverity.get(key) ?? 0) + 1);
    }
    const breakdown = [...bySeverity.entries()]
      .map(([label, n]) => `${n} ${label}`)
      .join(", ");
    const noun = incidentCount === 1 ? "incident" : "incidents";
    parts.push(`Shift at ${data.siteName}. ${incidentCount} ${noun} (${breakdown}).`);
  }

  if (data.packageCount > 0) {
    const noun = data.packageCount === 1 ? "package" : "packages";
    parts.push(`${data.packageCount} ${noun} received.`);
  }

  if (data.blindSpots.total > 0) {
    parts.push(
      `Blind spots checked ${data.blindSpots.checked}/${data.blindSpots.total}.`,
    );
  }

  if (data.handoff.fromName && data.handoff.at) {
    parts.push(
      `Handoff from ${data.handoff.fromName} at ${formatTime(data.handoff.at, data.siteTimezone)}.`,
    );
  }

  return parts.join(" ");
}

/**
 * Stamp the clock the end-of-shift time is measured from.
 *
 * Only the first call writes. Re-entering step 1 to fix a typo must not reset
 * the timer, or "End-of-shift time: 2m 51s" silently becomes time-since-last-
 * edit, which flatters the number the product is sold on.
 */
export async function startEndFlow(shiftId: string, now = new Date()): Promise<void> {
  await prisma.shift.updateMany({
    where: { id: shiftId, endFlowStartedAt: null },
    data: { endFlowStartedAt: now },
  });
}

export async function writeSummary(
  shiftId: string,
  input: { summary: string | null; handoffNote: string | null },
): Promise<void> {
  await prisma.shift.update({ where: { id: shiftId }, data: input });
}

/** Whether a build is already running, so a double tap does not make a v2. */
export async function findEndFlowShift(shiftId: string) {
  const [shift, inFlight] = await Promise.all([
    prisma.shift.findUnique({
      where: { id: shiftId },
      select: { endFlowStartedAt: true, endFlowCompletedAt: true, clockOutAt: true },
    }),
    prisma.job.count({
      where: {
        type: "GENERATE_REPORT",
        status: { in: ["QUEUED", "RUNNING"] },
        payload: { path: ["shiftId"], equals: shiftId },
      },
    }),
  ]);
  if (!shift) return null;
  return { ...shift, buildInFlight: inFlight > 0 };
}

export async function endEndFlow(shiftId: string, now = new Date()): Promise<void> {
  await prisma.shift.update({
    where: { id: shiftId },
    data: { clockOutAt: now, endFlowCompletedAt: now, status: "ENDED" },
  });
}

/**
 * How long the end-of-shift flow took, in ms, or null if it is not finished.
 *
 * Null rather than "measured to now" on purpose: an unfinished flow has no
 * duration, and counting one would drag the dashboard average up every time a
 * guard opened the screen and walked away.
 */
export function endFlowDuration(shift: {
  endFlowStartedAt: Date | null;
  endFlowCompletedAt: Date | null;
}): number | null {
  if (!shift.endFlowStartedAt || !shift.endFlowCompletedAt) return null;
  const ms = shift.endFlowCompletedAt.getTime() - shift.endFlowStartedAt.getTime();
  return ms >= 0 ? ms : null;
}

/**
 * The guard's own average this month, for the quiet dashboard stat in 9.2.
 *
 * Their own, never a leaderboard. A number that ranks guards against each
 * other turns "log the night honestly" into "log it fast", and the product
 * stops being evidence.
 */
export async function averageEndFlowMs(
  guardId: string,
  since: Date,
): Promise<{ averageMs: number; shifts: number } | null> {
  const shifts = await prisma.shift.findMany({
    where: {
      guardId,
      endFlowCompletedAt: { gte: since },
      endFlowStartedAt: { not: null },
    },
    select: { endFlowStartedAt: true, endFlowCompletedAt: true },
  });

  const durations = shifts
    .map(endFlowDuration)
    .filter((ms): ms is number => ms !== null);
  if (durations.length === 0) return null;

  const total = durations.reduce((sum, ms) => sum + ms, 0);
  return { averageMs: Math.round(total / durations.length), shifts: durations.length };
}

/**
 * The recipient list for step 3, with the verification chips.
 *
 * One-off CCs from an earlier send on this shift come back too, so a guard who
 * added their regional manager on v1 is not asked to remember the address
 * again for v2.
 */
export async function recipientsForSend(shiftId: string, siteId: string) {
  const [configured, oneOffs] = await Promise.all([
    prisma.recipient.findMany({
      where: { siteId },
      orderBy: [{ required: "desc" }, { name: "asc" }],
    }),
    prisma.reportDelivery.findMany({
      where: { recipientId: null, report: { shiftId } },
      distinct: ["email"],
      select: { email: true },
    }),
  ]);
  return { configured, oneOffs: oneOffs.map((d) => d.email) };
}

/**
 * Add a one-off CC to a report that has not been sent to them yet.
 *
 * Returns false if the address is already on the report, whether as a
 * configured recipient or an earlier CC. The unique on (reportId, email)
 * is what makes that true under a race; this check is only so the guard gets
 * a sentence instead of a constraint violation.
 */
export async function addOneOffDelivery(
  reportId: string,
  email: string,
): Promise<boolean> {
  const existing = await prisma.reportDelivery.findFirst({
    where: { reportId, email },
    select: { id: true },
  });
  if (existing) return false;

  try {
    await prisma.reportDelivery.create({
      data: { reportId, email, status: "QUEUED" },
    });
    return true;
  } catch {
    // Lost the race against another tab. The row exists either way, which is
    // the outcome the guard wanted.
    return false;
  }
}

/**
 * The little a build job needs to know before it commits to rendering.
 *
 * Separate from `endOfShiftData` because that loads the whole night — entries,
 * counts, checks, media — and the only questions here are "does this shift
 * still exist" and "did this site agree to a report at all". Loading the night
 * to answer the second one would mean the refusal costs more than the render.
 */
export async function shiftReportContext(
  shiftId: string,
): Promise<{ siteId: string; loggingMode: LoggingMode } | null> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { siteId: true, site: { select: { loggingMode: true } } },
  });
  if (!shift) return null;
  return { siteId: shift.siteId, loggingMode: shift.site.loggingMode };
}
