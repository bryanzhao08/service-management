/**
 * Stub for the `server-only` package.
 *
 * Next resolves `server-only` itself at build time: importing it from a client
 * component is a build error, which is how `lib/push/send.ts` guarantees the
 * VAPID private key and the whole `web-push` transport can never be bundled
 * into a browser. Vitest has no such resolver, so without this the tests
 * cannot import anything that carries the guard.
 *
 * Stubbing it does not weaken the guard. It is enforced by the bundler at
 * build time, not at runtime, and `next build` is where that is proven.
 */
export {};
