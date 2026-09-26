"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can, requireUnlockedActor } from "@/lib/auth/guards";
import {
  addRecipient,
  listRecipients,
  removeRecipient,
  reverify,
  updateRecipient,
} from "@/lib/db/recipients";

export type RecipientResult = { ok: boolean; error: string | null };

const NAME = z.string().trim().min(1, "Name is required").max(120);
const ROLE = z.string().trim().min(1, "Role is required").max(120);

const addSchema = z.object({
  siteId: z.string().min(1),
  name: NAME,
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  roleLabel: ROLE,
  required: z.boolean(),
});

const editSchema = z.object({
  id: z.string().min(1),
  name: NAME,
  roleLabel: ROLE,
  required: z.boolean(),
});

/**
 * Every action re-reads the actor and re-checks `configureSite` rather than
 * trusting that the page already did.
 *
 * A server action is a public endpoint with a generated name, not a private
 * function the page calls, so the page's guard protects the page and nothing
 * else. The data layer then scopes a second time: `updateRecipient` and
 * `removeRecipient` match on `visible.recipient(actor)`, so a real id
 * belonging to another company still does not resolve.
 */
async function authorize() {
  const actor = await requireUnlockedActor();
  return can.configureSite(actor) ? actor : null;
}

const DENIED = { ok: false, error: "You cannot change recipients." } as const;
const GONE = { ok: false, error: "That recipient is no longer available." } as const;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That input is not valid";
}

export async function addRecipientAction(input: {
  siteId: string;
  name: string;
  email: string;
  roleLabel: string;
  required: boolean;
}): Promise<RecipientResult> {
  const actor = await authorize();
  if (!actor) return DENIED;

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const result = await addRecipient(actor, parsed.data);
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath(`/sites/${parsed.data.siteId}/recipients`);
  revalidatePath("/dashboard");
  return { ok: true, error: null };
}

export async function updateRecipientAction(input: {
  siteId: string;
  id: string;
  name: string;
  roleLabel: string;
  required: boolean;
}): Promise<RecipientResult> {
  const actor = await authorize();
  if (!actor) return DENIED;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const ok = await updateRecipient(actor, parsed.data.id, {
    name: parsed.data.name,
    roleLabel: parsed.data.roleLabel,
    required: parsed.data.required,
  });
  if (!ok) return GONE;

  revalidatePath(`/sites/${input.siteId}/recipients`);
  return { ok: true, error: null };
}

export async function removeRecipientAction(
  siteId: string,
  id: string,
): Promise<RecipientResult> {
  const actor = await authorize();
  if (!actor) return DENIED;

  if (!(await removeRecipient(actor, id))) return GONE;

  revalidatePath(`/sites/${siteId}/recipients`);
  revalidatePath("/dashboard");
  return { ok: true, error: null };
}

/**
 * Send the confirmation email again.
 *
 * `reverify` takes bare ids and does no scoping of its own, so ownership is
 * established here first: the id has to be one this actor can already see.
 * Skipping that would make the action an oracle for whether an id exists in
 * some other company.
 */
export async function reverifyAction(
  siteId: string,
  id: string,
): Promise<RecipientResult> {
  const actor = await authorize();
  if (!actor) return DENIED;

  const visible = await listRecipients(actor);
  if (!visible.some((r) => r.id === id)) return GONE;

  if ((await reverify([id])) === 0) return GONE;

  revalidatePath(`/sites/${siteId}/recipients`);
  revalidatePath("/dashboard");
  return { ok: true, error: null };
}
