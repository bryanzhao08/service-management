import { describe, expect, it } from "vitest";

import { mobileServer } from "../../scripts/mobile-config";

describe("native test server boundary", () => {
  it("uses the setup screen without a backend", () => {
    expect(mobileServer()).toBeUndefined();
  });
  it("opens the dashboard over HTTPS without enabling cleartext", () => {
    expect(mobileServer("https://example.com")).toEqual({
      url: "https://example.com/dashboard",
      cleartext: false,
      errorPath: "offline.html",
      allowNavigation: ["example.com"],
    });
  });
  it("keeps the backend inside the WebView instead of the system browser", () => {
    expect(mobileServer("http://192.168.1.2:3000", "1")?.allowNavigation).toEqual([
      "192.168.1.2",
    ]);
  });
  it("only permits HTTP with an explicit local testing flag", () => {
    expect(() => mobileServer("http://192.168.1.2:3000")).toThrow();
    expect(mobileServer("http://192.168.1.2:3000", "1")?.cleartext).toBe(true);
  });
  it("opens the app preview only when explicitly selected for local testing", () => {
    expect(mobileServer("http://localhost:3001", "1", "1")?.url).toBe(
      "http://localhost:3001/dev/app",
    );
    expect(mobileServer("http://localhost:3001", "1")?.url).toBe(
      "http://localhost:3001/dashboard",
    );
    expect(() => mobileServer("https://example.com", undefined, "1")).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "https://example.com/other",
    "https://example.com?token=secret",
    "https://example.com#hash",
  ])("rejects unsafe or ambiguous addresses: %s", (url) => {
    expect(() => mobileServer(url, "1")).toThrow();
  });
});
