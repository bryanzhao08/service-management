"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestMagicLink, signInWithPin, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(requestMagicLink, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="from" value={from} />

      <Field
        label="Work email"
        hint="We'll email you a link that signs you in. No password."
        error={state.error}
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

      <Button type="submit" size="xl" fullWidth busy={pending}>
        Email me a link
      </Button>
    </form>
  );
}

/**
 * Email + PIN. Shown in place of the magic-link form when the server says the
 * provider is registered.
 *
 * The error is deliberately one message on the PIN field rather than per-field
 * validation: the server cannot say which half was wrong without revealing
 * whether the address has an account.
 */
export function PinSignInForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(signInWithPin, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="from" value={from} />

      <Field label="Work email" required>
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
        label="PIN"
        hint="The 4 to 6 digit PIN you set on this account."
        error={state.error}
        required
      >
        <Input
          type="password"
          name="pin"
          autoComplete="current-password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="••••••"
        />
      </Field>

      <Button type="submit" size="xl" fullWidth busy={pending}>
        Sign in
      </Button>
    </form>
  );
}
