export const NATIVE_AUTH_SCHEME = "com.transientapp.guard";

export function nativeSignInLink(callback: string): string {
  return `${NATIVE_AUTH_SCHEME}://auth?url=${encodeURIComponent(callback)}`;
}

/** Only Auth.js' one-time callback on this backend may enter the native view. */
export function nativeAuthTarget(raw: string, origin: string): string | null {
  try {
    const incoming = new URL(raw);
    if (
      incoming.protocol !== `${NATIVE_AUTH_SCHEME}:` ||
      incoming.hostname !== "auth"
    ) {
      return null;
    }
    const callback = new URL(incoming.searchParams.get("url") ?? "");
    if (
      callback.origin !== origin ||
      !/^https?:$/.test(callback.protocol) ||
      callback.username ||
      callback.password ||
      callback.pathname !== "/api/auth/callback/magic-link" ||
      !callback.searchParams.get("token") ||
      !callback.searchParams.get("email")
    )
      return null;
    return callback.href;
  } catch {
    return null;
  }
}
