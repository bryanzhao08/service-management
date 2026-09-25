import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/guards";
import { findPinHash } from "@/lib/db/auth-adapter";
import { hasUnlock } from "@/lib/auth/unlock";
import { SetPinForm, VerifyPinForm } from "./pin-forms";

export const metadata: Metadata = { title: "PIN" };

/**
 * One route, two states, decided on the server: a user with no `pinHash` is
 * setting one, a user with one is entering it. Doing this on the client would
 * mean shipping "does this account have a PIN" to anyone who opens the page.
 */
export default async function PinPage() {
  const actor = await requireActor();

  if (await hasUnlock(actor.userId)) redirect("/dashboard");

  const existing = await findPinHash(actor.userId);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">
          {existing ? "Enter your PIN" : "Set a PIN"}
        </h1>
        <p className="text-sm text-text-muted">
          {existing
            ? "This phone stays signed in. The PIN is what opens it."
            : "So you do not have to wait for an email every time you open Transient on this phone."}
        </p>
      </div>

      {existing ? <VerifyPinForm /> : <SetPinForm />}
    </div>
  );
}
