import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/marketing/legal-shell";

export const metadata: Metadata = {
  title: "Terms — Transient",
  description: "The terms of using Transient.",
  alternates: { canonical: "/terms" },
};

export const dynamic = "force-static";

/**
 * Same standard as the privacy page: only claims the software can keep. No
 * uptime percentage is promised because nothing measures one yet.
 */
export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="September 2026">
      <LegalSection title="What this page is">
        <p>
          The terms of using Transient. It has not been reviewed by a lawyer and is not
          legal advice.
        </p>
      </LegalSection>

      <LegalSection title="Accounts">
        <p>
          Accounts are created by an administrator on your company. You sign in with a
          link sent to your email address, and unlock the app on your device with a PIN
          you choose. The PIN protects a device that is already signed in; it is not a
          second account password.
        </p>
        <p>
          Keep your email account secure. Anyone who can read your email can request a
          sign-in link.
        </p>
      </LegalSection>

      <LegalSection title="Your data is yours">
        <p>
          Reports, photos and shift records belong to the company that owns the site. We
          store and process them to run the service. We do not sell them, and we do not
          use them to train anything.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          Do not use Transient to record people without the permission you are required
          to have at that site, to store material unrelated to a shift, or to send
          reports to recipients who have not agreed to receive them. Sites that forbid
          photography should have photo capture turned off.
        </p>
      </LegalSection>

      <LegalSection title="What we do not promise">
        <p>
          The service is provided as it is. We do not promise a specific uptime figure,
          because nothing in the product measures one yet, and a number we could not
          verify would be worth nothing to you.
        </p>
        <p>
          Email delivery depends on providers we do not control. Transient records and
          shows you the delivery state it is given — including bounces — so you can see
          when a report did not arrive, but it cannot guarantee that it will.
        </p>
      </LegalSection>

      <LegalSection title="Ending it">
        <p>
          You can stop using Transient at any time. Ask your administrator to export
          your reports first; once a company is deleted, its data goes with it.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
