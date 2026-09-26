import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShiftTimeline } from "@/components/shift/shift-timeline";

// The timeline is a client component whose sheets reach for browser APIs and
// server actions. None of that is the subject here: what is under test is
// whether a guard can reach the end-of-shift flow at all. Before this, the
// only reference to /shift/<id>/end anywhere in the app was a push
// notification fired when a report FAILED to send, so a guard on the happy
// path had no way in.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock("@/lib/offline/submit", () => ({
  submitTimelineWrite: vi.fn(async () => ({ error: null })),
  pendingCount: vi.fn(async () => 0),
}));

vi.mock("@/lib/actions/entries", () => ({
  createEntry: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/actions/shift", () => ({
  logBreakCover: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/media/upload-client", () => ({
  uploadPhoto: vi.fn(async () => ({ error: null })),
}));

const SITE = {
  id: "site_1",
  code: "WH",
  name: "Westside Hotel",
  timezone: "America/Los_Angeles",
  loggingMode: "FULL" as const,
  areas: [{ id: "a1", name: "Lobby" }],
  entryTypes: [],
};

function renderTimeline(
  shift: Partial<{
    clockInAt: string | null;
    clockOutAt: string | null;
  }>,
  canWrite = true,
) {
  return render(
    <ShiftTimeline
      shift={{
        id: "shift_1",
        clockInAt: "2026-09-26T21:00:00.000Z",
        clockOutAt: null,
        isEventNight: false,
        guardName: "Terrence Boyd",
        ...shift,
      }}
      site={SITE}
      initialEntries={[]}
      canWrite={canWrite}
    />,
  );
}

const endLink = () => screen.queryByRole("link", { name: /end shift/i });

describe("reaching the end-of-shift flow from the timeline", () => {
  it("offers End shift while the guard is clocked in", () => {
    renderTimeline({});
    expect(endLink()).toHaveAttribute("href", "/shift/shift_1/end");
  });

  // Controls. Each asserts the link is absent for a different reason, so the
  // first test cannot pass by the link being rendered unconditionally.
  it("does not offer it before clock-in", () => {
    renderTimeline({ clockInAt: null });
    expect(endLink()).toBeNull();
  });

  it("does not offer it once the shift is already closed", () => {
    renderTimeline({ clockOutAt: "2026-09-26T22:00:00.000Z" });
    expect(endLink()).toBeNull();
  });

  it("does not offer it to a viewer who cannot write to the shift", () => {
    renderTimeline({}, false);
    expect(endLink()).toBeNull();
  });
});
