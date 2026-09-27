"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { inviteTeamMember, type InviteState } from "./actions";

export type RoleOption = { value: string; label: string; hint: string };
export type SiteOption = { id: string; name: string; code: string };

// Declared here, not exported from actions.ts: a "use server" module may only
// export async functions, so exporting this object from there is a build error.
const INITIAL: InviteState = {
  ok: false,
  message: null,
  error: null,
  warning: null,
};

/**
 * Add someone to the company.
 *
 * The role list is computed on the server from the actor's own rank and passed
 * in, so an admin never sees "Owner" as an option they will then be refused.
 * That is presentation only — `inviteUser` enforces the same rule, because a
 * select is not a permission.
 */
export function InviteForm({
  roles,
  sites,
}: {
  roles: RoleOption[];
  sites: SiteOption[];
}) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteTeamMember,
    INITIAL,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clearing on success matters more than it looks: an admin adding four
  // guards in a row would otherwise re-submit the previous address and be
  // told it is already on the team, which reads as a bug rather than as
  // their own double-click.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5" data-invite-form>
      {state.error ? (
        // One banner rather than per-field errors. The server returns a single
        // message and matching it back to a field would mean string-sniffing
        // the copy, which silently stops working the moment the wording
        // changes. `alert` announces it the moment it appears.
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-text"
          data-invite-error
        >
          {state.error}
        </p>
      ) : null}

      <Field label="Their name" required>
        <Input
          type="text"
          name="name"
          autoComplete="off"
          required
          placeholder="Terrence Boyd"
        />
      </Field>

      <Field
        label="Work email"
        hint="Where their sign-in link goes. They set a PIN after that."
        required
      >
        <Input
          type="email"
          name="email"
          autoComplete="off"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="guard@company.com"
        />
      </Field>

      <Field label="Role" required>
        <Select name="role" defaultValue="GUARD" required>
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label} — {role.hint}
            </option>
          ))}
        </Select>
      </Field>

      {sites.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Sites</legend>
          <p className="text-sm text-text-muted">
            Which properties they work. Admins and owners see every site regardless.
          </p>
          <div className="space-y-2 pt-1">
            {sites.map((site) => (
              <label
                key={site.id}
                className="flex min-h-11 items-center gap-3 text-sm"
                htmlFor={`site-${site.id}`}
              >
                <input
                  id={`site-${site.id}`}
                  type="checkbox"
                  name="siteIds"
                  value={site.id}
                  className="size-5 accent-[var(--color-lime)]"
                />
                <span>
                  {site.name}{" "}
                  <span className="text-text-muted">({site.code})</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {state.ok && state.message ? (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-success/40 bg-success/10 px-4 py-3 text-sm text-text"
          data-invite-success
        >
          {state.message}
        </p>
      ) : null}

      {state.warning ? (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-attention/40 bg-attention/10 px-4 py-3 text-sm text-text"
          data-invite-warning
        >
          {state.warning}
        </p>
      ) : null}

      <Button type="submit" size="xl" fullWidth busy={pending}>
        Add to the team
      </Button>
    </form>
  );
}
