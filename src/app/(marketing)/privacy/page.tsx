import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/marketing/legal-shell";

export const metadata: Metadata = {
  title: "Privacy — Transient",
  description: "What Transient collects, why, and who can read it.",
  alternates: { canonical: "/privacy" },
};

export const dynamic = "force-static";

/**
 * Deliberately narrow and factual. Every claim here is one this codebase can
 * actually keep — nothing about retention windows, sub-processors or regional
 * storage that no code enforces yet. Counsel has not reviewed this; it is a
 * description of the software's behaviour, not legal advice.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="September 2026">
      <LegalSection title="What this page is">
        <p>
          This describes what the Transient software records and who can read it. It is
          written against the behaviour of the product, not as legal advice, and it has
          not been reviewed by a lawyer.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong className="text-text">Account data.</strong> Your email address,
            display name, role, and the company and sites you are assigned to.
          </li>
          <li>
            <strong className="text-text">Shift data.</strong> Clock-in and clock-out
            times, timeline entries, checklist responses, notes, and photos you capture,
            each with the time it was recorded.
          </li>
          <li>
            <strong className="text-text">Report delivery data.</strong> Recipient
            addresses, send times, and the delivery state reported back by the email
            provider, including bounces.
          </li>
          <li>
            <strong className="text-text">Audit data.</strong> A record of
            security-relevant actions — sign-ins, report sends, recipient changes — with
            the actor, the time, and what changed.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What we do not collect">
        <p>
          No continuous location tracking, no background audio, and no advertising or
          analytics trackers. A timeline entry records the time it was made and the site
          it belongs to; it does not follow you between entries.
        </p>
      </LegalSection>

      <LegalSection title="Who can see it">
        <p>
          Data belongs to the company that owns the site. A guard sees their own shifts
          and their own reports. A supervisor sees the sites they are assigned to. An
          administrator sees their company. Nobody sees another company&rsquo;s data —
          that boundary is enforced in every database query, not by a filter in the
          interface.
        </p>
        <p>
          Report recipients receive the report you send them and nothing else. They do
          not get an account and cannot browse your history.
        </p>
      </LegalSection>

      <LegalSection title="Photos">
        <p>
          Photos are compressed on the device before upload and stored in object
          storage. Links to them are signed and expire, so a copied URL stops working.
          Sites that forbid photography can have photo capture turned off entirely, per
          site.
        </p>
      </LegalSection>

      <LegalSection title="Getting it back or getting it deleted">
        <p>
          An administrator on your company can export reports at any time. To have an
          account or a company&rsquo;s data deleted, contact the administrator on your
          account, or write to us and we will verify ownership before acting.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
