import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` on script-src is a deliberate, recorded tradeoff. The
 * strict alternative is a per-request nonce, which requires middleware to
 * generate one and therefore forces every route to render dynamically. The
 * marketing page has to be statically generated to hit the Lighthouse >= 95
 * target in section 7, so a blanket nonce would trade a measured product
 * requirement for a marginal hardening gain on pages that render no
 * user-controlled HTML. See ASSUMPTIONS.md.
 *
 * `connect-src` and `img-src` include the storage origin so presigned PUTs and
 * signed GETs work against MinIO / R2 / S3 without loosening anything else.
 */
function contentSecurityPolicy(): string {
  const storageOrigin = (() => {
    const endpoint = process.env.S3_ENDPOINT;
    if (!endpoint) return "";
    try {
      return new URL(endpoint).origin;
    } catch {
      return "";
    }
  })();

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", storageOrigin].filter(Boolean),
    "media-src": ["'self'", "blob:", storageOrigin].filter(Boolean),
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", storageOrigin].filter(Boolean),
    "worker-src": ["'self'", "blob:"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };

  if (process.env.NODE_ENV === "development") {
    // Next's dev overlay and HMR client need eval and a websocket.
    directives["script-src"].push("'unsafe-eval'");
    directives["connect-src"].push("ws:", "wss:");
  } else {
    directives["upgrade-insecure-requests"] = [];
  }

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // A type error must fail the build, never be silently shipped. Next 16
  // dropped the `eslint` config key; linting is its own `pnpm lint` step.
  typescript: { ignoreBuildErrors: false },

  images: {
    formats: ["image/avif", "image/webp"],
  },

  // sharp runs in the Node runtime only; keep it out of the client bundle.
  serverExternalPackages: ["sharp", "@react-pdf/renderer"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            // The app needs the camera and the mic (photos, dictation).
            // Everything else is off.
            value:
              "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), magnetometer=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
