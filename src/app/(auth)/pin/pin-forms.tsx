"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  forgotPin,
  skipPin,
  submitSetPin,
  submitVerifyPin,
  type PinState,
} from "./actions";

const INITIAL: PinState = { error: null };

/**
 * `inputMode="numeric"` plus `pattern` is what brings up the digit keypad on
 * iOS and Android. `type="password"` keeps the PIN masked; a `type="number"`
 * would show spinners and strip leading zeros, which silently turns 0412 into
 * 412.
 */
const pinInputProps = {
  type: "password",
  inputMode: "numeric" as const,
  pattern: "[0-9]*",
  maxLength: 6,
  autoComplete: "off",
  required: true,
  className: "text-center text-2xl tracking-[0.5em] tabular-nums",
};

export function SetPinForm() {
  const [state, formAction, pending] = useActionState(submitSetPin, INITIAL);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-5">
        <Field
          label="Choose a PIN"
          hint="4 to 6 digits. You'll use this to open Transient on this phone."
          error={state.error}
          required
        >
          <Input {...pinInputProps} name="pin" autoFocus />
        </Field>

        <Field label="Confirm PIN" required>
          <Input {...pinInputProps} name="confirm" />
        </Field>

        <Button type="submit" size="xl" fullWidth busy={pending}>
          Set PIN
        </Button>
      </form>

      <form action={skipPin}>
        <Button type="submit" variant="ghost" size="lg" fullWidth>
          Not now
        </Button>
      </form>
    </div>
  );
}

export function VerifyPinForm() {
  const [state, formAction, pending] = useActionState(submitVerifyPin, INITIAL);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-5">
        <Field label="Enter your PIN" error={state.error} required>
          <Input {...pinInputProps} name="pin" autoFocus />
        </Field>

        <Button type="submit" size="xl" fullWidth busy={pending}>
          Unlock
        </Button>
      </form>

      <form action={forgotPin}>
        <Button type="submit" variant="ghost" size="lg" fullWidth>
          Forgot PIN — email me a link
        </Button>
      </form>
    </div>
  );
}
