import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/uploads/presign` must sign the EXACT byte count the browser will
 * send.
 *
 * SigV4 puts `content-length` in `X-Amz-SignedHeaders` whenever the presigned
 * command carries a `ContentLength`, so the value stops being a ceiling and
 * becomes a requirement. Measured against the deployed Neon bucket:
 *
 *   PUT 5000 bytes at a URL signed for 5000  -> 200
 *   PUT 5000 bytes at a URL signed for 9096  -> 403 SignatureDoesNotMatch
 *
 * The route used to sign `bytes + 4096` as slack "for encoding overhead". A
 * raw PUT of a Blob has no overhead, so that made every photo upload in
 * production fail, while presign itself kept answering 200 and the app had
 * nothing in its own logs. Types, lint, the build and the whole unit suite
 * were green throughout, because the only thing that rejects it is a real
 * S3 signature check.
 *
 * So the invariant is pinned here instead: whatever the caller declares is
 * what gets signed, byte for byte.
 */

type PresignInput = {
  key: string;
  contentType: string;
  contentLength: number;
  ttlSeconds?: number;
};

const presignUpload = vi.fn(async (input: PresignInput) => ({
  url: "https://example.test/signed",
  key: input.key,
  method: "PUT" as const,
  headers: { "content-type": input.contentType },
  expiresAt: new Date().toISOString(),
}));

vi.mock("@/lib/auth/guards", () => ({
  currentActor: vi.fn(async () => ({
    userId: "u1",
    companyId: "c1",
    role: "GUARD",
  })),
}));

vi.mock("@/lib/db/scoped", () => ({
  db: () => ({
    shift: {
      findByIdWithSite: vi.fn(async (id: string) =>
        id === "shift-1" ? { id: "shift-1", siteId: "site-1" } : null,
      ),
    },
  }),
}));

vi.mock("@/lib/storage/driver", () => ({
  storage: () => ({ presignUpload }),
}));

async function presign(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/uploads/presign/route");
  const res = await POST(
    new Request("https://example.test/api/uploads/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}

const VALID = {
  shiftId: "shift-1",
  mediaId: "abcdefgh1234",
  contentType: "image/jpeg",
};

describe("presign signs the exact upload size", () => {
  beforeEach(() => {
    presignUpload.mockClear();
  });

  it.each([1, 5000, 400 * 1024, 12 * 1024 * 1024])(
    "signs a %i byte upload as exactly that, with no slack",
    async (bytes) => {
      const { status } = await presign({ ...VALID, bytes });
      expect(status).toBe(200);
      expect(presignUpload).toHaveBeenCalledTimes(1);
      expect(presignUpload.mock.calls[0][0]).toMatchObject({ contentLength: bytes });
    },
  );

  it("does not pass a ceiling under any other name", async () => {
    await presign({ ...VALID, bytes: 5000 });
    // A `maxBytes` key reaching the driver means someone reintroduced the
    // ceiling the S3 signature cannot express.
    expect(Object.keys(presignUpload.mock.calls[0][0])).not.toContain("maxBytes");
  });

  it("still refuses a file over the hard cap, so exactness is not a loophole", async () => {
    const { status, json } = await presign({ ...VALID, bytes: 12 * 1024 * 1024 + 1 });
    expect(status).toBe(413);
    expect(json.error.code).toBe("TOO_LARGE");
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it("still refuses a shift the actor cannot see", async () => {
    const { status } = await presign({
      ...VALID,
      shiftId: "someone-elses",
      bytes: 5000,
    });
    expect(status).toBe(404);
    expect(presignUpload).not.toHaveBeenCalled();
  });
});
