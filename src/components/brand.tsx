import { cn } from "@/lib/utils";

/**
 * The Transient wordmark: lowercase "transient" with the dot of the "i"
 * replaced by a filled circle in the primary color (section 6.4).
 *
 * Drawn as real text, not outlined paths or SVG <text>, for one specific
 * reason: the accent dot has to sit over the "i". An SVG would need a
 * hardcoded x-coordinate measured against Inter's metrics, which silently
 * slides off the letter the moment the webfont fails to load and a fallback
 * is substituted. Here the dot is absolutely positioned inside an
 * inline-block wrapping *only* the dotless "ı", so it tracks that glyph's own
 * box whatever font resolves. Everything is sized in `em`, so the mark scales
 * with whatever font-size the caller sets.
 */
export function Wordmark({
  className,
  title = "Transient",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      // Same decorative rule as Mark: an empty title means the caller has
      // already named the thing (usually on a wrapping link), so this must
      // leave the accessibility tree rather than sit in it as an image with an
      // empty name. Leaving it as role="img" aria-label="" also exposes the
      // dotless-U+0131 glyphs as visible text under a differently-worded
      // ancestor label, which is the label-content-name-mismatch failure.
      {...(title === ""
        ? { "aria-hidden": true as const }
        : { role: "img", "aria-label": title })}
      className={cn(
        "inline-flex items-baseline font-semibold tracking-[-0.03em] whitespace-nowrap",
        // leading-none makes the inline-block's box a known 1em, so the dot's
        // offset below is a fixed number rather than one that drifts with
        // whatever line-height the surrounding context happens to set.
        "leading-none",
        className,
      )}
    >
      <span aria-hidden="true">trans</span>
      {/* U+0131 dotless i, so the lime dot below is the only tittle. */}
      <span aria-hidden="true" className="relative inline-block">
        &#x0131;
        {/*
         * Inter's own tittle spans 0.546em (x-height) to 0.762em above the
         * baseline, measured from TextMetrics rather than guessed. A 0.18em
         * dot whose bottom sits 0.60em above the baseline lands in that band
         * with a real gap over the stem.
         *
         * Offsets here are from the inline-block's box bottom, which
         * leading-none fixes at 0.187em below the baseline (measured off the
         * render, not derived: half-leading makes the arithmetic from font
         * metrics alone come out wrong). So 0.60 + 0.187 = 0.787em.
         * check-wordmark.py asserts the resulting gap in real pixels.
         */}
        <span className="absolute bottom-[0.787em] left-1/2 block size-[0.18em] -translate-x-1/2 rounded-full bg-primary" />
      </span>
      <span aria-hidden="true">ent</span>
    </span>
  );
}

/**
 * The standalone mark: the tittle inside a rounded square. Used for the PWA
 * icon, the favicon, and the PDF header. No gradients (section 6.4).
 *
 * `inverted` swaps to a light plate with a forest dot, for use on dark
 * backgrounds that are not `ink` — for example inside the printed PDF.
 */
export function Mark({
  className,
  inverted = false,
  title = "Transient",
}: {
  className?: string;
  inverted?: boolean;
  title?: string;
}) {
  const plate = inverted ? "#f7ffd7" : "#030701";
  const dot = inverted ? "#116906" : "#76d337";

  // An empty title means decorative — the mark is sitting next to the wordmark,
  // which already carries the name. Rendering `role="img" aria-label=""` in
  // that case produces an UNNAMED image, which a screen reader announces as a
  // bare "image" and which axe's svg-img-alt flags. Decorative means removing
  // it from the tree entirely, not naming it with an empty string.
  const decorative = title === "";

  return (
    <svg
      viewBox="0 0 64 64"
      {...(decorative
        ? { "aria-hidden": true as const, focusable: false }
        : { role: "img", "aria-label": title })}
      className={cn("h-8 w-8", className)}
    >
      <rect width="64" height="64" rx="15" fill={plate} />
      <circle cx="32" cy="32" r="13" fill={dot} />
    </svg>
  );
}

/** Wordmark plus mark, the default lockup for headers and the landing hero. */
export function Logo({
  className,
  showMark = true,
}: {
  className?: string;
  showMark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {showMark ? <Mark className="h-7 w-7" title="" /> : null}
      <Wordmark className="text-xl" />
    </span>
  );
}
