import { describe, expect, it } from "vitest";

import { clientId, formatBytes, formatClock, formatDuration } from "@/lib/utils";

describe("formatDuration", () => {
  it("reports seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(51_000)).toBe("51s");
  });

  it("reports minutes and zero-padded seconds under an hour", () => {
    expect(formatDuration(171_000)).toBe("2m 51s");
    expect(formatDuration(65_000)).toBe("1m 05s");
  });

  it("reports hours and zero-padded minutes past an hour", () => {
    expect(formatDuration(3_840_000)).toBe("1h 04m");
  });

  it("truncates rather than rounding up", () => {
    // The end-of-shift number is what this product is judged on, so 119.9s
    // must never read as 2m.
    expect(formatDuration(119_900)).toBe("1m 59s");
  });

  it("drops seconds when asked", () => {
    expect(formatDuration(740_000, { hideSeconds: true })).toBe("12m");
    expect(formatDuration(3_840_000, { hideSeconds: true })).toBe("1h 04m");
  });

  it("floors negatives at zero instead of printing a negative clock", () => {
    expect(formatDuration(-5_000)).toBe("0s");
  });
});

describe("formatClock", () => {
  it("zero-pads every field", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(61_000)).toBe("00:01:01");
    expect(formatClock(8_063_000)).toBe("02:14:23");
  });

  it("keeps counting past 24 hours instead of wrapping", () => {
    // A shift that was never ended must not silently read as a short one.
    expect(formatClock(90_000_000)).toBe("25:00:00");
  });
});

describe("formatBytes", () => {
  it("stays in bytes below 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("switches unit and keeps one decimal while small", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("drops the decimal once the number is big enough to not need it", () => {
    expect(formatBytes(12 * 1024 * 1024)).toBe("12 MB");
  });
});

describe("clientId", () => {
  it("is unique across calls", () => {
    const ids = new Set(Array.from({ length: 500 }, clientId));
    expect(ids.size).toBe(500);
  });

  it("is URL-safe", () => {
    expect(clientId()).toMatch(/^[A-Za-z0-9-]+$/);
  });
});
