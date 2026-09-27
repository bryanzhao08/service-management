import { execFileSync } from "node:child_process";

import { mobileServer } from "./mobile-config";

if (process.platform !== "darwin") {
  throw new Error("iPhone development requires a Mac with full Xcode.");
}

const env = {
  ...process.env,
  MOBILE_APP_URL: process.env.MOBILE_APP_URL || "http://localhost:3001",
  MOBILE_ALLOW_HTTP: "1",
  MOBILE_APP_PREVIEW: process.env.MOBILE_APP_PREVIEW || "1",
};
const server = mobileServer(
  env.MOBILE_APP_URL,
  env.MOBILE_ALLOW_HTTP,
  env.MOBILE_APP_PREVIEW,
);
execFileSync("pnpm", ["mobile:prepare"], { env, stdio: "inherit" });
execFileSync("pnpm", ["exec", "cap", "sync", "ios"], { env, stdio: "inherit" });
console.log(`iPhone project ready: ${server?.url}`);
console.log(
  "Keep the local server running. Use pnpm mobile:ios to open Xcode, select an iPhone simulator, then Run.",
);
