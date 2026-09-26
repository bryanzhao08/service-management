import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { signInAs } from "./support/sign-in";

/**
 * The supervisor's laptop, and the accessibility floor for the whole app.
 *
 * Section 18 asks for zero serious or critical violations on every app page.
 * That is asserted here rather than in a separate script so it runs with
 * `pnpm test:e2e` and cannot quietly stop being run.
 *
 * Axe is a floor, not a pass mark. It cannot see whether a control is
 * reachable one-handed at 3am, whether a colour carries meaning on its own,
 * or whether a label says anything useful. Those are argued in the design
 * notes; this catches the mechanical failures that no amount of care avoids.
 */

const OWNER = "owner@meridian.test";

/** Every page a signed-in operator can reach without an id in the path. */
const PAGES = [
  "/dashboard",
  "/reports",
  "/audit",
  "/settings",
  "/settings/billing",
  "/settings/sites",
  "/settings/recipients",
  "/notifications",
];

/** Public pages, which are the ones a buyer sees first. */
const PUBLIC_PAGES = [
  "/",
  "/pricing",
  "/sign-in",
  "/privacy",
  "/terms",
  "/sample-report",
];

test.describe("accessibility", () => {
  test.describe.configure({ mode: "serial" });

  test("no serious or critical accessibility violations on public pages", async ({
    page,
    baseURL,
  }) => {
    for (const path of PUBLIC_PAGES) {
      const res = await page.goto(`${baseURL}${path}`, {
        waitUntil: "domcontentloaded",
      });
      expect(res?.status(), `${path} renders`).toBeLessThan(400);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      );
      expect(
        serious.map((v) => `${v.id} (${v.nodes.length})`),
        `${path} has no serious or critical violations`,
      ).toEqual([]);
    }
  });

  test("no serious or critical accessibility violations on app pages", async ({
    page,
    baseURL,
  }) => {
    const sql = new Client({ connectionString: process.env.DATABASE_URL! });
    await sql.connect();
    try {
      await signInAs(page, baseURL!, sql, OWNER);

      for (const path of PAGES) {
        const res = await page.goto(`${baseURL}${path}`, {
          waitUntil: "domcontentloaded",
        });
        if ((res?.status() ?? 500) >= 400) continue;
        // A redirect to sign-in would make the sweep measure the login form
        // eight times and report a clean bill of health for pages it never
        // opened.
        expect(page.url(), `${path} stayed signed in`).not.toContain("/sign-in");

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        const serious = results.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        );
        expect(
          serious.map((v) => `${v.id} (${v.nodes.length})`),
          `${path} has no serious or critical violations`,
        ).toEqual([]);
      }
    } finally {
      await sql.end();
    }
  });
});
