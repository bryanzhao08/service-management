import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EndOfShiftFlow } from "@/components/shift/end-of-shift-flow";

// The flow is a client component over server actions. None of them are the
// subject here: what is under test is what the screen tells a guard when the
// send has already come back failed.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock("@/app/shift/[id]/end/actions", () => ({
  addOneOffRecipient: vi.fn(async () => ({ error: null })),
  buildReport: vi.fn(async () => ({ error: null })),
  clockOut: vi.fn(async () => ({ error: null })),
  saveSummary: vi.fn(async () => ({ error: null })),
  sendReport: vi.fn(async () => ({ error: null })),
}));

// Push subscription is a browser API this test has no reason to exercise.
vi.mock("@/components/push-prompt", () => ({ PushPrompt: () => null }));

const REPORT = {
  id: "rep_1",
  version: 1,
  status: "READY" as const,
  bytes: 58_938,
  pages: 1,
  sentAt: null as string | null,
  ready: true,
};

function renderFlow(over: {
  sentAt?: string | null;
  oneOffs?: string[];
  recipientEmail?: string;
  delivery: {
    total: number;
    failed: number;
    sent: number;
    failedEmails: string[];
  } | null;
}) {
  return render(
    <EndOfShiftFlow
      shiftId="shift_1"
      siteName="Westside Hotel"
      timeZone="America/Los_Angeles"
      vapidPublicKey={null}
      reportMode="email"
      alreadyClockedOut={false}
      startedAt="2026-03-14T06:00:00.000Z"
      clockInAt="2026-03-13T22:00:00.000Z"
      clockOutAt={null}
      review={{
        counts: {},
        incidents: [],
        unattachedPhotos: 0,
        blindSpots: { checked: 0, total: 0 },
        propertyChecks: { done: 0, total: 0 },
      }}
      summary="Quiet night."
      handoffNote=""
      recipients={[
        {
          id: "rec_1",
          name: "Dana Reyes",
          email: over.recipientEmail ?? "dana@westside.test",
          roleLabel: "Property manager",
          required: true,
          status: "VERIFIED",
        },
      ]}
      oneOffs={over.oneOffs ?? []}
      delivery={over.delivery}
      reports={[{ ...REPORT, sentAt: over.sentAt ?? null }]}
    />,
  );
}

describe("end of shift, when the send has failed", () => {
  const FAILED = {
    total: 3,
    failed: 3,
    sent: 0,
    failedEmails: ["dana@westside.test"],
  };

  it("does not tell the guard it is safe to clock out", () => {
    renderFlow({ delivery: FAILED });
    // The screen used to say this at step 3 unconditionally, including on the
    // one path where clock-out is impossible.
    expect(screen.queryByText(/safe to clock out/i)).toBeNull();
  });

  it("says the report did not go out, and to how many", () => {
    renderFlow({ delivery: FAILED });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/could not send this to 3 of 3 recipients/i);
  });

  it("offers the send again as a retry", () => {
    renderFlow({ delivery: FAILED });
    expect(screen.getByRole("button", { name: /try sending again/i })).toBeTruthy();
  });

  it("keeps the clock-out gate shut, which is the product decision", () => {
    renderFlow({ delivery: FAILED });
    expect(screen.queryByRole("button", { name: /clock out/i })).toBeNull();
    expect(
      screen.getByText(/clock out once the report has been accepted/i),
    ).toBeTruthy();
  });

  it("never renders the provider's own error text", () => {
    renderFlow({ delivery: FAILED });
    // `lastError` holds things like "resend: validation_error: You can only
    // send testing emails to ...". It is a supervisor's diagnostic, and it
    // names internal services, so it stays server-side.
    expect(document.body.textContent).not.toMatch(/resend|validation_error/i);
  });

  it("stops the recipient badge claiming Verified about an address it missed", () => {
    renderFlow({ delivery: FAILED });
    // The badge is the recipient's *standing* -- was this address ever
    // verified -- which does not move when tonight's send fails. Leaving it
    // put a green "Verified" chip directly above "we could not send this to
    // 3 of 3", which is two true statements reading as a contradiction.
    expect(screen.queryByText(/^Verified$/)).toBeNull();
    expect(screen.getByText(/didn't send/i)).toBeTruthy();
  });

  it("marks a one-off CC that did not go out", () => {
    renderFlow({
      oneOffs: ["night.desk@westside.test"],
      delivery: { ...FAILED, failedEmails: ["night.desk@westside.test"] },
    });
    expect(screen.queryByText(/CC, tonight only/i)).toBeNull();
    expect(screen.getByText(/didn't send/i)).toBeTruthy();
  });

  it("matches the address case-insensitively", () => {
    // The stored recipient keeps whatever casing someone typed; the delivery
    // row is lowercased on the way out. A badge that silently stops matching
    // because of that is worse than no badge.
    renderFlow({
      recipientEmail: "Dana@Westside.Test",
      delivery: { ...FAILED, failedEmails: ["dana@westside.test"] },
    });
    expect(screen.getByText(/didn't send/i)).toBeTruthy();
  });

  it("leaves a recipient who was not in the failure list alone", () => {
    renderFlow({
      delivery: { ...FAILED, failedEmails: ["someone.else@westside.test"] },
    });
    expect(screen.getByText(/^Verified$/)).toBeTruthy();
    expect(screen.queryByText(/didn't send/i)).toBeNull();
  });
});

describe("end of shift, when the send succeeded", () => {
  const SENT = { total: 3, failed: 0, sent: 3, failedEmails: [] };

  it("restores the reassurance and opens clock-out", () => {
    renderFlow({ sentAt: "2026-03-14T06:12:00.000Z", delivery: SENT });
    expect(screen.getByText(/safe to clock out/i)).toBeTruthy();
    // A report with a `sentAt` resolves straight to step 4 on mount, so the
    // affordance here is the clock-out button itself, not the step-3 link to
    // it.
    expect(screen.getByRole("button", { name: /^clock out$/i })).toBeTruthy();
  });

  it("raises no alarm", () => {
    renderFlow({ sentAt: "2026-03-14T06:12:00.000Z", delivery: SENT });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("end of shift, before anyone has pressed send", () => {
  const UNSENT = { total: 3, failed: 0, sent: 0, failedEmails: [] };

  it("shows a plain send button and no failure", () => {
    renderFlow({ delivery: UNSENT });
    expect(screen.getByRole("button", { name: /^send report$/i })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
