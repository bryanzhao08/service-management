/**
 * The size-budget algorithm from section 11, kept as a pure function so it can
 * be tested without rendering anything.
 *
 * The problem it solves: a busy event night produces 40 photos, an 8 MB email
 * attachment cap is real, and the wrong answer is to split the report across
 * several emails. Section 12 is explicit that a report is exactly one message,
 * because per-recipient delivery status is meaningless if "the report" is three
 * messages of which one bounced.
 *
 * So the document degrades instead, in a fixed order, and every step it took is
 * written to `Report.sizeSteps` and printed in the footer. A thin report should
 * be explainable, not mysterious.
 */

export const SIZE_CAP_BYTES = 8 * 1024 * 1024;

export type BudgetPlan = {
  /** Which stored variant to embed. */
  variant: "pdf" | "medium" | "thumb";
  /** Re-encode target when `variant` is `medium`; null means use the stored one. */
  reencode: { longEdge: number; quality: number } | null;
  perEntry: number;
  perIncident: number;
  /** Printed in the footer when this step is not the first. */
  note: string | null;
};

export type BudgetStep = {
  step: number;
  plan: Omit<BudgetPlan, "note">;
  bytes: number;
  underCap: boolean;
};

/**
 * The ladder. Index 0 is the ideal render; each rung gives up something the
 * previous rung kept, cheapest loss first.
 *
 * Photo *size* is reduced before photo *count*, deliberately. A smaller photo
 * still proves the thing happened; a missing photo does not. Only when both
 * have been tried does it fall back to thumbnails, which always fits — 40
 * thumbnails at ~2 KB is nowhere near 8 MB — so the ladder cannot fail.
 */
export function budgetLadder(caps: {
  perEntry: number;
  perIncident: number;
}): BudgetPlan[] {
  return [
    {
      variant: "pdf",
      reencode: null,
      perEntry: caps.perEntry,
      perIncident: caps.perIncident,
      note: null,
    },
    {
      variant: "medium",
      reencode: { longEdge: 1200, quality: 65 },
      perEntry: caps.perEntry,
      perIncident: caps.perIncident,
      note: "Images reduced to fit email limits.",
    },
    {
      variant: "medium",
      reencode: { longEdge: 1200, quality: 65 },
      perEntry: Math.min(2, caps.perEntry),
      perIncident: Math.min(3, caps.perIncident),
      note: "Images reduced and some photos moved to the gallery to fit email limits.",
    },
    {
      variant: "thumb",
      reencode: null,
      perEntry: Math.min(2, caps.perEntry),
      perIncident: Math.min(3, caps.perIncident),
      note: "Thumbnails only. Full-resolution photos are in the gallery.",
    },
  ];
}

/**
 * Was the attempt good enough to stop?
 *
 * The last rung always wins even if it is somehow still over, because the
 * alternative is no report at all. A report that is too large to attach is
 * still worth sending as a link, and section 12 already handles that case.
 */
export function accept(bytes: number, rung: number, total: number): boolean {
  return bytes <= SIZE_CAP_BYTES || rung >= total - 1;
}

/** Human-readable trail for `Report.sizeSteps` and the end-of-shift screen. */
export function describeSteps(steps: BudgetStep[]): string[] {
  return steps.map((s) => {
    const mb = (s.bytes / 1024 / 1024).toFixed(2);
    const what =
      s.plan.variant === "thumb"
        ? "thumbnails"
        : s.plan.reencode
          ? `${s.plan.reencode.longEdge}px q${s.plan.reencode.quality}`
          : "print-size images";
    return `${what}, up to ${s.plan.perEntry} per entry and ${s.plan.perIncident} per incident: ${mb} MB${
      s.underCap ? " (accepted)" : " (over cap, stepping down)"
    }`;
  });
}

/**
 * Page count read straight from the PDF bytes.
 *
 * @react-pdf does not report it, and re-parsing with a full PDF library to
 * learn one integer is not worth the dependency. `/Type /Page` appears once per
 * page object; `/Type /Pages` is the tree node, so the negative lookahead is
 * what stops it being counted as a page of its own.
 */
export function countPages(buf: Buffer): number {
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s])/g);
  return matches ? matches.length : 1;
}
