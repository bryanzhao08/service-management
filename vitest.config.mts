import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json. Native since Vite 8, so no
  // vite-tsconfig-paths plugin and no second copy of the alias map that can
  // drift out of sync with tsconfig.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    // Playwright specs live in tests/e2e and are driven by `pnpm test:e2e`.
    // Without this, vitest picks them up and fails on the Playwright import.
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
  },
});
