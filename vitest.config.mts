import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env["DATABASE_URL_TEST"] ??
  "postgresql://transient@127.0.0.1:5544/transient_test?schema=public";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json. Native since Vite 8, so no
  // vite-tsconfig-paths plugin and no second copy of the alias map that can
  // drift out of sync with tsconfig.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "db",
          // Node, not jsdom: these hit a real Postgres through the same
          // `lib/db` modules the app uses. Testing company isolation against a
          // mock would only prove the mock.
          environment: "node",
          globals: true,
          include: ["tests/db/**/*.test.ts"],
          // `lib/db/client.ts` reads DATABASE_URL at module load, so pointing
          // it here is what redirects the whole scoped layer at the test
          // database without the layer knowing it is under test.
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            // A throwaway signing key. It must be *present* because the
            // storage layer refuses to sign with an empty secret, and it must
            // not be a real one, because a test that shares production's key
            // can mint production links.
            LINK_SIGNING_SECRET:
              process.env["LINK_SIGNING_SECRET"] ??
              "test-only-link-signing-secret-not-for-real-use",
          },
          // One database, shared tables. Parallel files would truncate each
          // other's rows mid-assertion.
          fileParallelism: false,
        },
      },
    ],
    // Playwright specs live in tests/e2e and are driven by `pnpm test:e2e`.
    // Without this, vitest picks them up and fails on the Playwright import.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
});
