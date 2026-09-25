/**
 * Visual and interaction gate for the design system.
 *
 * `pnpm typecheck` and `pnpm test` cannot see any of what this checks. Each
 * assertion here exists because it caught a real bug during milestone 1:
 *
 *  - Theme panes that looked correct but were reading `<html>` rather than the
 *    pane, hiding whether `@theme inline` actually emitted var() references.
 *  - Controls that passed a bounding-box check at 48px while a switch pill,
 *    a checkbox, and a photo remove button were 28/24/28px to the finger.
 *  - The wordmark's accent dot sitting over the gap between "e" and "n"
 *    instead of over the "i", because its position was a hardcoded coordinate.
 *
 * Run against an already-serving build:
 *   BASE=http://127.0.0.1:3210 node scripts/check-ui.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? path.join(process.cwd(), "docs/screenshots");
/** Principle 1: minimum tap target 48x48 px. */
const TAP = 48;

await mkdir(OUT, { recursive: true });

const failures = [];
const notes = [];
const check = (name, ok, detail) => {
  (ok ? notes : failures).push(
    `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`,
  );
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/dev/ui`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// ---------------------------------------------------------------- theming --
// Both panes must resolve to DIFFERENT computed colours. That is the proof
// that the semantic layer went through `@theme inline`, emitting var()
// references, rather than freezing the palette value at build time. If it had
// frozen, both panes would compute identically and runtime theming would be
// dead while every static check still passed.
const panes = await page.evaluate(() => {
  const read = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  };
  return { dark: read("[data-pane='dark']"), light: read("[data-pane='light']") };
});
check("dark pane resolves a surface colour", !!panes.dark, JSON.stringify(panes.dark));
check(
  "light pane resolves a surface colour",
  !!panes.light,
  JSON.stringify(panes.light),
);
check(
  "themes resolve to different backgrounds",
  Boolean(panes.dark && panes.light && panes.dark.bg !== panes.light.bg),
  `${panes.dark?.bg} vs ${panes.light?.bg}`,
);
check(
  "themes resolve to different foregrounds",
  Boolean(panes.dark && panes.light && panes.dark.fg !== panes.light.fg),
  `${panes.dark?.fg} vs ${panes.light?.fg}`,
);

// ------------------------------------------------------------ tap targets --
// Measure what the finger hits (elementFromPoint), not the bounding box.
// Several controls legitimately keep a small visual and extend their target
// with the transparent `.tap-target` pseudo-element, which a bounding-box
// check cannot see in either direction.
const tapProbeFn = (TAP_PX) => {
  const r = TAP_PX / 2 - 0.5;
  // Edge midpoints only. A 48px circular button covers these but not its
  // bounding-box corners; penalising it for that would measure the shape
  // rather than the target. A genuinely undersized control still misses all
  // four.
  const offsets = [
    [0, -r],
    [0, r],
    [-r, 0],
    [r, 0],
  ];
  const bad = [];
  const sel =
    "button, a[href], input, select, textarea, [role='switch'], [role='checkbox']";
  for (const el of document.querySelectorAll(sel)) {
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) continue;
    // A disabled control is not a tap target; it sets pointer-events: none,
    // so probing it would measure whatever sits behind it.
    if (el.disabled || getComputedStyle(el).pointerEvents === "none") continue;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const missed = [];
    for (const [dx, dy] of offsets) {
      const x = cx + dx;
      const y = cy + dy;
      // Off-screen points cannot be probed; the control is still reachable
      // once scrolled, so do not count them against it.
      if (x < 0 || y < 0 || x > window.innerWidth - 1 || y > window.innerHeight - 1)
        continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) {
        missed.push({ dx, dy });
      }
    }
    if (missed.length) {
      bad.push({
        tag: el.tagName,
        label: (el.getAttribute("aria-label") || el.textContent || "")
          .trim()
          .slice(0, 30),
        size: `${Math.round(box.width)}x${Math.round(box.height)}`,
        missed: missed.length,
      });
    }
  }
  return bad;
};

const tapProbe = await page.evaluate(tapProbeFn, TAP);
check(
  `every control has a ${TAP}x${TAP} hit area`,
  tapProbe.length === 0,
  tapProbe.length ? JSON.stringify(tapProbe.slice(0, 5)) : `${TAP}px floor met`,
);

// Negative control. Strip the hit-area extension off the small controls and
// the same probe must flag every one of them. Without this the gate could be
// passing because it measures nothing.
const control = await page.evaluate((TAP_PX) => {
  const r = TAP_PX / 2 - 0.5;
  const targets = [...document.querySelectorAll(".tap-target")];
  if (!targets.length) return { stripped: 0, caught: 0 };
  for (const el of targets) el.classList.remove("tap-target");
  let caught = 0;
  for (const el of targets) {
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const miss = [
      [0, -r],
      [0, r],
      [-r, 0],
      [r, 0],
    ].some(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      return !hit || !(hit === el || el.contains(hit));
    });
    if (miss) caught += 1;
  }
  for (const el of targets) el.classList.add("tap-target");
  return { stripped: targets.length, caught };
}, TAP);
check(
  "tap probe is able to report a miss",
  control.stripped > 0 && control.caught === control.stripped,
  `removing .tap-target flags ${control.caught}/${control.stripped} small controls`,
);

// ----------------------------------------------------------------- timers --
// The clock is a module-level singleton read through useSyncExternalStore.
// Proving it ticks in a real browser is the only way to know the store is
// subscribed rather than frozen at its server snapshot.
const t1 = await page.locator("[aria-label='Time on shift']").first().textContent();
await page.waitForTimeout(2200);
const t2 = await page.locator("[aria-label='Time on shift']").first().textContent();
check(
  "elapsed timer advances in the browser",
  t1 !== t2,
  `${t1?.trim()} -> ${t2?.trim()}`,
);

// --------------------------------------------------------------- wordmark --
// The accent dot replaces the tittle of the "i". Its offset is a constant
// tuned to Inter's measured metrics, so read the rendered pixels rather than
// trusting the constant: it has to clear the stem and sit centred on it.
const markShot = await page
  .locator("[data-pane='dark'] span[role='img']")
  .first()
  .screenshot();
await writeFile(path.join(OUT, "wordmark.png"), markShot);
check(...(await checkWordmark(markShot)));

// --------------------------------------------------------------- overflow --
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
}));
check(
  "no horizontal overflow at 375px",
  overflow.scroll <= overflow.client,
  `${overflow.scroll} vs ${overflow.client}`,
);
await page.screenshot({ path: path.join(OUT, "ui-gallery-375.png"), fullPage: true });

await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "ui-gallery-1280.png"), fullPage: true });

check(
  "no console errors",
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(" | ") || "clean",
);

await browser.close();

console.log(notes.join("\n"));
if (failures.length) {
  console.log("\n" + failures.join("\n"));
  process.exit(1);
}
console.log(
  `\nAll ${notes.length} checks passed. Screenshots in ${path.relative(process.cwd(), OUT)}/`,
);

/**
 * Decode the wordmark screenshot and assert the accent dot reads as a tittle:
 * a visible gap above the stem, and horizontally centred on it.
 */
async function checkWordmark(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const at = (x, y) => {
    const i = (y * w + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const isLime = ([r, g, b]) => g > 120 && g - r > 40 && g - b > 40;
  const isInk = ([r, g, b]) => r + g + b > 120;

  const limeCols = [];
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      if (isLime(at(x, y))) {
        limeCols.push(x);
        break;
      }
    }
  }
  if (!limeCols.length)
    return ["wordmark accent dot reads as a tittle", false, "no dot found"];

  const x0 = limeCols[0];
  const x1 = limeCols[limeCols.length - 1];

  let dotBottom = -1;
  const stemRows = [];
  for (let y = 0; y < h; y += 1) {
    let lime = false;
    let ink = false;
    for (let x = x0; x <= x1; x += 1) {
      const p = at(x, y);
      if (isLime(p)) lime = true;
      else if (isInk(p)) ink = true;
    }
    if (lime) dotBottom = y;
    else if (ink) stemRows.push(y);
  }

  const stemTop = stemRows.find((y) => y > dotBottom);
  if (stemTop === undefined) {
    return [
      "wordmark accent dot reads as a tittle",
      false,
      "dot is not above any glyph",
    ];
  }

  const gap = stemTop - dotBottom - 1;
  if (gap < 1) {
    return [
      "wordmark accent dot reads as a tittle",
      false,
      `dot touches the stem (gap ${gap}px)`,
    ];
  }

  // Centring: compare the dot's centre against the run of ink directly beneath
  // it, which is the "i" stem.
  const scanTo = Math.min(stemTop + 4, h);
  const stemCols = [];
  for (let x = 0; x < w; x += 1) {
    for (let y = stemTop; y < scanTo; y += 1) {
      const p = at(x, y);
      if (isInk(p) && !isLime(p)) {
        stemCols.push(x);
        break;
      }
    }
  }
  const runs = [];
  for (const x of stemCols) {
    const last = runs[runs.length - 1];
    if (last && x - last[last.length - 1] <= 1) last.push(x);
    else runs.push([x]);
  }
  const dotCentre = (x0 + x1) / 2;
  const nearest = runs.reduce((best, r) =>
    Math.abs((r[0] + r[r.length - 1]) / 2 - dotCentre) <
    Math.abs((best[0] + best[best.length - 1]) / 2 - dotCentre)
      ? r
      : best,
  );
  const stemCentre = (nearest[0] + nearest[nearest.length - 1]) / 2;
  const offset = Math.abs(dotCentre - stemCentre);
  // Half the dot's own width: past that it stops reading as part of the letter.
  const tolerance = (x1 - x0 + 1) / 2;
  if (offset > tolerance) {
    return [
      "wordmark accent dot reads as a tittle",
      false,
      `dot is ${offset.toFixed(1)}px off the stem centre (tolerance ${tolerance.toFixed(1)}px)`,
    ];
  }
  return [
    "wordmark accent dot reads as a tittle",
    true,
    `gap ${gap}px, centred to ${offset.toFixed(1)}px`,
  ];
}
