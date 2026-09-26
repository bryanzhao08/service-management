import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * The console provider writes each message to `.data/outbox/` so a developer
 * can read it and Playwright can parse a magic-link out of it. Serverless
 * filesystems are read-only, so that write throws EROFS there.
 *
 * What makes it worth a test is *who* the caller is. `sendVerificationRequest`
 * calls this during sign-in, so an unhandled throw turns every magic-link
 * request on a deployment with no `RESEND_API_KEY` into a 500 — which is
 * exactly what production did before this fix. The outbox is an inspection
 * aid, not the delivery path, so a failed write must not fail the send.
 */

const mkdir = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  mkdir,
  writeFile,
  default: { mkdir, writeFile },
}));

const message = {
  to: "owner@meridian.test",
  subject: "Sign in to Transient",
  html: "<p>link</p>",
  text: "link",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function provider() {
  const { ConsoleEmailProvider } = await import("@/lib/email/provider");
  return new ConsoleEmailProvider();
}

describe("ConsoleEmailProvider on a read-only filesystem", () => {
  it("still resolves when the outbox write throws EROFS", async () => {
    const eros = Object.assign(new Error("EROFS: read-only file system"), {
      code: "EROFS",
    });
    mkdir.mockRejectedValue(eros);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await (await provider()).send(message);

    expect(result.provider).toBe("console");
    expect(result.messageId).toMatch(/^console-/);
  });

  it("says why nothing was delivered instead of failing silently", async () => {
    mkdir.mockRejectedValue(Object.assign(new Error("read-only"), { code: "EROFS" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await (await provider()).send(message);

    // The operator needs the cause, not just a stack: no key configured.
    expect(error.mock.calls[0]?.[0]).toContain("RESEND_API_KEY");
    expect(error.mock.calls[0]?.[0]).toContain("EROFS");
    // The message itself still has to reach the only readable surface there is.
    expect(info.mock.calls.some((c) => String(c[0]).includes(message.to))).toBe(true);
  });

  it("writes both outbox files when the filesystem is writable", async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    vi.spyOn(console, "info").mockImplementation(() => {});

    await (await provider()).send(message);

    // Guards the happy path the Playwright suite depends on: without this, a
    // fix that swallowed *every* write would pass the two tests above.
    expect(writeFile).toHaveBeenCalledTimes(2);
    const written = writeFile.mock.calls.map((c) => String(c[0]));
    expect(written.some((p) => p.endsWith(".html"))).toBe(true);
    expect(written.some((p) => p.endsWith(".json"))).toBe(true);
  });
});
