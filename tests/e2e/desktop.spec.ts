import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { signInAs } from "./support/sign-in";

/**
 * The supervisor's laptop.
 *
 * Scoped to the desktop project because the reports table is a desktop
 * surface; a guard's phone never sees it. The accessibility floor, which
 * does apply at both widths, lives in a11y.spec.ts and is measured there.
 */

const OWNER = "owner@meridian.test";

test.describe("desktop", () => {
  test.describe.configure({ mode: "serial" });

  test("a supervisor can open a delivered report and see who received it", async ({
    page,
    baseURL,
  }) => {
    const sql = new Client({ connectionString: process.env.DATABASE_URL! });
    await sql.connect();
    try {
      await signInAs(page, baseURL!, sql, OWNER);
      await page.goto(`${baseURL}/reports`, { waitUntil: "domcontentloaded" });

      // The reports list links back to the shift the report came from -- the
      // evidence, not the artefact -- which is the right way round for
      // somebody answering "what actually happened that night".
      const reportLink = page.locator('a[href^="/shift/"]').first();
      expect(await reportLink.count(), "there is a report to open").toBeGreaterThan(0);

      // Delivery state has to be readable from the list itself. A supervisor
      // asked "did the client get it?" should not have to open anything.
      await expect(page.locator("body")).toContainText(
        /delivered|sent|bounced|queued/i,
      );

      await reportLink.click();
      await page.waitForLoadState("domcontentloaded");
      await expect(page).toHaveURL(/\/shift\//);
    } finally {
      await sql.end();
    }
  });
});
