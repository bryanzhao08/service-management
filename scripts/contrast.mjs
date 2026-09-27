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

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read the actual primitive and semantic tokens: the gate must follow the UI.
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
function declarations(block) {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}
const primitives = declarations(
  css.slice(css.indexOf("@theme {"), css.indexOf(":root,")),
);
const PALETTE = Object.fromEntries(
  ["dark", "light"].map((mode) => {
    const block = css.match(new RegExp(`\\.theme-${mode} \\{([^}]+)`))?.[1];
    if (!block) throw new Error(`Missing ${mode} theme`);
    return [mode, { ...primitives, ...declarations(block) }];
  }),
);
// Worst-case backgrounds through the chosen material: dark over white,
// light over black. Dark tint 92%, light tint 94% (globals.css).
PALETTE.dark.glass = "#2a2628";
PALETTE.light.glass = "#f0f0f0";
PALETTE.pdf = { text: "#000000", bg: "#ffffff" };

const FLOOR = { text: 4.5, large: 3, ui: 3, decorative: 0 };
const PAIRINGS = [];
for (const mode of ["dark", "light"]) {
  for (const background of ["bg", "surface", "surface-raised", "glass"]) {
    for (const foreground of ["text", "text-muted", "accent", "attention", "danger"]) {
      PAIRINGS.push([
        mode,
        `${foreground} on ${background}`,
        foreground,
        background,
        "text",
      ]);
    }
    PAIRINGS.push([
      mode,
      `focus ring on ${background}`,
      "focus-ring",
      background,
      "ui",
    ]);
    PAIRINGS.push([
      mode,
      `control outline on ${background}`,
      "border",
      background,
      "ui",
    ]);
  }
  for (const fill of [
    "primary",
    "primary-pressed",
    "secondary",
    "attention",
    "danger",
  ]) {
    PAIRINGS.push([mode, `${fill} label`, `on-${fill}`, fill, "text"]);
  }
}
PAIRINGS.push(["pdf", "printed body and headings", "text", "bg", "text"]);

// Negative controls make a broken/permissive luminance calculation fail.
const MUST_FAIL = [
  ["white text on white", "#ffffff", "#ffffff", "text"],
  ["burgundy text on black", "#941e42", "#000000", "text"],
  ["light gray text on white", "#bcb5b8", "#ffffff", "text"],
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

function resolve(name, mode) {
  if (name.startsWith("#")) return name;
  const value = PALETTE[mode]?.[name];
  if (!value) throw new Error(`Unknown ${mode} token ${name}`);
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return resolve(alias[1], mode);
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`Expected hex token, got ${name}: ${value}`);
  return value;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const rows = [];
  const failures = [];

  for (const [theme, use, fg, bg, kind] of PAIRINGS) {
    const ratio = contrastRatio(resolve(fg, theme), resolve(bg, theme));
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
    const ratio = contrastRatio(resolve(fg, "dark"), resolve(bg, "dark"));
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
    const ratio = contrastRatio(resolve(fg, "dark"), resolve(bg, "dark"));
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
