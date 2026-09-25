import { beforeEach, describe, expect, it, vi } from "vitest";

import { companyIdFromKey, mediaKey, mediaPrefix, reportKey } from "@/lib/storage/keys";
import {
  signDownloadToken,
  signUploadToken,
  verifyDownloadToken,
  verifyUploadToken,
} from "@/lib/storage/tokens";

/**
 * The storage layer is the one place where a URL is a credential, so these
 * tests are mostly about refusal: a tampered token, an expired one, a key that
 * climbs out of its tenant's prefix.
 */

describe("storage keys", () => {
  it("orders the key so every deletion is a prefix delete", () => {
    const key = mediaKey({
      companyId: "c1",
      siteId: "s1",
      shiftId: "sh1",
      mediaId: "m1",
      variant: "original",
      ext: "jpg",
    });
    // company/site/shift/media is what makes section 17's retention setting
    // implementable: "delete everything for this company" is one prefix.
    expect(key).toBe("c1/s1/sh1/m1/original.jpg");
    // Every variant of one media row lives under one prefix, so deleting the
    // row is a single prefix delete rather than a list of known filenames.
    const prefix = mediaPrefix({
      companyId: "c1",
      siteId: "s1",
      shiftId: "sh1",
      mediaId: "m1",
    });
    expect(prefix).toBe("c1/s1/sh1/m1");
    expect(key.startsWith(`${prefix}/`)).toBe(true);
  });

  it("refuses path segments that could climb out of the prefix", () => {
    for (const bad of ["../escape", "a/b", "c1 ", "", "..", "a.b"]) {
      expect(() =>
        mediaKey({
          companyId: bad,
          siteId: "s1",
          shiftId: "sh1",
          mediaId: "m1",
          variant: "original",
          ext: "jpg",
        }),
      ).toThrow();
    }
  });

  it("refuses an extension that is not a plain word", () => {
    expect(() =>
      mediaKey({
        companyId: "c1",
        siteId: "s1",
        shiftId: "sh1",
        mediaId: "m1",
        variant: "original",
        ext: "jpg/../../etc/passwd",
      }),
    ).toThrow();
  });

  it("puts the report under the same company prefix as media", () => {
    const key = reportKey({
      companyId: "c9",
      siteId: "s1",
      shiftId: "sh1",
      reportId: "r1",
      version: 2,
    });
    expect(key).toBe("c9/s1/sh1/reports/r1-v2.pdf");
    // Versioned, so regenerating a report never overwrites the PDF a client
    // was already emailed.
    expect(companyIdFromKey(key)).toBe("c9");
  });

  it("reads the owning company back out of a key", () => {
    expect(companyIdFromKey("c1/s1/sh1/m1/original.jpg")).toBe("c1");
    // A bare safe segment is a syntactically valid company id. Deciding
    // whether it is *this* caller's company is the download route's job, and
    // that is a string comparison against the session, not a parse.
    expect(companyIdFromKey("nonsense")).toBe("nonsense");
  });

  it("returns null for a key that is not addressable", () => {
    for (const bad of ["", "/", "../secrets/x", "a b/c", ".."]) {
      expect(companyIdFromKey(bad)).toBeNull();
    }
  });
});

describe("storage tokens", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LINK_SIGNING_SECRET", "test-secret-value-not-a-real-secret");
  });

  const claims = {
    key: "c1/s1/sh1/m1/original.jpg",
    contentType: "image/jpeg",
    maxBytes: 400_000,
    exp: Math.floor(Date.now() / 1000) + 300,
  };

  it("round-trips a valid upload token", () => {
    expect(verifyUploadToken(signUploadToken(claims))).toEqual(claims);
  });

  it("rejects a token whose payload was edited", () => {
    const token = signUploadToken(claims);
    const [version, payload, signature] = token.split(".");
    // Raise the ceiling from 400 KB to 200 MB and keep the old signature.
    const tampered = Buffer.from(
      JSON.stringify({ ...claims, maxBytes: 200_000_000 }),
    ).toString("base64url");
    expect(payload).not.toBe(tampered);
    expect(verifyUploadToken(`${version}.${tampered}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signUploadToken(claims);
    vi.stubEnv("LINK_SIGNING_SECRET", "a-completely-different-secret-value");
    expect(verifyUploadToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = signUploadToken({
      ...claims,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    expect(verifyUploadToken(expired)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, which is itself an
    // oracle. Every one of these must return null, not raise.
    for (const bad of ["", ".", "a.b", "....", "v1.x.y", "a", "v2.a.b"]) {
      expect(() => verifyUploadToken(bad)).not.toThrow();
      expect(verifyUploadToken(bad)).toBeNull();
    }
  });

  it("does not accept a download token in the upload slot", () => {
    const download = signDownloadToken({ key: claims.key, exp: claims.exp });
    // The two token types are signed over different payload shapes, so a
    // read credential must not be usable to write.
    expect(verifyUploadToken(download)).toBeNull();
  });

  it("round-trips a download token and rejects a tampered key", () => {
    const token = signDownloadToken({ key: claims.key, exp: claims.exp });
    expect(verifyDownloadToken(token)).toEqual({
      key: claims.key,
      exp: claims.exp,
    });

    const [version, , signature] = token.split(".");
    // Swap company c1 for c2 and keep the signature: the classic cross-tenant
    // read attempt, and the reason the key is inside the signed payload.
    const otherKey = Buffer.from(
      JSON.stringify({ key: "c2/s1/sh1/m1/original.jpg", exp: claims.exp }),
    ).toString("base64url");
    expect(verifyDownloadToken(`${version}.${otherKey}.${signature}`)).toBeNull();
  });
});
