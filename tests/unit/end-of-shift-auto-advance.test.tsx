import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EndOfShiftFlow } from "@/components/shift/end-of-shift-flow";

// `sendReport` only enqueues a job, so the button goes idle long before any
// address is tried. The screen's own `busy` flag therefore cannot mean "a send
// is in flight", and when it was used that way the poll stopped on its first
// evaluation: nothing refreshed, `sentAt` never arrived client-side, and the
// guard sat on step 3 looking at a dead screen. What is under test here is the
// hand-off from step 3 to step 4 when the send finally lands on a later
// refresh -- which the mount-time initialiser cannot exercise, because it only
// ever sees the finished state.
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

// Kept identifiable rather than nulled: one of these tests is about *where*
// the push ask ends up now that step 3 advances on its own.
vi.mock("@/components/push-prompt", () => ({
  PushPrompt: () => <div data-testid="push-prompt" />,
}));

const SENT_AT = "2026-03-14T06:12:00.000Z";

type Delivery = {
  total: number;
  failed: number;
  sent: number;
  failedEmails: string[];
};

const UNSENT: Delivery = { total: 1, failed: 0, sent: 0, failedEmails: [] };
const DELIVERED: Delivery = { total: 1, failed: 0, sent: 1, failedEmails: [] };
const FAILED: Delivery = {
  total: 1,
  failed: 1,
  sent: 0,
  failedEmails: ["dana@westside.test"],
};

function flow(sentAt: string | null, delivery: Delivery) {
  return (
    <EndOfShiftFlow
      shiftId="shift_1"
      siteName="Westside Hotel"
      timeZone="America/Los_Angeles"
      vapidPublicKey="BKq-test-key"
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
          email: "dana@westside.test",
          roleLabel: "Property manager",
          required: true,
          status: "VERIFIED",
        },
      ]}
      oneOffs={[]}
      delivery={delivery}
      reports={[
        {
          id: "rep_1",
          version: 1,
          status: "READY" as const,
          bytes: 58_938,
          pages: 1,
          sentAt,
          ready: true,
        },
      ]}
    />
  );
}

/** A built-but-unsent report resolves to step 3, which is where a guard waits. */
function onStepThree() {
  const view = render(flow(null, UNSENT));
  expect(screen.getByRole("button", { name: /^send report$/i })).toBeTruthy();
  return view;
}

describe("end of shift, when the send lands while the guard is watching", () => {
  it("moves itself to clock out", () => {
    const { rerender } = onStepThree();

    // The poll refreshes server data; `sentAt` arriving is the only signal the
    // background job finished.
    rerender(flow(SENT_AT, DELIVERED));

    expect(screen.getByRole("button", { name: /^clock out$/i })).toBeTruthy();
  });

  it("takes the send button away, so there is nothing left to press twice", () => {
    const { rerender } = onStepThree();
    rerender(flow(SENT_AT, DELIVERED));

    expect(screen.queryByRole("button", { name: /^send report$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /continue to clock out/i })).toBeNull();
  });

  it("carries the push ask across to the step it advanced to", () => {
    // It used to sit behind the manual "Continue to clock out" button on step
    // 3. Advancing past that button without moving the ask would have deleted
    // the only moment the app asks to notify anyone.
    const { rerender } = onStepThree();
    expect(screen.queryByTestId("push-prompt")).toBeNull();

    rerender(flow(SENT_AT, DELIVERED));

    expect(screen.getByTestId("push-prompt")).toBeTruthy();
  });
});

describe("end of shift, when the send has not landed", () => {
  it("holds the send button busy after the enqueue has already returned", async () => {
    onStepThree();
    const send = screen.getByRole("button", { name: /^send report$/i });

    await act(async () => {
      fireEvent.click(send);
    });

    // `sendReport` has resolved by now -- it only queues a job. This is the
    // exact moment the button used to go idle again, with nothing on screen
    // moving and nothing to stop a second press.
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(send).toBeDisabled();
  });

  it("stays on step 3 while the report is still unsent", () => {
    // The control for the test above: if the advance were unconditional, this
    // would already be showing the clock-out button.
    const { rerender } = onStepThree();

    rerender(flow(null, UNSENT));

    expect(screen.getByRole("button", { name: /^send report$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^clock out$/i })).toBeNull();
  });

  it("stays on step 3 when the send came back failed", () => {
    // A failure leaves `sentAt` null, so the same condition that advances on
    // success holds the guard here -- with the retry, which is the whole point
    // of not advancing on "the job finished".
    const { rerender } = onStepThree();

    rerender(flow(null, FAILED));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not send this/i);
    expect(screen.getByRole("button", { name: /try sending again/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^clock out$/i })).toBeNull();
  });
});
