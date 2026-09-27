import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

import { mobileServer } from "./mobile-config";

async function main() {
  const server = mobileServer(
    process.env.MOBILE_APP_URL,
    process.env.MOBILE_ALLOW_HTTP,
  );
  await writeFile(
    "mobile/www/server.json",
    JSON.stringify({ url: server?.url ?? null }),
  );
  if (process.platform === "darwin" && existsSync("ios/App/App/Info.plist")) {
    const domains = server
      ? [...new Set(["localhost", new URL(server.url).hostname])]
      : ["localhost"];
    execFileSync("/usr/bin/plutil", [
      "-replace",
      "WKAppBoundDomains",
      "-json",
      JSON.stringify(domains),
      "ios/App/App/Info.plist",
    ]);
  }
  if (!server)
    console.warn("No MOBILE_APP_URL: building the server setup screen only.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
