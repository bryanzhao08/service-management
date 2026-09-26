import { describe, expect, it } from "vitest";

import { styles } from "@/lib/reports/theme";

/**
 * The report PDF's line boxes.
 *
 * `@react-pdf/renderer` resolves a unitless `lineHeight` once, against the font
 * size of the element that declares it. The page declares `lineHeight: 1.45` at
 * `fontSize: 9`, so every child inherits a fixed ~13pt line box regardless of
 * how large its own text is. Anything meaningfully larger than the page font
 * overflows that box and is drawn on top of whatever follows it.
 *
 * That is not hypothetical. The site name at 17pt needed ~20.6pt and had 15.05
 * (13.05 inherited + its 2pt margin), so the date underneath it was rendered
 * 5.5pt inside the title's glyphs on every report anyone had ever downloaded.
 *
 * This asserts the invariant rather than the one instance, because the next
 * heading someone adds will inherit the same trap.
 */

/** react-pdf lays Inter out at roughly 1.21x the nominal size. */
const GLYPH_BOX = 1.21;

const PAGE_LINE_BOX = (styles.page.fontSize as number) * (styles.page.lineHeight as number);

type Style = { fontSize?: number; lineHeight?: number; marginBottom?: number };

const sized = Object.entries(styles as Record<string, Style>).filter(
  ([name, s]) => name !== "page" && typeof s.fontSize === "number",
);

describe("report PDF line boxes", () => {
  it("has styles to check, so this cannot pass vacuously", () => {
    expect(sized.length).toBeGreaterThan(5);
  });

  it.each(sized)("%s leaves room for its own glyphs", (_name, style) => {
    const size = style.fontSize as number;
    const needed = size * GLYPH_BOX;
    // A style that sets its own lineHeight resolves against its own fontSize,
    // which is the fix. Otherwise it is stuck with the page's line box and has
    // only its bottom margin to absorb the difference.
    const available =
      typeof style.lineHeight === "number"
        ? size * style.lineHeight + (style.marginBottom ?? 0)
        : PAGE_LINE_BOX + (style.marginBottom ?? 0);

    expect(available).toBeGreaterThanOrEqual(needed);
  });

  it("keeps the site name from colliding with the date beneath it", () => {
    const h1 = styles.h1 as Style;
    const size = h1.fontSize as number;
    expect(size).toBeGreaterThan(styles.page.fontSize as number);
    expect(h1.lineHeight).toBeTypeOf("number");
    expect(size * (h1.lineHeight as number)).toBeGreaterThanOrEqual(size * GLYPH_BOX);
  });
});
