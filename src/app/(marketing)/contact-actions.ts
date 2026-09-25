"use server";

import { z } from "zod";

import { createLead } from "@/lib/db/leads";

/**
 * The landing page contact form.
 *
 * This is the one write on the site reachable with no session, so it is the one
 * an unauthenticated stranger can aim at. It takes no `companyId` and touches
 * no tenant data — see `lib/db/leads.ts` for why that is sound here.
 */

const leadSchema = z.object({
  name: z.string().trim().min(1, "Tell us your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  company: z.string().trim().min(1, "Tell us your company").max(160),
  message: z.string().trim().min(1, "Tell us what you need").max(2000),
  // Honeypot. Named to look worth filling to a bot, hidden from people.
  website: z.string().max(0).optional().or(z.literal("")),
});

export type ContactState = {
  status: "idle" | "error" | "sent";
  error: string | null;
};

export async function submitLead(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const parsed = leadSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: formData.get("company"),
    message: formData.get("message"),
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    // A filled honeypot is answered with success, not an error. Telling a bot
    // it was caught only teaches whoever wrote it to stop filling that field.
    const honeypotOnly = parsed.error.issues.every(
      (issue) => issue.path[0] === "website",
    );
    if (honeypotOnly) return { status: "sent", error: null };

    return {
      status: "error",
      error: parsed.error.issues[0]?.message ?? "Check the form and try again",
    };
  }

  const { name, email, company, message } = parsed.data;

  try {
    await createLead({ name, email, company, message });
  } catch (error) {
    console.error("[lead] failed to store", error);
    return { status: "error", error: "Could not send that. Try again in a moment." };
  }

  return { status: "sent", error: null };
}
