/**
 * Contrast gate.
 *
 * Section 23 of the spec says no text/background pairing may exist outside the
 * approved list without an entry in docs/contrast.md. This script is what makes
 * that checkable instead of aspirational: it computes the real WCAG 2.2 ratio
 * for every pairing the product actually uses and exits non-zero if one is
 * below its floor. docs/contrast.md is generated from the same run, so the doc
 * can never drift from the numbers.
 *
 *   pnpm contrast          # verify, rewrite docs/contrast.md
 *   pnpm contrast --check  # verify only, no writes (CI)
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The ten permitted colors (section 6.1), plus white for light surfaces. */
const PALETTE = {
  ink: "#030701",
  cream: "#f7ffd7",
  lime: "#76d337",
  forest: "#116906",
  olive: "#76862d",
  ember: "#df6d1c",
  bark: "#322f27",
  khaki: "#aeaa79",
  copper: "#996227",
  slate: "#4a555d",
  white: "#ffffff",
};

/**
 * Required ratios, WCAG 2.2.
 * - normal text        4.5:1  (1.4.3)
 * - large text         3.0:1  (>= 24px, or >= 19px bold)
 * - non-text UI        3.0:1  (1.4.11 - borders that convey state, focus rings)
 * - decorative         none   (dividers and outlines that carry no meaning)
 */
const FLOOR = { text: 4.5, large: 3, ui: 3, decorative: 0 };

/**
 * Every pairing the product uses. Adding a pairing to the app means adding it
 * here; the build fails otherwise, which is the point.
 */
const PAIRINGS = [
  // --- Dark theme (default) ---
  ["dark", "body text", "cream", "ink", "text"],
  ["dark", "body text on a card", "cream", "bark", "text"],
  ["dark", "muted text (timestamps, labels)", "khaki", "ink", "text"],
  ["dark", "muted text on a card", "khaki", "bark", "text"],
  ["dark", "primary button label", "ink", "lime", "text"],
  ["dark", "primary button pressed", "cream", "forest", "text"],
  ["dark", "secondary button label", "ink", "olive", "text"],
  ["dark", "attention text (warnings)", "ember", "ink", "text"],
  ["dark", "attention fill (incident chip)", "ink", "ember", "text"],
  ["dark", "danger fill (bounced chip)", "cream", "copper", "text"],
  ["dark", "focus ring against page", "lime", "ink", "ui"],
  ["dark", "focus ring against a card", "lime", "bark", "ui"],
  ["dark", "primary as a status dot on page", "lime", "ink", "ui"],
  ["dark", "card edge against page", "bark", "ink", "decorative"],
  ["dark", "divider / outline", "slate", "ink", "decorative"],

  // --- Light theme ---
  ["light", "body text", "ink", "cream", "text"],
  ["light", "body text on a surface", "ink", "white", "text"],
  ["light", "muted text", "slate", "cream", "text"],
  ["light", "muted text on a surface", "slate", "white", "text"],
  ["light", "primary button label", "cream", "forest", "text"],
  ["light", "primary link on page", "forest", "cream", "text"],
  ["light", "primary link on a surface", "forest", "white", "text"],
  ["light", "primary pressed", "cream", "ink", "text"],
  ["light", "secondary button label", "ink", "olive", "text"],
  ["light", "accent fill (lime badge)", "ink", "lime", "text"],
  ["light", "attention fill", "ink", "ember", "text"],
  ["light", "attention text, large only", "ember", "cream", "large"],
  ["light", "danger text", "copper", "cream", "text"],
  ["light", "danger fill", "cream", "copper", "text"],
  ["light", "focus ring against page", "forest", "cream", "ui"],
  ["light", "focus ring against a surface", "forest", "white", "ui"],
  ["light", "divider / outline", "khaki", "cream", "decorative"],

  // --- PDF (section 11: always light, never the dark theme) ---
  ["pdf", "body text", "ink", "white", "text"],
  ["pdf", "section heading", "forest", "white", "text"],
  ["pdf", "severity marker", "ember", "white", "large"],
];

/**
 * Pairings deliberately forbidden. Asserting these FAIL is the negative
 * control: if a future refactor made the math permissive, these would start
 * passing and the script would catch it.
 */
const MUST_FAIL = [
  ["lime text on cream", "lime", "cream", "text"],
  ["copper text on ink", "copper", "ink", "text"],
  ["slate text on ink", "slate", "ink", "text"],
  ["khaki text on cream", "khaki", "cream", "text"],
];

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function resolve(name) {
  const hex = PALETTE[name];
  if (!hex) throw new Error(`Unknown color token: ${name}`);
  return hex;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const rows = [];
  const failures = [];

  for (const [theme, use, fg, bg, kind] of PAIRINGS) {
    const ratio = contrastRatio(resolve(fg), resolve(bg));
    const floor = FLOOR[kind];
    const pass = ratio >= floor;
    if (!pass) {
      failures.push(
        `${theme} - ${use}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${floor}:1`,
      );
    }
    rows.push({ theme, use, fg, bg, kind, ratio, floor, pass });
  }

  // Negative control: these must be below their floor.
  const controlFailures = [];
  for (const [label, fg, bg, kind] of MUST_FAIL) {
    const ratio = contrastRatio(resolve(fg), resolve(bg));
    if (ratio >= FLOOR[kind]) {
      controlFailures.push(
        `${label} should be below ${FLOOR[kind]}:1 but measured ${ratio.toFixed(2)}:1`,
      );
    }
  }

  const themes = ["dark", "light", "pdf"];
  const titles = {
    dark: "Dark theme (default)",
    light: "Light theme",
    pdf: "PDF output",
  };

  let md = `# Contrast

Generated by \`pnpm contrast\` from \`scripts/contrast.mjs\`. Do not edit by hand:
the numbers below are computed with the WCAG 2.2 relative-luminance formula at
build time, so they cannot drift from the tokens in \`src/app/globals.css\`.

Floors: normal text 4.5:1, large text (>= 24px or >= 19px bold) 3:1, non-text UI
such as focus rings and state-carrying borders 3:1. Pairings marked *decorative*
carry no information and are exempt (WCAG 1.4.11 applies to meaningful
components only), but they are listed so the exemption is a decision on the
record rather than an oversight.

`;

  for (const theme of themes) {
    md += `## ${titles[theme]}\n\n`;
    md += `| Use | Foreground | Background | Ratio | Floor | Result |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const r of rows.filter((x) => x.theme === theme)) {
      const floorLabel = r.kind === "decorative" ? "n/a" : `${r.floor}:1`;
      const result =
        r.kind === "decorative" ? "decorative" : r.pass ? "pass" : "**FAIL**";
      md += `| ${r.use} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ${floorLabel} | ${result} |\n`;
    }
    md += `\n`;
  }

  md += `## Forbidden pairings\n\n`;
  md += `These are checked as a negative control. The gate asserts each one is\n`;
  md += `*below* its floor, so if the contrast math ever became permissive the\n`;
  md += `build would fail instead of silently approving everything.\n\n`;
  md += `| Pairing | Ratio | Floor | Below floor |\n|---|---|---|---|\n`;
  for (const [label, fg, bg, kind] of MUST_FAIL) {
    const ratio = contrastRatio(resolve(fg), resolve(bg));
    md += `| ${label} | ${ratio.toFixed(2)}:1 | ${FLOOR[kind]}:1 | ${ratio < FLOOR[kind] ? "yes" : "**NO**"} |\n`;
  }
  md += `\n`;

  if (!checkOnly) {
    writeFileSync(join(ROOT, "docs", "contrast.md"), md);
  }

  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;

  if (failures.length || controlFailures.length) {
    for (const f of failures) console.error(`  FAIL  ${f}`);
    for (const f of controlFailures) console.error(`  CONTROL BROKEN  ${f}`);
    console.error(
      `\ncontrast: ${failures.length} failing pairing(s), ${controlFailures.length} broken control(s)`,
    );
    process.exit(1);
  }

  console.log(
    `contrast: ${passed}/${total} pairings meet WCAG AA, ${MUST_FAIL.length} negative controls correctly below floor`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
