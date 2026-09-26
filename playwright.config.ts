import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// The spec drives the real cron endpoint and the real database, so it needs
// the same environment the app runs with. Without this the run fails on a
// missing CRON_SECRET several steps in, which reads like a product fault.
loadEnv({ path: ".env", quiet: true });

/**
 * The app is run as a production build, not `next dev`.
 *
 * The golden path has a wall-clock budget, and dev-mode compiles the first
 * request to every route on demand. That turns a timing assertion into a
 * measurement of the bundler, which is the sort of test that passes on a warm
 * machine and fails in CI for reasons nobody can act on.
 */
const PORT = Number(process.env.E2E_PORT ?? 3211);
const BASE = process.env.E2E_BASE ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // One worker. The golden path clocks in at a real site and drains the real
  // job queue; two copies racing over the same seeded shift would fail in a
  // way that says nothing about the product.
  workers: 1,
  fullyParallel: false,
  // A retry hides a flake, and a flake in the delivery chain is exactly the
  // thing worth seeing.
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      // The guard's device. Every capture surface in this product is a phone
      // held one-handed in the dark, so the mobile run is the primary one.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      // The supervisor's reports table is a desktop surface a guard's phone
      // never reaches. Everything else, the golden path and the axe floor,
      // runs at both widths on purpose -- the phone-width axe sweep is what
      // caught an unreachable scroll region the desktop one could not see.
      testIgnore: /desktop\.spec\.ts/,
    },
    {
      // The supervisor's laptop: reports, audit, billing.
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
      testMatch: /desktop\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // Spawn `next` directly rather than through `pnpm start`.
        //
        // Playwright stops the web server by killing the process *group* it
        // spawned. `pnpm run` puts the script in a group of its own, so the
        // signal lands on the pnpm wrapper and never reaches `next start`.
        // The result is that every test passes, the summary never prints, and
        // the runner hangs forever holding a server nobody will reap -- which
        // is exactly what a 32-minute silent hang looked like, and it reads
        // like a broken test suite rather than a broken teardown. The orphan
        // it leaves behind is worse than the hang: `reuseExistingServer`
        // below will happily hand the next run a stale server on this port.
        command: `node_modules/.bin/next start -p ${PORT}`,
        url: BASE,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          AUTH_URL: BASE,
          NEXT_PUBLIC_APP_URL: BASE,
        },
      },
});
