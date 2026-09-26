import { describe, expect, it } from "vitest";

import {
  accept,
  budgetLadder,
  countPages,
  describeSteps,
  SIZE_CAP_BYTES,
} from "@/lib/reports/budget";

/**
 * The size-budget ladder, tested as arithmetic.
 *
 * Section 11 asks for this specific behaviour to be unit-tested, and it is the
 * right call: the ladder decides what a client sees, and it only fires on the
 * nights that are already going badly — a 40-photo incident shift. That is the
 * worst possible time to discover it by accident in production.
 */

describe("budget ladder", () => {
  const caps = { perEntry: 3, perIncident: 6 };

  it("starts at full quality with the site's own caps", () => {
    const first = budgetLadder(caps)[0];
    expect(first.variant).toBe("pdf");
    expect(first.reencode).toBeNull();
    expect(first.perEntry).toBe(3);
    expect(first.perIncident).toBe(6);
    // The ideal render adds no apology to the footer.
    expect(first.note).toBeNull();
  });

  it("degrades photo size before photo count", () => {
    const [full, smaller, fewer] = budgetLadder(caps);
    // Step 2 shrinks but keeps every photo.
    expect(smaller.reencode).toEqual({ longEdge: 1200, quality: 65 });
    expect(smaller.perEntry).toBe(full.perEntry);
    expect(smaller.perIncident).toBe(full.perIncident);
    // Only step 3 starts dropping them.
    expect(fewer.perEntry).toBeLessThan(full.perEntry);
    expect(fewer.perIncident).toBeLessThan(full.perIncident);
  });

  it("never raises a cap a site set below the fallback", () => {
    // A site that allows 1 photo per entry must not get 2 because the report
    // was too big. The ladder only ever takes away.
    const tight = budgetLadder({ perEntry: 1, perIncident: 2 });
    for (const rung of tight) {
      expect(rung.perEntry).toBeLessThanOrEqual(1);
      expect(rung.perIncident).toBeLessThanOrEqual(2);
    }
  });

  it("ends on thumbnails, which always fit", () => {
    const ladder = budgetLadder(caps);
    expect(ladder[ladder.length - 1].variant).toBe("thumb");
  });

  it("explains itself in the footer from step 2 onward", () => {
    const ladder = budgetLadder(caps);
    expect(
      ladder.slice(1).every((r) => typeof r.note === "string" && r.note.length > 0),
    ).toBe(true);
  });
});

describe("accept", () => {
  const total = budgetLadder({ perEntry: 3, perIncident: 6 }).length;

  it("stops as soon as the file is under the cap", () => {
    expect(accept(SIZE_CAP_BYTES - 1, 0, total)).toBe(true);
  });

  it("keeps stepping down while over the cap", () => {
    expect(accept(SIZE_CAP_BYTES + 1, 0, total)).toBe(false);
    expect(accept(SIZE_CAP_BYTES + 1, total - 2, total)).toBe(false);
  });

  it("ships the last rung even if it is somehow still over", () => {
    // A 9 MB report nobody can attach still beats no report. Section 12 sends
    // a link in that case; it cannot do that if the render threw.
    expect(accept(SIZE_CAP_BYTES * 2, total - 1, total)).toBe(true);
  });

  it("treats exactly the cap as fitting", () => {
    expect(accept(SIZE_CAP_BYTES, 0, total)).toBe(true);
  });
});

describe("describeSteps", () => {
  it("names the megabytes and the outcome of every attempt", () => {
    const lines = describeSteps([
      {
        step: 1,
        plan: { variant: "pdf", reencode: null, perEntry: 3, perIncident: 6 },
        bytes: 12 * 1024 * 1024,
        underCap: false,
      },
      {
        step: 2,
        plan: {
          variant: "medium",
          reencode: { longEdge: 1200, quality: 65 },
          perEntry: 3,
          perIncident: 6,
        },
        bytes: 4 * 1024 * 1024,
        underCap: true,
      },
    ]);

    expect(lines[0]).toContain("12.00 MB");
    expect(lines[0]).toContain("over cap");
    expect(lines[1]).toContain("1200px q65");
    expect(lines[1]).toContain("accepted");
  });
});

describe("countPages", () => {
  it("counts page objects and not the page tree", () => {
    // `/Type /Pages` is the tree node. Counting it would report one page too
    // many on every report ever generated, which is exactly the sort of
    // off-by-one nobody notices until a client counts.
    const fake = Buffer.from(
      "%PDF-1.7\n/Type /Pages /Count 2\n/Type /Page\n/Type /Page\n",
      "latin1",
    );
    expect(countPages(fake)).toBe(2);
  });

  it("never reports zero", () => {
    expect(countPages(Buffer.from("%PDF-1.7\n", "latin1"))).toBe(1);
  });
});
