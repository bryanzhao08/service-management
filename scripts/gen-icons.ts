/**
 * Generates the PWA icons and the web manifest from the same geometry and the
 * same colors as `<Mark>` in src/components/brand.tsx.
 *
 * The hexes are READ OUT of globals.css rather than typed here. A second copy
 * of `#76d337` in this file is a copy that drifts the day someone retunes the
 * palette, and nothing would fail — the icons would just quietly stop matching
 * the app. Same reasoning as tests/unit/email-palette.test.ts.
 *
 * Run: pnpm gen:icons
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

// tsx compiles this to CJS (package.json has no "type": "module"), so neither
// top-level await nor import.meta.dirname is available. pnpm always runs a
// script from the package root, and readToken below fails loudly if this path
// is wrong, so there is no silent-fallback risk in trusting cwd.
const ROOT = process.cwd();
const CSS = path.join(ROOT, "src/app/globals.css");
const OUT = path.join(ROOT, "public/icons");

/** Pulls a `--name: #hex;` declaration out of the stylesheet. */
async function readToken(css: string, name: string): Promise<string> {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) {
    throw new Error(
      `globals.css has no --${name} token. Icons must come from the palette, ` +
        `not from a hardcoded copy, so this is fatal rather than a fallback.`,
    );
  }
  return match[1];
}

/**
 * `rounded` matches `<Mark>`: a 15/64 corner radius, for contexts that show the
 * icon as-is. `maskable` fills the full square, because Android applies its own
 * mask and a pre-rounded plate leaves clipped corners inside it.
 *
 * The dot is r=13 of a 64 box, i.e. 20.3% of the width from center. The
 * maskable safe zone is the inner 80% (radius 25.6/64), so the dot sits well
 * inside it and one geometry serves both.
 */
function markSvg({
  size,
  plate,
  dot,
  maskable,
}: {
  size: number;
  plate: string;
  dot: string;
  maskable: boolean;
}): string {
  const rx = maskable ? 0 : 15;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rx}" fill="${plate}"/>
  <circle cx="32" cy="32" r="13" fill="${dot}"/>
</svg>`;
}

const TARGETS = [
  { file: "icon-32.png", size: 32, maskable: false },
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  // Apple composites its own rounding and refuses alpha, so this one is opaque
  // and square; iOS rounds it.
  { file: "apple-touch-icon.png", size: 180, maskable: true },
] as const;

async function main() {
  const css = await readFile(CSS, "utf8");
  const plate = await readToken(css, "color-ink");
  const dot = await readToken(css, "color-lime");

  await mkdir(OUT, { recursive: true });

  for (const target of TARGETS) {
    const svg = markSvg({ size: target.size, plate, dot, maskable: target.maskable });
    // Only the square variants get flattened. Flattening a ROUNDED icon fills
    // its transparent corners with the plate color, which makes the corner
    // radius invisible against any light background — the icon silently
    // becomes a square. Measured: corners came back #030701 either way until
    // this was made conditional.
    const pipeline = sharp(Buffer.from(svg)).png();
    const png = await (
      target.maskable ? pipeline.flatten({ background: plate }) : pipeline
    ).toBuffer();
    await writeFile(path.join(OUT, target.file), png);
    console.log(`wrote ${target.file} (${target.size}px, ${png.length} bytes)`);
  }

  const manifest = {
    name: "Transient",
    short_name: "Transient",
    description: "Log the shift. Leave on time.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: plate,
    theme_color: plate,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  const manifestPath = path.join(ROOT, "public/manifest.webmanifest");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote manifest.webmanifest (theme ${plate}, accent ${dot})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
