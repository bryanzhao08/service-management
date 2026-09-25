"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestMagicLink, type SignInState } from "./actions";

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
