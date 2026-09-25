import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Logo, Mark, Wordmark } from "@/components/brand";

/**
 * The rule under test: `title=""` means decorative.
 *
 * This exists because the opposite mistake is silent. `role="img"` with
 * `aria-label=""` still typechecks, still renders, still passes lint, still
 * builds, and still looks correct in a browser. What it actually produces is
 * an image with no accessible name, which a screen reader announces as a bare
 * "image" and which axe reports as svg-img-alt. Lighthouse caught it on the
 * real pages; nothing else did.
 *
 * The second half of the rule matters for a different reason. `Wordmark`
 * renders its visible text with U+0131 (dotless i), so a wrapping link labelled
 * "Transient home" would have an accessible name that does not contain its own
 * visible glyphs. That is label-content-name-mismatch: a speech-input user
 * saying what they can see would fail to activate the link. Making the wordmark
 * decorative when the caller names the link removes the conflict at the source.
 */
describe("Mark", () => {
  it("is named when given a title", () => {
    const { container } = render(<Mark title="Transient" />);
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Transient");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("leaves the accessibility tree entirely when the title is empty", () => {
    const { container } = render(<Mark title="" />);
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    // Both of these are the actual defect, not stylistic preferences. An
    // aria-hidden element that still claims role="img" is contradictory, and
    // aria-label="" on a role="img" is the unnamed-image failure itself.
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
  });

  it("defaults to named, because a standalone mark is the icon and needs a name", () => {
    // The default is deliberately NOT decorative: Mark is also the PWA icon,
    // the favicon source and the PDF header glyph, where it stands alone with
    // nothing else to carry the name. Decorative is the opt-in, chosen by the
    // caller that already has a label.
    const { container } = render(<Mark />);
    expect(container.querySelector("svg")!.getAttribute("role")).toBe("img");
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "Transient",
    );
  });
});

describe("Wordmark", () => {
  it("is named by default", () => {
    const { container } = render(<Wordmark />);
    const span = container.querySelector("span")!;

    expect(span.getAttribute("role")).toBe("img");
    expect(span.getAttribute("aria-label")).toBe("Transient");
  });

  it("goes decorative on an empty title so a wrapping link owns the name", () => {
    const { container } = render(<Wordmark title="" />);
    const span = container.querySelector("span")!;

    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.getAttribute("role")).toBeNull();
    expect(span.getAttribute("aria-label")).toBeNull();
  });

  it("renders the dotless glyph that forces the decorative rule", () => {
    // If this ever becomes a plain ASCII "i", the label-content-name-mismatch
    // half of the rule stops applying and this test should be revisited rather
    // than deleted. Pinning it here makes that a deliberate decision.
    const { container } = render(<Wordmark />);
    expect(container.textContent).toContain("\u0131");
  });
});

describe("Logo", () => {
  it("names the whole lockup once, not twice", () => {
    const { container } = render(<Logo />);

    const named = container.querySelectorAll("[aria-label]");
    expect(named).toHaveLength(1);
    expect(named[0]!.getAttribute("aria-label")).toBe("Transient");

    // And the half that is not named must be hidden rather than merely
    // unlabelled, which is what the original bug was.
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});
