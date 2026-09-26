import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The S3 driver is the one part of the stack that only fails against a real
 * provider. R2 and MinIO sign with a key and a secret; STS and assumed IAM
 * roles issue *temporary* credentials that need a third field, and handed only
 * the first two they answer InvalidAccessKeyId on every request. That surfaces
 * as "uploads are broken in production" rather than anything a local MinIO run
 * would show. These pin the credential shape in both directions.
 */

const constructed: { credentials?: Record<string, unknown> }[] = [];

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: { credentials?: Record<string, unknown> }) {
      constructed.push(config);
    }
  },
  PutObjectCommand: class {},
  GetObjectCommand: class {},
  DeleteObjectCommand: class {},
  DeleteObjectsCommand: class {},
  ListObjectsV2Command: class {},
  HeadObjectCommand: class {},
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://example.test/signed"),
}));

const BASE = {
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "secret",
};

async function buildClient(env: Record<string, string | undefined>) {
  constructed.length = 0;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import("@/lib/storage/driver");
  mod.resetStorageForTests();
  mod.storage();
  return constructed.at(-1);
}

describe("s3 credentials", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("sends a session token when one is configured", async () => {
    const config = await buildClient({ ...BASE, S3_SESSION_TOKEN: "tok" });
    expect(config?.credentials).toMatchObject({
      accessKeyId: "id",
      secretAccessKey: "secret",
      sessionToken: "tok",
    });
  });

  it("omits the session token entirely for long-lived keys", async () => {
    const config = await buildClient({ ...BASE, S3_SESSION_TOKEN: undefined });
    // Not `undefined` but absent: the AWS SDK treats a present-but-undefined
    // sessionToken as a signing input on some paths.
    expect(config?.credentials).not.toHaveProperty("sessionToken");
    expect(config?.credentials).toMatchObject({ accessKeyId: "id" });
  });
});
