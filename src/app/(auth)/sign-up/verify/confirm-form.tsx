"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { completeSignUp, type CompleteState } from "../actions";

/** Local for the same reason as `sign-up-form.tsx`: see the note in `actions.ts`. */
const INITIAL: CompleteState = { error: null };

export function ConfirmSignUpForm({
  token,
  plan,
}: {
  token: string;
  plan: string;
}) {
  const [state, formAction, pending] = useActionState(completeSignUp, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="plan" value={plan} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-text"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="xl" fullWidth busy={pending}>
        Create my account
      </Button>
    </form>
  );
}
