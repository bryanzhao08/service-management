import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";

/**
 * The report is a **light** document, and that is a deliberate break from the
 * rest of the product.
 *
 * Everything a guard touches is a dark theme, because they use it at 3am and a
 * white screen at 3am destroys night vision and announces where they are
 * standing. None of that applies to the report: it is read on a desk, in an
 * office, in daylight, and it is printed and forwarded. A dark PDF costs the
 * reader a toner cartridge and looks broken in Gmail's inline viewer.
 *
 * So: white page, ink text, forest headings, ember reserved for severity.
 * Section 11.
 */

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

let registered = false;

/**
 * Registered lazily rather than at module load.
 *
 * `Font.register` reads from disk, and this module is imported by the job
 * runner, the API route and the tests. Doing it at import time means any one of
 * them pays for it whether or not a PDF is ever rendered, and a missing font
 * file becomes an import-time crash in a request that was never going to render
 * anything.
 */
export function registerFonts(): void {
  if (registered) return;
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(FONT_DIR, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Inter-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Without this, a long incident code or a URL with no spaces overflows the
  // page box instead of breaking. @react-pdf has no `overflow-wrap: anywhere`.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export const COLORS = {
  ink: "#030701",
  forest: "#116906",
  ember: "#df6d1c",
  rule: "#d8dcd6",
  muted: "#5b625a",
  faint: "#f2f4f1",
  page: "#ffffff",
} as const;

/** Letter at 72dpi is 612x792. Section 11 asks for 0.6in margins. */
export const PAGE = {
  width: 612,
  height: 792,
  margin: 0.6 * 72,
} as const;

export const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

export const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.page,
    color: COLORS.ink,
    fontFamily: "Inter",
    fontSize: 9,
    lineHeight: 1.45,
    paddingTop: PAGE.margin,
    paddingBottom: PAGE.margin + 18,
    paddingHorizontal: PAGE.margin,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    paddingBottom: 6,
    marginBottom: 14,
  },
  headerMark: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerDot: { width: 7, height: 7, backgroundColor: COLORS.forest, borderRadius: 1 },
  headerWord: { fontSize: 10, fontWeight: 600, letterSpacing: 0.3 },
  headerRight: { alignItems: "flex-end" },
  headerTitle: { fontSize: 9, fontWeight: 600 },
  headerMeta: { fontSize: 7.5, color: COLORS.muted },

  h1: { fontSize: 17, fontWeight: 700, color: COLORS.forest, marginBottom: 2 },
  h2: {
    fontSize: 11,
    fontWeight: 600,
    color: COLORS.forest,
    marginTop: 14,
    marginBottom: 6,
  },
  h3: { fontSize: 9.5, fontWeight: 600, marginBottom: 3 },
  muted: { color: COLORS.muted },
  small: { fontSize: 7.5 },

  row: { flexDirection: "row" },
  grow: { flexGrow: 1, flexBasis: 0 },

  // Cover ------------------------------------------------------------------
  factGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  fact: { width: "25%", paddingRight: 8, marginBottom: 8 },
  factLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  factValue: { fontSize: 10, fontWeight: 600 },

  countRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  countChip: {
    backgroundColor: COLORS.faint,
    borderRadius: 2,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },

  // Tables -----------------------------------------------------------------
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.ink,
    paddingBottom: 3,
    marginBottom: 2,
  },
  thText: {
    fontSize: 7,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.rule,
    paddingVertical: 3,
  },

  // Timeline ---------------------------------------------------------------
  entry: { flexDirection: "row", paddingVertical: 3.5, gap: 8 },
  entryTime: { width: 34, fontWeight: 600, fontSize: 8.5 },
  entryType: {
    width: 58,
    fontSize: 7,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  entryBody: { flexGrow: 1, flexBasis: 0 },
  deleted: { textDecoration: "line-through", color: COLORS.muted },

  // Photos -----------------------------------------------------------------
  photoRow: { flexDirection: "row", gap: 6, marginTop: 4, marginBottom: 2 },
  photoCell: { width: (CONTENT_WIDTH - 12) / 3 },
  photo: { width: "100%", objectFit: "cover", borderRadius: 2 },
  caption: { fontSize: 6.5, color: COLORS.muted, marginTop: 1.5 },

  // Incidents --------------------------------------------------------------
  incident: {
    borderWidth: 0.5,
    borderColor: COLORS.rule,
    borderLeftWidth: 2.5,
    borderLeftColor: COLORS.ember,
    borderRadius: 2,
    padding: 8,
    marginBottom: 8,
  },
  sevChip: {
    fontSize: 7,
    fontWeight: 600,
    color: COLORS.ember,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  // Footer -----------------------------------------------------------------
  /**
   * The footer is a set of absolutely positioned `fixed` Text nodes with no
   * `render` prop anywhere among them. That restriction is the whole point.
   *
   * @react-pdf 7.0.x does not lay out a `render`-prop Text, and it does not
   * fail alone: bisected against real renders, a `render` child collapses its
   * entire parent container, so the footer's report id and SHA-256 were
   * painted nowhere while the identical markup without that one sibling
   * rendered fine. The strings still reach the content stream, so pypdf found
   * every one of them and the gate went green over a footer no human could
   * see. It took rasterising the page to notice.
   *
   * `Page N of M` is therefore gone. The cover states the document's length
   * instead, settled by a second render pass (see `settlePageCount`), and
   * `check-report.mjs` now asserts painted bounding boxes so this exact
   * regression fails loudly.
   */
  footerRule: {
    position: "absolute",
    bottom: PAGE.margin + 4,
    left: PAGE.margin,
    width: CONTENT_WIDTH,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.rule,
  },
  // Sized for ONE line. @react-pdf does not clip an absolutely positioned
  // Text to its box, so a second line silently runs down through the rule and
  // off the bottom of the page. The footer therefore carries the short hash;
  // the full 64-character digest is a field on the cover.
  footerLeft: {
    position: "absolute",
    bottom: PAGE.margin - 6,
    left: PAGE.margin,
    width: CONTENT_WIDTH - 72,
  },
  footerRight: {
    position: "absolute",
    bottom: PAGE.margin - 6,
    left: PAGE.margin + CONTENT_WIDTH - 72,
    width: 72,
    textAlign: "right",
  },
  footerText: { fontSize: 6.5, color: COLORS.muted },
  integrity: {
    marginTop: 10,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 8,
    paddingRight: 8,
    backgroundColor: COLORS.faint,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.rule,
  },
  hashLine: { fontSize: 7, color: COLORS.ink, marginTop: 2, marginBottom: 2 },
  /** Table cells need their own right padding: @react-pdf does not clip an
   *  overlong Text to its declared width, so without a gutter a long
   *  tracking number runs straight into the next column. */
  cell: { paddingRight: 8 },
});
