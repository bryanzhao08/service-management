import type { LoggingMode } from "@/generated/prisma/enums";

/**
 * What a site's logging mode actually permits.
 *
 * The spec's line is "every screen must respect the mode", and that phrasing is
 * the problem: a rule enforced by every screen is a rule enforced by none of
 * them, because the enforcement lives in as many places as there are screens
 * and drifts the moment someone adds the next one. So the modes are described
 * once, here, and every screen asks this module rather than testing the enum
 * itself.
 *
 * The middle school in the research is the case that makes this real. They
 * asked for verbal handover only. If a guard there opens the end-of-shift flow
 * and it does what it does at a hotel, we generate a PDF about a school and
 * email it to a recipient list that site never agreed to have. That is not a
 * cosmetic bug; it is us sending out a record the customer declined.
 */
export type SiteCapabilities = {
  /** Property-check areas and blind spots presented at clock-in. */
  clockInChecklist: boolean;
  /**
   * How much of the timeline exists. `null` means unlimited; a number caps
   * how many entries a shift may hold, which is how VERBAL gets its "single
   * optional note" without needing a separate screen.
   */
  maxEntries: number | null;
  /** Photo capture and the media pipeline behind it. */
  photos: boolean;
  /** Structured incidents, with severity and an incident id. */
  incidents: boolean;
  /** Package log. */
  packages: boolean;
  /**
   * What the end of a shift produces.
   * - `pdf`: the full report, generated and emailed.
   * - `email`: a short summary email, no PDF attached or stored.
   * - `none`: nothing leaves the building. The shift is recorded and that is all.
   */
  report: "pdf" | "email" | "none";
  /** Whether this site has a recipient list at all. */
  recipients: boolean;
};

/**
 * Exhaustive by type, deliberately. Adding a mode to the enum without deciding
 * what it permits fails the build here rather than defaulting to FULL
 * somewhere downstream, which is the failure that actually ships: a new mode
 * that silently behaves like the most permissive one.
 */
const CAPABILITIES: Record<LoggingMode, SiteCapabilities> = {
  FULL: {
    clockInChecklist: true,
    maxEntries: null,
    photos: true,
    incidents: true,
    packages: true,
    report: "pdf",
    recipients: true,
  },
  LIGHT: {
    // Timeline only. The guard still logs the night and still has photos and
    // incidents, because those are what makes the timeline worth keeping; what
    // the site declined was the document at the end of it.
    clockInChecklist: false,
    maxEntries: null,
    photos: true,
    incidents: true,
    packages: true,
    report: "email",
    recipients: true,
  },
  VERBAL: {
    // Clock in, clock out, and at most one note. No report, so no recipients,
    // so nothing to bounce and nothing to prove delivered. The dashboard
    // records that the shift happened, which is the whole of what this site
    // asked for.
    clockInChecklist: false,
    maxEntries: 1,
    photos: false,
    incidents: false,
    packages: false,
    report: "none",
    recipients: false,
  },
};

export function capabilitiesFor(mode: LoggingMode): SiteCapabilities {
  return CAPABILITIES[mode];
}

/**
 * Short, honest labels for the site settings screen. A supervisor changing
 * this is deciding what evidence their company will and will not hold, so the
 * description says what is lost, not only what is gained.
 */
export const MODE_COPY: Record<LoggingMode, { name: string; detail: string }> = {
  FULL: {
    name: "Full report",
    detail:
      "Clock-in checklist, the whole timeline, and a PDF report emailed to this site's recipients at the end of every shift.",
  },
  LIGHT: {
    name: "Timeline only",
    detail:
      "Guards log the shift as normal, but no PDF is produced. Recipients get a short summary email instead. Nothing is attached and nothing is stored to send later.",
  },
  VERBAL: {
    name: "Verbal handover",
    detail:
      "Clock in, clock out, and one optional note. No photos, no incidents, no report, and no recipient list. We record that the shift happened and nothing else leaves the building.",
  },
};

/**
 * Whether a shift at this site produces anything that can be sent.
 *
 * Kept as its own function because three separate screens need the same
 * question answered and the honest answer is a two-branch check that is easy
 * to get subtly wrong in each of them.
 */
export function producesReport(mode: LoggingMode): boolean {
  return capabilitiesFor(mode).report !== "none";
}
