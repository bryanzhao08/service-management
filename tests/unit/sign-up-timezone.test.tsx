import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignUpForm } from "@/app/(auth)/sign-up/sign-up-form";

// The action is a `"use server"` module that reaches Prisma and the mailer.
// None of that is the subject here: what is under test is what the form hands
// it for a field the person never sees and cannot correct.
vi.mock("@/app/(auth)/sign-up/actions", () => ({
  requestSignUp: vi.fn(async () => ({ errors: {}, formError: null })),
}));

/**
 * Captured once, before any spy exists. Reading `Intl.DateTimeFormat` inside
 * the helper instead would capture the previous test's mock and call it with
 * `new`, which throws, which the form catches, which turns every case after
 * the first into a silent empty string that looks like a product bug.
 */
const REAL_DATE_TIME_FORMAT = Intl.DateTimeFormat;

function withZone(zone: string) {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
      const fmt = new REAL_DATE_TIME_FORMAT(...args);
      return {
        ...fmt,
        resolvedOptions: () => ({ ...fmt.resolvedOptions(), timeZone: zone }),
      } as Intl.DateTimeFormat;
    },
  );
}

function timezoneInput() {
  return document.querySelector<HTMLInputElement>(
    'form input[type="hidden"][name="timezone"]',
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sign-up timezone", () => {
  /**
   * This is the one thing the whole suite could not see and a browser could.
   * The value is decided in the browser, so a compile-clean, suite-green build
   * shipped an empty field and fell back to `America/Los_Angeles` for
   * everyone. That fallback is right when there is no JavaScript and wrong
   * when there is, and the two are indistinguishable in the database after.
   */
  it("sends the browser's timezone, not a default", () => {
    withZone("Europe/Berlin");
    render(<SignUpForm plan="" />);

    expect(timezoneInput()).not.toBeNull();
    expect(timezoneInput()?.value).toBe("Europe/Berlin");
  });

  it("tracks whatever zone the browser reports", () => {
    // A second, unrelated zone. One alone cannot tell a working detection from
    // a constant that happens to match.
    withZone("Asia/Tokyo");
    render(<SignUpForm plan="" />);

    expect(timezoneInput()?.value).toBe("Asia/Tokyo");
  });

  it("leaves the field empty when the browser refuses, so the server decides", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl here");
    });
    render(<SignUpForm plan="" />);

    // Empty is the honest answer. `signUpSchema` turns it into the documented
    // fallback; guessing a zone here would hide that it was a guess.
    expect(timezoneInput()?.value).toBe("");
  });

  it("restores the zone after a re-render, not only on mount", () => {
    // React resets an uncontrolled form once its action resolves, so a
    // mount-only effect hands the retry after a validation error an empty
    // field. Re-rendering stands in for that reset here.
    withZone("Australia/Perth");
    const { rerender } = render(<SignUpForm plan="" />);
    timezoneInput()!.value = "";

    rerender(<SignUpForm plan="starter" />);
    expect(timezoneInput()?.value).toBe("Australia/Perth");
  });

  it("carries the timezone inside the form, where FormData will read it", () => {
    withZone("Europe/Berlin");
    const { container } = render(<SignUpForm plan="essential" />);

    const form = container.querySelector("form") as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(new FormData(form).get("timezone")).toBe("Europe/Berlin");
    // The plan rides along the same way, so a broken hidden field shows up
    // here rather than silently dropping the reader's chosen plan.
    expect(new FormData(form).get("plan")).toBe("essential");
  });

  it("still renders the fields a person has to fill in", () => {
    withZone("Europe/Berlin");
    render(<SignUpForm plan="" />);

    // Guards against a refactor that satisfies everything above by rendering
    // nothing but hidden inputs.
    expect(screen.getByRole("textbox", { name: /company name/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /confirm my email/i }),
    ).toBeTruthy();
  });

  /**
   * Read from source because the property is invisible once React has rendered
   * client-side, and it is easy to destroy while every other test stays green.
   * Handing `<form action>` the action from `useActionState` is what makes
   * React emit a real `action` attribute, so the page still works with no
   * JavaScript. Wrapping it in a client function to read the timezone at
   * submit looks tidier, passes every assertion above, and quietly makes
   * sign-up JavaScript-only: the no-JS submit then posts nowhere and the
   * account is never created. Measured in a browser, not assumed.
   */
  it("binds the server action directly, so sign-up works without JavaScript", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(auth)/sign-up/sign-up-form.tsx"),
      "utf8",
    );

    expect(source).toMatch(/<form\s+action=\{formAction\}/);
  });
});
