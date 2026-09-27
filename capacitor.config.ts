import type { CapacitorConfig } from "@capacitor/cli";

import { mobileServer } from "./scripts/mobile-config";

// Hosted Next.js needs its server runtime. These are device-testing builds;
// server.url is Capacitor's live-reload mode, not a store release architecture.
const server = mobileServer(process.env.MOBILE_APP_URL, process.env.MOBILE_ALLOW_HTTP);

const config: CapacitorConfig = {
  appId: "com.transientapp.guard",
  appName: "Transient",
  webDir: "mobile/www",
  backgroundColor: "#000000",
  appendUserAgent: " TransientNative/1.0",
  loggingBehavior: "debug",
  server,
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: true,
  },
  android: { allowMixedContent: false },
  plugins: {
    Keyboard: { resize: "native", resizeOnFullScreen: true },
  },
};

export default config;
