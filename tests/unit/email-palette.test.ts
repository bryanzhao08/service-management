import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Email clients do not support CSS custom properties, so `lib/email/templates.ts`
 * hardcodes the brand colours as literal hexes. That is the only way to style an
 * HTML email, but it forks the palette: a token can be retuned in `globals.css`
 * and every email keeps the old colour silently, because nothing imports
 * anything and no type connects them.
 *
 * This test is the connection. It reads both files as text and fails if they
 * disagree, so the fork is loud instead of invisible.
 */

const root = process.cwd();
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
// Both email templates, because the fork this test exists to catch can open in
// either one. Scanning only the older plain-HTML file let the React template
// ship two invented shades.
const template = ["src/lib/email/templates.ts", "src/lib/email/report-email.tsx"]
  .map((f) => readFileSync(path.join(root, f), "utf8"))
  .join("\n");

/** Reads a `--name: #rrggbb` primitive out of globals.css. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match?.[1]) throw new Error(`token --${name} not found in globals.css`);
  return match[1].toLowerCase();
}

/** Every distinct 6-digit hex literal used in the email templates. */
function templateHexes(): Set<string> {
  return new Set(
    (template.match(/#[0-9a-fA-F]{6}/g) ?? []).map((h) => h.toLowerCase()),
  );
}

describe("email palette", () => {
  it("reads real tokens out of globals.css", () => {
    // Control. If the regex silently stopped matching, every assertion below
    // would compare undefined to undefined and pass while proving nothing.
    expect(token("color-ink")).toMatch(/^#[0-9a-f]{6}$/);
    expect(token("color-rose")).not.toEqual(token("color-ink"));
  });

  it("finds hexes in the email templates", () => {
    expect(templateHexes().size).toBeGreaterThan(0);
  });

  it("uses only colours that exist in the design tokens", () => {
    const known = new Set(
      [
        "color-ink",
        "color-paper",
        "color-rose",
        "color-burgundy",
        // Metadata lines and ungraded incidents. Muted, but still a token:
        // the point of this list is that the email cannot mix its own shade.
        "color-ash",
        // Incident severity. The colour only reinforces the level; the label
        // next to it always spells it out, so a reader who cannot tell copper
        // from ember still gets the grade.
        "color-charcoal",
        "color-rose",
        "color-blush",
      ].map(token),
    );
    const unknown = [...templateHexes()].filter((hex) => !known.has(hex));

    expect(
      unknown,
      `Email templates use ${unknown.join(", ")}, which is not a token in ` +
        `globals.css. Either add the colour as a token or use an existing one — ` +
        `an email must not invent a shade the product does not have.`,
    ).toEqual([]);
  });

  it("still uses the three brand colours it was built around", () => {
    // Pins the direction the other test cannot: dropping a colour from the
    // email entirely would leave `unknown` empty and pass.
    const used = templateHexes();
    for (const name of ["color-ink", "color-rose", "color-paper"]) {
      expect(used, `expected the email to use --${name}`).toContain(token(name));
    }
  });
});
