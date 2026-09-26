"use client";

import * as React from "react";

import {
  addRecipientAction,
  removeRecipientAction,
  reverifyAction,
  updateRecipientAction,
} from "@/app/sites/[id]/recipients/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";

import type { RecipientStatus } from "@/generated/prisma/enums";

export type RecipientView = {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  required: boolean;
  status: RecipientStatus;
  stale: boolean;
  lastBounceReason: string | null;
};

const STATUS: Record<RecipientStatus, { label: string; tone: BadgeTone }> = {
  VERIFIED: { label: "Verified", tone: "primary" },
  UNVERIFIED: { label: "Not confirmed", tone: "attention" },
  BOUNCED: { label: "Bounced", tone: "danger" },
};

const REQUIRED_HINT =
  "A report is not counted as delivered until this address confirms.";

/**
 * Recipients for one site.
 *
 * The screen answers one question: is there an address here that will not
 * receive the next report. A bounced row therefore says what bounced and
 * offers the action that fixes it, instead of showing a status chip and
 * leaving the reader to work out the remedy.
 *
 * Removal is two clicks and says what survives, because delivery history is
 * kept when a recipient is deleted and nobody should have to guess that.
 */
export function RecipientsManager({
  siteId,
  initial,
}: {
  siteId: string;
  initial: RecipientView[];
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function run(
    work: () => Promise<{ ok: boolean; error: string | null }>,
    done: string,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setNotice(done);
        setEditing(null);
        setConfirming(null);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="space-y-2">
        {error ? (
          <p className="text-sm text-danger" role="alert" data-recipients-error>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm text-text-muted" data-recipients-notice>
            {notice}
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Who gets the report</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {initial.length === 0 ? (
            <EmptyState
              title="No recipients yet"
              description="Reports for this site still generate, but nobody is emailed."
            />
          ) : (
            <ul className="divide-y divide-border" data-recipient-list>
              {initial.map((recipient) => (
                <li key={recipient.id} className="p-4" data-recipient={recipient.email}>
                  {editing === recipient.id ? (
                    <EditRecipient
                      recipient={recipient}
                      pending={pending}
                      onCancel={() => setEditing(null)}
                      onSave={(values) =>
                        run(
                          () =>
                            updateRecipientAction({
                              siteId,
                              id: recipient.id,
                              ...values,
                            }),
                          `Saved ${recipient.email}.`,
                        )
                      }
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">{recipient.name}</span>
                        <Badge tone={STATUS[recipient.status].tone}>
                          {STATUS[recipient.status].label}
                        </Badge>
                        {recipient.required ? (
                          <Badge tone="outline">Required</Badge>
                        ) : null}
                        {recipient.stale ? (
                          <Badge tone="outline">Confirm again</Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-text-muted">
                        {recipient.email} &middot; {recipient.roleLabel}
                      </p>
                      {recipient.status === "BOUNCED" && recipient.lastBounceReason ? (
                        <p className="text-sm text-danger">
                          {recipient.lastBounceReason}
                        </p>
                      ) : null}

                      {confirming === recipient.id ? (
                        <div className="space-y-2 pt-1">
                          <p className="text-sm text-text">
                            Remove {recipient.email}? They stop receiving reports. Past
                            deliveries to them are kept.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="danger"
                              disabled={pending}
                              data-recipient-remove-yes
                              onClick={() =>
                                run(
                                  () => removeRecipientAction(siteId, recipient.id),
                                  `Removed ${recipient.email}.`,
                                )
                              }
                            >
                              Remove
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setConfirming(null)}
                            >
                              Keep
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setEditing(recipient.id)}
                          >
                            Edit
                          </Button>
                          {recipient.status !== "VERIFIED" || recipient.stale ? (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={pending}
                              data-recipient-reverify
                              onClick={() =>
                                run(
                                  () => reverifyAction(siteId, recipient.id),
                                  `Confirmation queued for ${recipient.email}.`,
                                )
                              }
                            >
                              Send confirmation
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            data-recipient-remove
                            onClick={() => setConfirming(recipient.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddRecipient
        pending={pending}
        onAdd={(values) =>
          run(
            () => addRecipientAction({ siteId, ...values }),
            `Added ${values.email}. A confirmation email is queued.`,
          )
        }
      />
    </div>
  );
}

function EditRecipient({
  recipient,
  pending,
  onSave,
  onCancel,
}: {
  recipient: RecipientView;
  pending: boolean;
  onSave: (values: { name: string; roleLabel: string; required: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(recipient.name);
  const [roleLabel, setRoleLabel] = React.useState(recipient.roleLabel);
  const [required, setRequired] = React.useState(recipient.required);

  return (
    <form
      className="space-y-3"
      data-edit-recipient
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ name, roleLabel, required });
      }}
    >
      <p className="text-sm text-text-muted">
        {recipient.email} &mdash; the address itself cannot be edited. Remove it and add
        the new one, so the confirmation is sent again.
      </p>
      <Field label="Name" required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <Field label="Role" hint="How they are described on the report." required>
        <Input
          value={roleLabel}
          onChange={(event) => setRoleLabel(event.target.value)}
          required
        />
      </Field>
      <Toggle
        label="Required"
        description={REQUIRED_HINT}
        checked={required}
        onCheckedChange={setRequired}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddRecipient({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (values: {
    name: string;
    email: string;
    roleLabel: string;
    required: boolean;
  }) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [roleLabel, setRoleLabel] = React.useState("");
  const [required, setRequired] = React.useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a recipient</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          data-add-recipient
          onSubmit={(event) => {
            event.preventDefault();
            onAdd({ name, email, roleLabel, required });
            setName("");
            setEmail("");
            setRoleLabel("");
            setRequired(false);
          }}
        >
          <Field label="Name" required>
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Email"
            hint="They get a confirmation link before any report reaches them."
            required
          >
            <Input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Role" required>
            <Input
              name="roleLabel"
              value={roleLabel}
              onChange={(event) => setRoleLabel(event.target.value)}
              placeholder="Property manager"
              required
            />
          </Field>
          <Toggle
            label="Required"
            description={REQUIRED_HINT}
            checked={required}
            onCheckedChange={setRequired}
          />
          <Button type="submit" disabled={pending}>
            Add recipient
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
