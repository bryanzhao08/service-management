import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Countdown, ElapsedTimer } from "@/components/ui/timer";

const T0 = new Date("2026-03-14T22:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ElapsedTimer", () => {
  it("renders the elapsed duration as a zero-padded clock", () => {
    render(<ElapsedTimer since={T0 - 8_063_000} />);
    expect(screen.getByLabelText("Time on shift")).toHaveTextContent("02:14:23");
  });

  it("advances with the wall clock", () => {
    render(<ElapsedTimer since={T0} />);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByLabelText("Time on shift")).toHaveTextContent("00:00:03");
  });

  it("reads the real clock rather than counting its own ticks", () => {
    // The phone sleeps: the interval is suspended, so far fewer callbacks fire
    // than seconds pass. A timer that incremented a counter would under-report
    // by the whole sleep. Simulated by jumping the system clock forward while
    // only letting a single tick fire.
    render(<ElapsedTimer since={T0} />);

    vi.setSystemTime(T0 + 45 * 60 * 1000);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    const rendered = screen.getByLabelText("Time on shift");
    // advanceTimersByTime moves the mocked clock too, so the jump lands at
    // 45:00 + 1s.
    expect(rendered).toHaveTextContent("00:45:01");
    // The value a tick-counting implementation would show.
    expect(rendered).not.toHaveTextContent("00:00:01");
  });

  it("freezes at `until` for a closed shift", () => {
    render(<ElapsedTimer since={T0} until={T0 + 60_000} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByLabelText("Time on shift")).toHaveTextContent("00:01:00");
  });

  it("never renders a negative duration", () => {
    render(<ElapsedTimer since={T0 + 60_000} />);
    expect(screen.getByLabelText("Time on shift")).toHaveTextContent("00:00:00");
  });
});

describe("Countdown", () => {
  it("counts down in whole minutes", () => {
    render(<Countdown target={T0 + 12 * 60 * 1000} />);
    expect(screen.getByLabelText("Time remaining")).toHaveTextContent("12m");
  });

  it("goes negative once the deadline passes", () => {
    render(<Countdown target={T0 - 4 * 60 * 1000} />);
    expect(screen.getByLabelText("Time remaining")).toHaveTextContent("-4m");
  });

  it("marks the last stretch as attention and the overrun as danger", () => {
    const { rerender } = render(
      <Countdown target={T0 + 90 * 1000} warnAtMs={300_000} />,
    );
    expect(screen.getByLabelText("Time remaining").className).toContain(
      "text-attention",
    );

    rerender(<Countdown target={T0 - 1_000} warnAtMs={300_000} />);
    expect(screen.getByLabelText("Time remaining").className).toContain("text-danger");
  });
});
