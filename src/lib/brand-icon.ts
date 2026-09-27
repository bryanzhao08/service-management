/** Shared vector artwork for the web mark, PWA and native launcher assets. */
export function brandIconArtwork({
  id,
  plate,
  shade,
  accent,
  highlight,
  maskable = false,
  layer = "full",
}: {
  id: string;
  plate: string;
  shade: string;
  accent: string;
  highlight: string;
  maskable?: boolean;
  layer?: "full" | "foreground" | "background";
}) {
  return `<defs>
    <linearGradient id="${id}-plate" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${shade}"/><stop offset="0.55" stop-color="${plate}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
    <linearGradient id="${id}-lens" x1="0.25" y1="0" x2="0.7" y2="1">
      <stop stop-color="${highlight}"/><stop offset="0.45" stop-color="${accent}"/><stop offset="1" stop-color="${shade}"/>
    </linearGradient>
    <linearGradient id="${id}-shine" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#ffffff" stop-opacity="0.65"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${layer === "foreground" ? "" : `<rect width="64" height="64" rx="${maskable ? 0 : 15}" fill="url(#${id}-plate)"/>`}
  ${maskable || layer === "foreground" ? "" : '<rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="none" stroke="#ffffff" stroke-opacity="0.15"/>'}
  ${
    layer === "background"
      ? ""
      : `
  <circle cx="32" cy="34" r="15" fill="#000000" opacity="0.35"/>
  <circle cx="32" cy="32" r="14" fill="url(#${id}-lens)"/>
  <circle cx="32" cy="32" r="13.5" fill="none" stroke="${highlight}" stroke-opacity="0.6"/>
  <path d="M20 30C21 17 42 17 44 30C37 25 27 25 20 30Z" fill="url(#${id}-shine)"/>
  <path d="M24 42C28 46 37 46 41 40" fill="none" stroke="${highlight}" stroke-opacity="0.35" stroke-width="0.75"/>`
  }
  ${layer === "foreground" ? "" : '<path d="M9 11C20 5 44 5 55 11" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="0.75"/>'}`;
}
