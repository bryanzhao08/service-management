export function mobileServer(raw?: string, allowHttp?: string, preview?: string) {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(
      "MOBILE_APP_URL must be an origin without credentials, a path, or query.",
    );
  }
  const cleartext = url.protocol === "http:" && allowHttp === "1";
  if (url.protocol !== "https:" && !cleartext) {
    throw new Error(
      "Use HTTPS, or explicitly set MOBILE_ALLOW_HTTP=1 for local testing.",
    );
  }
  if (preview === "1" && !cleartext) {
    throw new Error("App preview requires explicit HTTP local testing mode.");
  }
  return {
    url: `${url.origin}${preview === "1" ? "/dev/app" : "/dashboard"}`,
    cleartext,
    errorPath: "offline.html",
    // Without this, the offline page's retry is a cross-origin navigation and
    // Capacitor hands the app's own backend to the system browser.
    allowNavigation: [url.hostname],
  };
}
