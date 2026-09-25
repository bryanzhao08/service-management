# Assumptions and deviations

Every decision the build prompt left open, plus every place the implementation
departs from what the prompt specified and why. Grouped by the milestone that
forced the decision.

---

## Milestone 1 — scaffold and design system

### Environment substitutions

**Docker Desktop is broken on the build machine, so Postgres runs natively.**
`docker-compose.yml` is committed exactly as the prompt requires and is the
documented path. On this machine the Docker daemon never starts: the launcher
exits 0 immediately and its own log shows `open Mac binary` followed by
`application is about to quit (exit code: 0)`, with August `input/output error`
writes in `monitor.log` — consistent with a hardware migration, not with
anything in this repo. Rather than block the build, a local cluster was
initialised at `~/.local/transient-pg` **on port 5544, deliberately the same
port `docker-compose.yml` maps**, so `DATABASE_URL` is byte-identical under
either path and nothing has to change when Docker is repaired.

```
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D ~/.local/transient-pg \
  -o "-p 5544 -k /tmp" -l ~/.local/transient-pg.log start
```

**The local database has no password.** The cluster was created with
`--auth=trust` and `pg_hba.conf` grants trust only over loopback
(`127.0.0.1/32`, `::1/128`, and the Unix socket), so
`postgresql://transient@127.0.0.1:5544/transient` connects with no credential
in the URL. This is a local-only convenience and the reason `.env` carries no
secret; it must not be copied to any deployed environment, where the connection
string comes from the platform's secret store.

### Dependency pins

**`prisma` and `@prisma/client` are pinned to `7.10.0`.** npm's `latest` tag for
Prisma currently resolves to `8.0.0-rc.17`, a release candidate. Both packages
are pinned together because they must match.

**`@types/node` is `^22`, not `^20`.** Vitest 5's peer range rejects the
template's `^20`. `pnpm peers check` is clean at `^22`.

**`playwright` is a devDependency from milestone 1, not milestone 12.** The
prompt introduces Playwright with the e2e suite in build-order step 12, but the
design-system gate below needs a real browser, and the dependency is required
later regardless. Only `chromium` is installed.

### Tailwind and theming

**No `tailwind.config.ts`.** Tailwind v4 is CSS-first; the palette, radii,
spacing and animations live in `@theme` blocks in `src/app/globals.css`. The
prompt's "Tailwind theme" deliverable is that file.

**The semantic layer uses `@theme inline`, and this is load-bearing.** A plain
`@theme` freezes the resolved colour into the generated utility, so
`bg-surface` would emit a literal and runtime theme switching would silently do
nothing while every static check still passed. `@theme inline` makes utilities
emit `var(--surface)` instead, which is what lets `.theme-light` override it.
`pnpm check:ui` asserts the two theme panes compute to different colours, so a
regression here fails a gate rather than shipping.

### Deliberate departures from the prompt's design tables

**The light theme's focus ring is `forest`, not `lime`.** Section 18 requires a
visible `lime` focus ring. Computed, `lime` on the light theme's `cream`
background is **1.82:1** — far below the 3:1 WCAG floor for non-text contrast,
so a lime ring on light would be an accessibility defect rather than a feature.
`forest` on `cream` measures **6.64:1**. The dark theme keeps `lime`, which
measures **10.77:1** against `ink`. The prompt's own light-theme table omits a
focus-ring entry, so this fills a gap rather than overriding a stated value.
All three ratios are computed, not asserted, by `scripts/contrast.mjs`, and
`lime` on `cream` is one of its four negative controls.

**The wordmark is HTML, not SVG.** The prompt specifies the dot of the "i"
replaced by a filled circle. Drawn as SVG `<text>`, the circle needs a
hardcoded x-coordinate measured against Inter's metrics, which slides off the
letter entirely the moment the webfont fails to load and a fallback is
substituted — and did, landing over the gap between "e" and "n". The wordmark
is now real text with the dot absolutely positioned inside an inline-block
wrapping only the dotless "ı" (U+0131), so it tracks that glyph's box whatever
font resolves. Sizes are in `em`, so callers set `text-3xl` rather than a
height. `Mark` is still SVG, since the favicon, PWA icon and PDF header need
one and it contains no text.

The dot's vertical offset is a constant (`0.787em`) derived from Inter's
measured metrics via `TextMetrics` — its tittle spans 0.546em to 0.762em above
the baseline — with the inline-block's box bottom measured off the render
rather than derived, because half-leading makes the arithmetic from font
metrics alone come out wrong. `pnpm check:ui` reads the rendered pixels and
asserts the gap and the centring, so the constant is tested rather than
trusted.

**Tap targets grow without the visuals growing.** Principle 1 sets a hard 48×48
floor, but a switch pill, a checkbox and a photo-thumbnail remove badge are
meaningfully smaller than that by design; scaling them to 48px makes the UI
look like a toy. The `.tap-target` utility centres a transparent
pseudo-element on the control and stretches it to 48px per axis. WCAG 2.5.5
measures the target — what the pointer actually hits — so this satisfies the
rule honestly rather than by reinterpreting it. It is only applied where the
surrounding region is inert (a label, a photo tile), never where it would steal
a tap from a neighbouring control.

### Implementation choices

**One clock for the whole app.** `src/components/ui/timer.tsx` exposes `useNow`
built on `useSyncExternalStore` over a single module-level interval, rather than
`useState` + `useEffect` per timer. Three reasons: every timer on screen ticks
on the same edge instead of drifting apart; `getServerSnapshot` returns `null`
so SSR renders a stable placeholder instead of a time that is wrong by the time
it hydrates; and the values are read from `Date.now()` on every tick rather than
accumulated, so a phone that sleeps and suspends the interval resumes at the
correct elapsed time instead of under-reporting by the length of the sleep.
That last property is pinned by a test.

Consequence: `ElapsedTimer` no longer takes a `running` prop and `Countdown` no
longer takes `onElapsed`. Neither had a caller. A component that needs to fire
on elapse should own that effect itself.

**CSP allows `'unsafe-inline'` for `script-src`.** A nonce requires middleware
on every request, which forces dynamic rendering and conflicts directly with
the landing page's static-generation and ≥95 Lighthouse Performance
requirements in sections 7 and 23. The rationale is written into
`next.config.ts`. This can be tightened to a nonce for the authenticated
`(app)` routes alone, where static rendering is not wanted anyway, without
touching the landing page.

**`postinstall: prisma generate` is deliberately absent until milestone 2.**
There is no `prisma/schema.prisma` yet, so adding it now would break
`pnpm install` on a clean clone.

**Generated screenshots are gitignored.** `pnpm check:ui` writes a full-page
gallery capture at 2× on every run (~2.5 MB). Committing those per milestone
would bloat history for no benefit; the curated README screenshots arrive
deliberately at build-order step 12.

### Tooling notes

`next lint` was removed in Next 16 and `NextConfig` no longer accepts an
`eslint` key, so the `lint` script is a plain `eslint .`.

**Tokens live at `src/app/globals.css`, not `src/styles/globals.css`.** The
prompt's tree puts them under `src/styles/`; `create-next-app` generates the
App Router convention, and the file is imported by `src/app/layout.tsx`, which
sits beside it. Moving it would buy nothing and break the template's wiring.

---

## Milestone 2 — data model, auth, scoping

### Prisma 7 is not Prisma 6

**A driver adapter is mandatory.** `new PrismaClient({ log })` does not
typecheck; the options type is `PrismaClientOptionsWithAdapter` and `adapter` is
required. So `@prisma/adapter-pg` is a runtime dependency and `lib/db/client.ts`
builds a `PrismaPg` instance. This is not a preference, it is the only shape
that compiles.

**The datasource has no `url`.** It moved to `prisma.config.ts`, which is plain
TypeScript and therefore needs `import "dotenv/config"` to see `.env` at all —
Prisma 7 no longer loads dotenv for you. `dotenv` is a devDependency for that
one reason.

**The generator is `prisma-client`, not `prisma-client-js`,** and it needs an
explicit `output`. The client is generated to `src/generated/prisma` and
imported as `@/generated/prisma/client`; enums come from
`@/generated/prisma/enums`, which is a separate entry point.

**`prisma migrate dev` no longer generates the client.** `prisma generate` is a
separate run, which is why it is in `postinstall`.

`prisma init` was never run in this repo. It scaffolds `.claude/skills/`,
`.windsurf/skills/`, `.agents/skills/` and a `skills-lock.json` — vendor agent
config that has nothing to do with the product.

### Auth.js

**`src/types/next-auth.d.ts` augments `@auth/core/jwt`, not `next-auth/jwt`.**
`next-auth/jwt` is a bare `export * from "@auth/core/jwt"`, and TypeScript does
not merge an augmentation of a re-exporting module into the original. The
failure is silent in the worst way: `JWT extends Record<string, unknown>`, so
the custom fields degrade to `unknown` instead of erroring where they are
declared, and the type error surfaces at the use site in a different file. This
also forces `@auth/core` to be a *direct* dependency — under pnpm's strict
layout the transitive copy is not resolvable from our source.

**The edge/node split is real, not decorative.** `lib/auth/config.ts` performs
zero I/O so `proxy.ts` can import it. The DB-reading `jwt` callback lives only
in `lib/auth/index.ts`. A dynamic `import()` of the adapter inside a callback in
the edge file looks safe — it only executes when the callback runs — but it puts
the module in the edge bundle's graph. It was written that way first and
deleted.

**`createUser` is removed from the adapter and throws.** Transient has no
self-registration. The stock `PrismaAdapter` mints a user for any address that
completes a magic link, which would create an account with no `companyId` that
no scoped query could ever see. The `signIn` callback is a second gate
requiring an existing user *with* a company.

**The sign-in form is non-enumerable, and this was measured rather than
assumed.** `pnpm check:auth` submits a known and an unknown address and compares
where each lands. The first run found two real leaks:

1. The `signIn` callback ran on the link-*request* leg as well as the
   link-*redemption* leg, so an unknown address threw `AccessDenied` and stayed
   on `/sign-in` with an error while a known one advanced. The request leg is
   now allowed through unconditionally; `sendVerificationRequest` is what
   quietly declines to deliver, and the redemption leg still enforces the
   company gate.
2. `signIn()` with its default `redirect: true` sent the browser to
   `/api/auth/verify-request`, which only 302s on to `pages.verifyRequest` for a
   document navigation — a server action navigates client-side, so it stopped
   there. The action now passes `redirect: false` and issues the redirect
   itself, which also makes the destination independent of whether the address
   was known.

The check's own assertion was wrong at first too: `url.includes("/verify")` is
satisfied by `/api/auth/verify-request`, so it passed while the bug was live. It
now compares `new URL(url).pathname` exactly.

### PIN and unlock

The PIN is argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1`) and is a
*device* unlock, not a second identity. Proof of it lives in an HMAC-signed
`transient_unlock` cookie (`userId.expiry.hmac`, 12 hours) so a guard on a
12-hour shift is not re-prompted, while a new browser session starts locked.

**The unlock gate is not in the proxy.** The cookie is an HMAC over
`AUTH_SECRET` using `node:crypto`, which the edge runtime does not have. So the
proxy answers only "is there a session" and `requireUnlockedActor()` in a server
component answers "is this device unlocked". Splitting it this way keeps the
proxy edge-safe; putting the HMAC there would force the whole proxy onto the
node runtime.

### Scoping

Two axes are kept separate: **tenancy** (`companyId`, never optional, never
role-dependent) and **role scope** (site assignments). Both are expressed as
relational `where` fragments, so Postgres does the join and the filter cannot go
stale against a cached list of ids.

**`findUnique` appears nowhere in `lib/db/scoped.ts`.** It accepts only unique
fields in `where`, so a company filter cannot be attached to it — a single
`findUnique(id)` would read across tenants. Everything is `findFirst`.

**A guard's *shifts* are not narrowed to their own `guardId`, deliberately.**
Section 8 scopes a guard's *reports* to their own; acknowledging a handoff means
reading the outgoing guard's shift. A test pins this so a later "tightening"
cannot land as an improvement.

The ESLint `no-restricted-imports` rule banning Prisma imports outside
`lib/db/**` is what makes this mechanical rather than a convention. It is scoped
to `src/**` — everything that ships. `prisma/seed.ts` and `tests/db/**` sit
outside `src` and hold raw clients on purpose.

### Tests

`tests/db/helpers.ts` throws unless the connection string contains
`transient_test`, because `resetDatabase()` truncates every table.
`scripts/db-test-setup.sh` carries the same guard, so a typo in
`DATABASE_URL_TEST` cannot point the truncation at the dev database.

Isolation is proven by two negative controls with **disjoint** failure sets:
deleting the tenancy filter fails 4 of 8 tests, deleting only the assignment
filter fails exactly 1, and a different one. Equal failure sets would have meant
the tests were really testing one thing twice.

Seed idempotency is proven by comparing row counts across three consecutive
runs, not by reading the upserts.

`tests/unit/email-palette.test.ts` exists because email clients do not support
CSS custom properties, so `lib/email/templates.ts` must hardcode hexes — forking
the palette with nothing connecting the two files. The test reads both as text.

### Deviations

**`src/middleware.ts` is `src/proxy.ts`.** Next 16 deprecated the `middleware`
file convention in favour of `proxy`, warning on every build. The export shape
and `config.matcher` are unchanged. The official codemod refuses to run on a
dirty tree, so the rename was done by hand.

**`User` has no `active` / `deactivatedAt` field.** Section 15 does not specify
one, so deactivating someone currently means deleting the user or removing their
assignments. Worth adding if the admin screens in a later milestone need to
suspend an account without destroying its audit trail.

**The seed covers users, sites and config only,** per build order step 2. The
shift, report and delivery fixtures arrive at step 12.
