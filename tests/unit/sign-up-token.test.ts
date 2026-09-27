import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSignUpToken,
  readSignUpToken,
  signUpSchema,
  type SignUpInput,
} from "@/lib/auth/sign-up-token";
import { siteCodeFromName } from "@/lib/sites/defaults";

/**
 * The sign-up link is the only thing standing between a stranger and a new
 * tenant, so the cases that matter are the ones where it should refuse.
 *
 * Pure by design: no database, no Prisma. The token deliberately holds no
 * server state (see the note in `sign-up-token.ts`), so everything it promises
 * is provable from the string itself.
 */

const SECRET = "test-only-sign-up-secret-not-for-real-use";
let previousSecret: string | undefined;

beforeAll(() => {
  previousSecret = process.env["AUTH_SECRET"];
  process.env["AUTH_SECRET"] = SECRET;
});

afterAll(() => {
  if (previousSecret === undefined) delete process.env["AUTH_SECRET"];
  else process.env["AUTH_SECRET"] = previousSecret;
});

const INPUT: SignUpInput = signUpSchema.parse({
  companyName: "Meridian Protective Services",
  name: "Dana Whitfield",
  email: "dana@meridian.test",
  siteName: "Westside Hotel — Sunset Strip",
  siteAddress: "8400 Sunset Boulevard, West Hollywood, CA",
  timezone: "America/Los_Angeles",
});

/** Rebuild a token's payload with `mutate` applied, keeping the old signature. */
function tamper(token: string, mutate: (body: Record<string, unknown>) => void) {
  const dot = token.lastIndexOf(".");
  const body = JSON.parse(
    Buffer.from(token.slice(0, dot), "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  mutate(body);
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString(
    "base64url",
  );
  return `${payload}.${token.slice(dot + 1)}`;
}

describe("readSignUpToken", () => {
  it("returns what was put in", () => {
    expect(readSignUpToken(createSignUpToken(INPUT))).toEqual(INPUT);
  });

  it("normalises the email on the way in, so the token carries one form", () => {
    // Matters because `createCompanyFromSignUp` looks the account up by this
    // exact string, and `User.email` is unique on the stored casing.
    const token = createSignUpToken(
      signUpSchema.parse({ ...INPUT, email: "  Dana@Meridian.TEST  " }),
    );
    expect(readSignUpToken(token)?.email).toBe("dana@meridian.test");
  });

  it("refuses a payload edited after signing", () => {
    const token = createSignUpToken(INPUT);
    const edited = tamper(token, (body) => {
      body["companyName"] = "Someone Else Security";
    });

    expect(edited).not.toBe(token);
    expect(readSignUpToken(edited)).toBeNull();
  });

  it("refuses an expiry pushed forward by hand", () => {
    // The interesting forgery: everything else is untouched and only the clock
    // is moved, which is exactly what a resurrected old link would want.
    const token = createSignUpToken(INPUT, Date.now() - 48 * 60 * 60 * 1000);
    const revived = tamper(token, (body) => {
      body["exp"] = Date.now() + 60 * 60 * 1000;
    });

    expect(readSignUpToken(revived)).toBeNull();
  });

  it("refuses a signature minted with a different secret", () => {
    const token = createSignUpToken(INPUT);
    process.env["AUTH_SECRET"] = "a-completely-different-secret";
    try {
      expect(readSignUpToken(token)).toBeNull();
    } finally {
      process.env["AUTH_SECRET"] = SECRET;
    }
  });

  it("expires exactly 24 hours out, not merely eventually", () => {
    const issued = Date.UTC(2026, 0, 1, 0, 0, 0);
    const token = createSignUpToken(INPUT, issued);
    const day = 24 * 60 * 60 * 1000;

    expect(readSignUpToken(token, issued + day - 1000)).not.toBeNull();
    expect(readSignUpToken(token, issued + day)).toBeNull();
    expect(readSignUpToken(token, issued + day + 1000)).toBeNull();
  });

  it("returns null, never throws, for anything shaped wrong", () => {
    for (const bad of [
      "",
      ".",
      "no-dot-at-all",
      ".signature-only",
      "payload-only.",
      "bm90LWpzb24.abc",
      createSignUpToken(INPUT).slice(0, -1),
    ]) {
      expect(readSignUpToken(bad)).toBeNull();
    }
  });
});

describe("signUpSchema", () => {
  it("falls back to a usable timezone rather than failing the sign-up", () => {
    // The browser supplies this, so a person can neither see it nor fix it.
    // Refusing here would dead-end someone whose browser said something odd.
    const parsed = signUpSchema.parse({ ...INPUT, timezone: "Mars/Olympus" });
    expect(parsed.timezone).toBe("America/Los_Angeles");
  });

  it("keeps a real timezone the browser reports", () => {
    const parsed = signUpSchema.parse({ ...INPUT, timezone: "Europe/Berlin" });
    expect(parsed.timezone).toBe("Europe/Berlin");
  });

  it("names the field that is wrong, so the form can point at it", () => {
    const result = signUpSchema.safeParse({ ...INPUT, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["email"]);
  });
});

describe("siteCodeFromName", () => {
  it("matches what the seed picked by hand", () => {
    expect(siteCodeFromName("Westside Hotel — Sunset Strip")).toBe("WHSS");
  });

  it("drops words that carry no signal", () => {
    expect(siteCodeFromName("The Bank of America Tower")).toBe("BAT");
  });

  it("falls back to opening letters for a one-word site", () => {
    expect(siteCodeFromName("Warehouse")).toBe("WAR");
  });

  it("never returns something that would render as '-0924-03'", () => {
    // An empty code is worse than a wrong one: it silently mangles every
    // incident number a client reads.
    for (const name of ["!!!", "—", "  ", "的", "7"]) {
      expect(siteCodeFromName(name)).toMatch(/^[A-Z0-9]{2,4}$/);
    }
  });

  it("always fits the column, whatever the name", () => {
    // `Site.code` is 2-4 characters and `@@unique([companyId, code])`.
    for (const name of [
      "A",
      "Meridian Protective Services Downtown Tower Complex Annex",
      "1234567890",
      "Café Münchën Süd",
      "The The The The",
    ]) {
      expect(siteCodeFromName(name)).toMatch(/^[A-Z0-9]{2,4}$/);
    }
  });
});
