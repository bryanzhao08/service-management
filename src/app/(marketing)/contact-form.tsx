"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { submitLead, type ContactState } from "./contact-actions";

const INITIAL: ContactState = { status: "idle", error: null };

/**
 * Section 8's contact form, and one of only two client components on the
 * landing page.
 *
 * It is a real `<form action={...}>`, so it submits and stores a `Lead` with
 * JavaScript disabled — the progressive-enhancement path React gives you for
 * free here, and worth keeping on a page whose whole job is not losing the
 * person reading it.
 */
export function ContactForm() {
  const [state, formAction, pending] = useActionState(submitLead, INITIAL);

  if (state.status === "sent") {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-card)] border border-primary bg-surface px-5 py-6 text-sm"
      >
        <p className="font-medium">Thanks, that came through.</p>
        <p className="mt-1 text-text-muted">
          We answer from a real address, usually within a business day.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label="Work email" required>
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={200}
          />
        </Field>
      </div>

      <Field label="Company" required>
        <Input name="company" autoComplete="organization" required maxLength={160} />
      </Field>

      <Field label="How many sites, and what do you report today?" required>
        <Textarea name="message" rows={4} required maxLength={2000} />
      </Field>

      {/*
        Honeypot. `aria-hidden` and `tabIndex={-1}` keep it away from screen
        readers and the tab order; it is off-screen rather than
        `display: none`, because some bots skip fields that are not rendered.
      */}
      <div
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 overflow-hidden"
      >
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-attention">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
