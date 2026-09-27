"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { Role } from "@/generated/prisma/enums";
import { can, requireUnlockedActor } from "@/lib/auth/guards";
import { inviteContext, inviteUser } from "@/lib/db/team";
import { getEmailProvider } from "@/lib/email/provider";
import { teamInviteEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/url";

export type InviteState = {
  ok: boolean;
  message: string | null;
  error: string | null;
  /** Set when the account exists but the email did not go out. */
  warning: string | null;
};

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  name: z.string().trim().min(1, "Enter their name.").max(120, "That name is too long."),
  role: z.enum([Role.GUARD, Role.SUPERVISOR, Role.ADMIN, Role.OWNER]),
  siteIds: z.array(z.string()),
});

/**
 * Add someone to the company.
 *
 * The role gate is here *and* on the page. Hiding the form is presentation; a
 * server action is a public endpoint that anyone holding a session can POST
 * to, so this is the check that actually holds.
 *
 * `requireUnlockedActor` rather than `requireActor`, matching every other
 * settings action: minting a colleague's account from an unattended unlocked
 * phone should cost the same PIN as changing your own theme.
 */
export async function inviteTeamMember(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const actor = await requireUnlockedActor();
  if (!can.manageUsers(actor)) {
    return {
      ok: false,
      message: null,
      error: "You cannot add people to this company.",
      warning: null,
    };
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
    siteIds: formData
      .getAll("siteIds")
      .filter((value): value is string => typeof value === "string"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: null,
      error: parsed.error.issues[0]?.message ?? "Check the form and try again.",
      warning: null,
    };
  }

  const result = await inviteUser(actor, parsed.data);
  if (!result.ok) {
    return { ok: false, message: null, error: result.error, warning: null };
  }

  // The account exists by the time we reach here, so a failed send is not a
  // failed invite and must not be reported as one. An admin told "failed"
  // clicks again, hits "already on your team", and concludes the product is
  // broken. They get the truth instead: the person is in, the email is not,
  // here is what to send them by hand.
  let warning: string | null = null;
  try {
    const { companyName, inviterName } = await inviteContext(actor);
    await getEmailProvider().send(
      teamInviteEmail({
        to: result.email,
        name: result.name,
        companyName,
        invitedBy: inviterName,
        signInUrl: appUrl("/sign-in"),
      }),
    );
  } catch (cause) {
    console.error(
      "[team] invite email failed to send; the account was created. Cause: " +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    warning =
      `${result.name} was added, but the invite email did not send. ` +
      `Ask them to open ${appUrl("/sign-in")} and sign in with ${result.email}.`;
  }

  revalidatePath("/settings/team");
  return {
    ok: true,
    message: `${result.name} was added. They can sign in with ${result.email}.`,
    error: null,
    warning,
  };
}
