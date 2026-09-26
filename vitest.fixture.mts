import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * A one-file runner for the milestone 6 gate fixture.
 *
 * `tsx` cannot resolve `@react-pdf/hyphenate`'s exports map (it has no
 * `./en-us` subpath under CJS), and Vitest 5 no longer ships `vite-node`, so
 * this borrows Vitest's own resolver rather than adding a dependency whose
 * only job is to run one script.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    name: "fixture",
    environment: "node",
    globals: true,
    include: ["scripts/support/*.fixture.ts"],
    env: {
      DATABASE_URL:
        process.env["DATABASE_URL_TEST"] ??
        "postgresql://transient@127.0.0.1:5544/transient_test?schema=public",
    },
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
