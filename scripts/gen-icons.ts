/** Generate PWA and native icons from one glass-lens vector and app tokens. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { brandIconArtwork } from "../src/lib/brand-icon";

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

function markSvg({
  size,
  plate,
  shade,
  accent,
  highlight,
  maskable,
  layer = "full",
}: {
  size: number;
  plate: string;
  shade: string;
  accent: string;
  highlight: string;
  maskable: boolean;
  layer?: "full" | "foreground" | "background";
}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${brandIconArtwork({ id: "transient", plate, shade, accent, highlight, maskable, layer })}</svg>`;
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
  const accent = await readToken(css, "color-burgundy");
  const shade = await readToken(css, "color-maroon");
  const highlight = await readToken(css, "color-rose");

  await mkdir(OUT, { recursive: true });

  for (const target of TARGETS) {
    const svg = markSvg({
      size: target.size,
      plate,
      shade,
      accent,
      highlight,
      maskable: target.maskable,
    });
    const pipeline = sharp(Buffer.from(svg)).png();
    const png = await (
      target.maskable ? pipeline.flatten({ background: plate }) : pipeline
    ).toBuffer();
    await writeFile(path.join(OUT, target.file), png);
    console.log(`wrote ${target.file} (${target.size}px, ${png.length} bytes)`);
  }

  // Capacitor's generator uses the opaque full-size source for every launcher.
  const nativeSvg = markSvg({
    size: 1024,
    plate,
    shade,
    accent,
    highlight,
    maskable: true,
  });
  await mkdir(path.join(ROOT, "mobile/assets"), { recursive: true });
  await writeFile(
    path.join(ROOT, "mobile/assets/icon-only.png"),
    await sharp(Buffer.from(nativeSvg)).png().toBuffer(),
  );
  await writeFile(path.join(ROOT, "public/icons/icon-source.svg"), nativeSvg);
  for (const layer of ["foreground", "background"] as const) {
    const svg = markSvg({
      size: 1024,
      plate,
      shade,
      accent,
      highlight,
      maskable: true,
      layer,
    });
    await writeFile(
      path.join(ROOT, `mobile/assets/icon-${layer}.png`),
      await sharp(Buffer.from(svg)).png().toBuffer(),
    );
  }
  // A black launch canvas avoids a white flash before the dark-default app loads.
  const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${plate}"/><svg x="1174" y="1174" width="384" height="384" viewBox="0 0 64 64">${brandIconArtwork({ id: "splash", plate, shade, accent, highlight })}</svg></svg>`;
  await writeFile(
    path.join(ROOT, "mobile/assets/splash.png"),
    await sharp(Buffer.from(splash)).png().toBuffer(),
  );

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
  console.log(`wrote manifest.webmanifest (theme ${plate}, accent ${accent})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
