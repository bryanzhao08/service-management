import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MSG_FLUSH_OUTBOX,
  MSG_SKIP_WAITING,
  SYNC_TAG,
  isPermanent,
} from "@/lib/offline/protocol";

const worker = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

/**
 * public/sw.js is plain JavaScript with no build step, so it cannot import
 * protocol.ts. That is a deliberate trade (see the header of sw.js), but an
 * untested duplicate constant is exactly the kind of drift whose only symptom
 * is an outbox that quietly stops draining. These read both files and fail on
 * disagreement.
 */
describe("service worker / page protocol", () => {
  it.each([
    ["SYNC_TAG", SYNC_TAG],
    ["MSG_FLUSH_OUTBOX", MSG_FLUSH_OUTBOX],
    ["MSG_SKIP_WAITING", MSG_SKIP_WAITING],
  ])("worker uses the same %s literal as the page", (_name, value) => {
    expect(worker).toContain(`"${value}"`);
  });

  it("does not listen for a message type the page never sends", () => {
    // Catches the reverse drift: a renamed constant on the page side leaves
    // the worker listening for a name nothing emits any more.
    const listened = [...worker.matchAll(/"(transient:[a-z-]+)"/g)].map((m) => m[1]);
    const known = new Set([MSG_FLUSH_OUTBOX, MSG_SKIP_WAITING]);
    for (const message of listened) {
      expect(known).toContain(message);
    }
  });

  it("never claims control on install", () => {
    // A worker that calls skipWaiting() unconditionally can replace the app
    // under a guard who is mid-incident. Activation is explicit.
    const installBlock = worker
      .slice(
        worker.indexOf('addEventListener("install"'),
        worker.indexOf('addEventListener("activate"'),
      )
      // Comments in this file discuss skipWaiting by name, so strip them; the
      // question is whether the code calls it, not whether it mentions it.
      .replace(/\/\/[^\n]*/g, "");
    expect(installBlock).not.toContain("skipWaiting");
  });

  it("passes API reads through to the network", () => {
    // Delivery state is the thing the product is sold on. A cached "delivered"
    // is a lie rather than a slow truth, so /api must not be cached — with
    // /api/media the single exception, since those are immutable bytes.
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain("!isMedia(url)");
  });
});

describe("isPermanent", () => {
  it("drops a conflict", () => {
    // 409 means the server already has this clientId: the write landed and we
    // never saw the response. This is the normal ending for a request made as
    // the signal died.
    expect(isPermanent(409)).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("drops a %i", (status) => {
    expect(isPermanent(status)).toBe(true);
  });

  it.each([408, 429])("retries a %i", (status) => {
    // Timeout and rate limit are the server asking for patience, not telling
    // us the request is wrong.
    expect(isPermanent(status)).toBe(false);
  });

  it.each([500, 502, 503, 504])("retries a %i", (status) => {
    expect(isPermanent(status)).toBe(false);
  });

  it("retries a success-shaped status", () => {
    // Defensive: flush() only calls this on a non-ok response, but a future
    // caller that passes 200 must not have the record silently dropped.
    expect(isPermanent(200)).toBe(false);
  });
});
