"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestSignUp, type SignUpState } from "./actions";

/**
 * Declared here, not in `actions.ts`. A `"use server"` module may only export
 * async functions, and exporting this object from there throws at request time
 * on every submit while compiling perfectly clean. Same reason
 * `sign-in-form.tsx` and `pin-forms.tsx` keep theirs local.
 */
const INITIAL: SignUpState = { errors: {}, formError: null };

export function SignUpForm({ plan }: { plan: string }) {
  const [state, formAction, pending] = useActionState(requestSignUp, INITIAL);
  const timezoneRef = useRef<HTMLInputElement>(null);

  // Asked of the browser rather than of the person. A timezone dropdown is
  // ~400 options and the wrong answer is not obvious for weeks: an entry made
  // at 11pm files against the wrong day, which is the one thing an overnight
  // log must get right. They can still change it in site settings.
  //
  // Written straight to the DOM node rather than held in state. The server
  // resolves this zone, not the browser, so nothing here renders it, and
  // rendering it would mean the server's zone on the first pass and the
  // reader's on the second, which is a hydration mismatch. An uncontrolled
  // input keeps whatever we assign, and FormData reads the live node.
  //
  // Deliberately no dependency array. React resets an uncontrolled form once
  // its action resolves, so a mount-only effect would hand the retry after a
  // validation error an empty field, and the server reads empty as
  // `America/Los_Angeles` with no way to tell it from a real Los Angeles.
  useEffect(() => {
    const node = timezoneRef.current;
    if (!node) return;
    try {
      node.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      node.value = "";
    }
  });

  return (
    // `formAction` and not a wrapper around it. Passing the server action
    // straight through is what makes React emit a real `action` attribute, so
    // the form still posts and still creates the account with no JavaScript at
    // all. A client wrapper reading the zone at submit would be tidier and
    // would silently make sign-up a JavaScript-only page.
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="plan" value={plan} />
      <input ref={timezoneRef} type="hidden" name="timezone" defaultValue="" />

      <Field label="Company name" error={state.errors["companyName"]} required>
        <Input
          name="companyName"
          autoComplete="organization"
          required
          placeholder="Meridian Protective Services"
        />
      </Field>

      <Field label="Your name" error={state.errors["name"]} required>
        <Input
          name="name"
          autoComplete="name"
          required
          placeholder="Dana Whitfield"
        />
      </Field>

      <Field
        label="Work email"
        hint="We'll send a link here to confirm it. No password."
        error={state.errors["email"]}
        required
      >
        <Input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="you@company.com"
        />
      </Field>

      <Field
        label="First site"
        hint="One post you cover. You can add more later."
        error={state.errors["siteName"]}
        required
      >
        <Input
          name="siteName"
          required
          placeholder="Westside Hotel — Sunset Strip"
        />
      </Field>

      <Field
        label="Site address"
        hint="Printed on every report header for this site."
        error={state.errors["siteAddress"]}
        required
      >
        <Input
          name="siteAddress"
          autoComplete="street-address"
          required
          placeholder="8400 Sunset Boulevard, West Hollywood, CA"
        />
      </Field>

      {state.formError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-text"
        >
          {state.formError}
        </p>
      ) : null}

      <Button type="submit" size="xl" fullWidth busy={pending}>
        Confirm my email
      </Button>
    </form>
  );
}
