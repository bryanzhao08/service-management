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

---

## Milestone 3 — landing page

### What the marketing pages are allowed to claim

The prompt asks for trust copy but does not say what to promise. The rule
applied: **a marketing page may only assert something the code already does.**
So `/privacy` and `/terms` carry no uptime percentage, no retention window and
no deletion SLA, because nothing in the repo enforces any of those yet. What
they do say — that shift photos are stored privately, that reports are scoped to
one company, that an admin can see who a report was sent to — maps onto
`lib/db/scoped.ts` and the schema as they stand. When retention actually ships,
the page gets the number, not before.

### Zero client JavaScript

All four routes are `export const dynamic = "force-static"`. The one
interactive element, the contact form, is a server action, so the pages ship no
client bundle of their own. That is why Lighthouse reports 97–99 performance on
mobile rather than something in the seventies.

The site-configuration illustration is the sharp edge here. It has to *look*
like the hotel-vs-school toggle contrast the prompt describes, but a real
`Toggle` would be a client component, would take a tab stop, and would do
nothing when pressed — a control that lies. `SwitchGlyph` therefore renders the
same geometry as the real `Toggle` (h-7 track, size-5 thumb) as `aria-hidden`
decoration, and the on/off state is carried in real text beside it. A screen
reader gets the facts; a sighted reader gets the picture; nobody gets a fake
button.

### `Lead` is deliberately outside the scoped data layer

Every other model goes through `lib/db/scoped.ts`, which requires a company id.
A marketing lead has no company yet — that is the entire point of the form — so
`contact-actions.ts` holds the one sanctioned direct client. It is narrow: a
single `create`, no reads, no user input reaching a query filter.

**The honeypot answers with success, not an error.** A bot that fills the hidden
field gets the same confirmation a human gets, and no row is written. Returning
a validation error would tell the bot exactly which field to leave alone next
time. This is the same reasoning as the milestone 2 enumeration fixes.

### Icons and manifest

`layout.tsx` referenced `/manifest.webmanifest` and four icon files that **did
not exist** — every page in the app was emitting 404 asset links, silently,
through the whole of milestones 1 and 2. They are now generated by
`scripts/gen-icons.ts`, which reads the brand hexes **out of `globals.css`**
rather than repeating them, so the icons cannot drift away from the design
tokens. It throws if a token is missing instead of falling back to a default;
that failure path is control-proven.

One real bug came out of writing it: `sharp.flatten()` fills transparent corners
with the plate colour, which makes a rounded icon's corner radius invisible.
Flatten now runs only for the square variants (maskable, Apple touch), because
Apple rejects an alpha channel while the rounded variants need one.

### Timezone

`Timeline` and `StatusTracker` were formatting with
`toLocaleTimeString(undefined, …)`, which is the **renderer's** timezone — so a
report generated on a server in one zone would print times a guard in another
zone never worked. Both now take an explicit `timeZone` prop, fed from
`Site.timezone` (`prisma/schema.prisma:215`), and `/sample-report` passes an
explicit `SITE_TZ`. Found while building the sample report, not by a test.

### Accessibility rules that needed code changes

`Mark` and `Wordmark` treated `title=""` as "name it with an empty string",
producing `role="img" aria-label=""` — an image with no accessible name.
Typecheck, lint and build all passed; Lighthouse caught it. Empty title now
means **decorative**: `aria-hidden`, no role, no label. Pinned by
`tests/unit/brand.test.tsx`, whose control (reverting to the unconditional form)
fails exactly the three decorative assertions and none of the others.

The logo links then lost their `aria-label="Transient home"`. The wordmark
renders a dotless **U+0131**, so that label did not contain the link's own
visible glyphs — `label-content-name-mismatch`, which in practice means a
speech-input user saying what they see fails to activate the link. The name now
computes from the wordmark itself.

### Deviations

**`/sample-report` is HTML, not a PDF.** Section 7 wants a sample report
reachable from the landing page; the PDF renderer is milestone 6. The page uses
the real `ReportStatus` union and the real `StatusChip`, so it is the actual
shape of a report rather than a mockup, but it is a web page. It gets replaced
by a link to a generated PDF at milestone 6.

**A broken internal link returns 307, not 404,** because `proxy.ts` gates every
path that is not in `PUBLIC_PATHS`. `scripts/check-landing.mjs` therefore
requires exactly 200 on internal links — accepting 3xx would let a typo'd href
pass as a redirect to the sign-in page.

## Milestone 4 — live shift timeline, sheets, photos

### Sheets remount instead of resetting themselves

Section 9.3 says an entry is stamped with the time the sheet **opened**, not the
time it saved, so a guard who types slowly does not file a note minutes after
the thing they are describing. The first version did this with a reset effect
per sheet. That is both boilerplate and a lint error
(`react-hooks/set-state-in-effect`), and it is fragile: the effect has to
remember every field.

`ShiftTimeline` now keeps an open counter per sheet and passes it in the React
`key`, so opening a sheet is a fresh mount. `useState(() => new Date())` is then
correct by construction — mount time *is* tap time. The counters are per sheet
rather than shared so that "More → Package" does not disturb the More sheet's
identity and it still animates out.

Measured: `occurredAt` landed **26ms** from the recorded open time with a
deliberate 3s typing delay in between, and **3,078ms** before `createdAt`. The
second number is the control — if the timestamp were stamped server-side the two
would be equal and the first assertion would pass for the wrong reason.

### Uploads start before the entry exists

`POST /api/media` accepts `entryId: null` and `createEntry` relinks by
`mediaIds`. A photo starts uploading the moment it is picked, which means the
bytes are usually already in storage before the guard has finished typing a
caption. Losing a caption to a crash is recoverable; losing the picture is not.

`media.attachToEntry` filters on `shiftId` **and** `entryId: null` **and**
`visible.shift`. Without the `shiftId` clause a caller could name media ids from
another shift and pull someone else's photos onto their own entry. It uses
`updateMany`, so a replayed save silently matches nothing instead of failing.

### The storage key is re-derived server-side

The client asks for a presigned URL, uploads, then reports the key it used.
Trusting that report would let a client that edited the key between presign and
record end up with a row pointing at another company's object — and every later
signed GET would honour it, because authorisation happens once at presign.
`POST /api/media` therefore rebuilds the expected key from the session and the
request and compares, checks `companyIdFromKey`, and calls `storage().size(key)`
so a row can never reference bytes that never landed. Both refusals are
exercised: a foreign prefix is **404**, a phantom object is **409**.

`media.record` upserts on `clientId` with `update: {}` — same reasoning as
`entry.upsert`. A retry is the same photo, and a replay must never repoint an
existing row at a different storage key.

### EXIF is parsed by hand, for exactly one tag

`readExifCapturedAt` walks the JPEG APP1 segment and the IFD for tag `0x9003`
only. A full EXIF library is ~40KB shipped to a phone to answer one question,
and every other tag is discarded two lines later anyway: the canvas re-encode
that downscales to 2048px strips the whole EXIF block as a side effect. Proven
by control — inverting the month offset fails exactly the two date tests and
nothing else.

The `Media.exif` column is left null this milestone. Capture time is the only
field anything reads.

### `/api/*` returns 401, not a redirect

`proxy.ts` used to send every unauthenticated request to the HTML sign-in page.
For a page that is right; for `fetch` it means a caller gets 200 and a login
form where it expected JSON, which is indistinguishable from success until
something downstream fails on the shape. API paths now get a JSON 401.

### Deviations

**Barcode scanning and the package signature canvas are deferred.** Section 9.3
calls both "strongly preferred", not required. The package sheet takes a typed
tracking number and a typed recipient name today.

**Custom entry types are absent from the More menu.** `SiteEntryType` has no
discriminator between "incident category" and "custom entry type", and the nine
seeded rows are the incident categories — surfacing them as free-standing entry
types would put "Medical" in the menu as if it were a patrol. The schema change
belongs with section 9.9's entry-types tab.

**A site with no configured entry types cannot log an incident.** Category is
the one required field, so an unconfigured site leaves the sheet showing "Pick a
category" with nothing to pick. Found by the gate, which had picked Hillcrest
Middle School — a seeded site with **zero** entry types, while Westside Hotel
has ten. The gate now selects a configured site deliberately and says why. The
product fix (hide Incident, or tell the guard the site is unconfigured) belongs
with the site-config screen that creates these rows.

### What `scripts/check-shift.mjs` actually proves

41 checks against a real browser, a real build and a real database. Clock-in
walks the whole wizard, the note timestamp is measured against the open time,
and a 2400px JPEG is uploaded through the real client path and comes back
**2048x1536** with the byte count read from storage rather than from the client.

Controls, each of which must fail for the check above it to mean anything: a
tampered download token is **401**, an anonymous media request is **401**, an
unknown id is **404 not 403** (403 would confirm the row exists), presign
refuses a non-media type **415** / an oversized photo **413** / an invisible
shift **404**, and a user in a second company gets **404** for media they can
otherwise name exactly.

The axe pass covers the timeline and all four sheets. It is not vacuous:
removing `aria-label` from the offscreen file input fails **exactly one** check,
the Photo sheet, and the file restores byte-identical afterwards.

## Milestone 5 — media pipeline, job queue, retention

### The queue is Postgres, and `FOR UPDATE SKIP LOCKED` is the whole reason

There is no Redis and no external broker. `Job` is a table, `claimJobs` takes
rows with `FOR UPDATE SKIP LOCKED`, and that one clause is what makes it a queue
rather than a list. Proven by removing it: two concurrent `claimJobs(10)` calls
against ten rows then return the **same ten**, and exactly one test of fifteen
goes red. Every other test still passes, which is why it is worth a control —
the bug is invisible until two workers run at once, and then it double-processes
everything.

### Prisma `DateTime` is `timestamp without time zone`, so raw SQL must say UTC

This cost more time than anything else in this milestone and it never raised an
error. Prisma maps `DateTime` to `timestamp without time zone` holding UTC
digits. `now()` returns `timestamptz`. Comparing the two makes Postgres
reinterpret the stored digits in the **session** time zone, so on a machine set
to `America/Los_Angeles` every job enqueued for "now" looked seven hours in the
future and was never claimed. The queue did not fail, it just silently stopped.

**Rule: raw SQL comparing against a Prisma `DateTime` uses
`(now() AT TIME ZONE 'UTC')`, never bare `now()`.** It is written above
`claimJobs` in `src/lib/db/jobs.ts` so the next person reads it before they
write the next query. Reverting the fix fails **nine** of fifteen tests.

Prisma's own ORM methods are already correct, because the driver sends a JS
`Date` and writes UTC digits. The danger is mixing the two: a raw-SQL
`lockedAt = now()` write read back through an ORM `lt: cutoff` would be seven
hours out in the other direction.

### Jobs are deliberately not company-scoped

`Job` has no `companyId`, which is the one place in this codebase that breaks the
scoping rule everywhere else enforces. A worker has no session and no viewer, so
there is nothing to scope *to*. What makes it safe is narrower than a column:
payloads are written only by trusted server code, and **every handler re-derives
the company from the database** rather than trusting the payload. If a future
handler reads a `companyId` out of a payload and uses it, that assumption is
broken and this note is the thing that was violated.

### `Media.width` and `Media.height` are client-reported

The browser compresses before upload and posts its own dimensions;
`POST /api/media` records them as given. The worker never writes them back. So
they are a convenience for layout, not a fact about the bytes, and nothing
security-relevant may depend on them. The byte count is different — that one is
read from storage.

I only learned this because a negative control caught me overclaiming. The gate
had a check labelled "worker recorded the original dimensions", and when I
disabled the worker entirely that check **still passed**. It was reading a value
the client had sent. Renamed to "the client compressed before upload and the row
records it", which is what it actually proves.

### Objects are written before rows, in both directions

The worker writes the thumb and pdf objects and only then marks the row
`PROCESSED`. A crash in between leaves an orphan object, which the sweep
reclaims. The other order leaves a row naming bytes that do not exist, and every
reader 404s on a photo the UI insists is there.

Retention runs the same way round: delete the objects, then the rows. The row is
the only thing that names the object, so losing it first loses the bytes
forever.

### Retention is dated from the shift, not the upload

`expiredMedia()` measures against the shift's date, not `Media.createdAt`. A
photo uploaded late, or re-uploaded after a failure, belongs to the incident it
documents rather than to the moment it happened to reach the server. A client
asking "keep 90 days" means 90 days of *shifts*.

### A missing media row is job success, not failure

Retention can delete a row between the moment a job is enqueued and the moment
it runs. The handler returns `"gone"` and succeeds. Treating it as a failure
would retry five times and end `FAILED`, filling the failure count with rows
that were correctly deleted.

### A failed job must mark its subject

`runJobs` calls `markSubjectFailed` when a handler gives up. Without it the
photo sits on "processing" forever with nothing anywhere explaining why, and the
only record is a `Job` row no screen displays. The timeline shows **Photo
failed**, and the media route 404s rather than redirecting to an object that was
never written.

### `next/image` is wrong for auth-gated media

Its optimizer fetches the source URL server-side, with no viewer session. Our
media route would 401 that fetch and every thumbnail in the app would break.
`EntryThumbs` uses a plain `<img>` with the lint rule disabled and a comment
saying why, which is the honest version of the tradeoff: we lose the optimizer
and keep the authorization.

### Video is stored but not processed

`PROCESS_MEDIA` marks video `PROCESSED` with no variants. ffmpeg poster frames
are section 10.4's optional item and are not built, so a video entry shows no
thumbnail. It is a gap in the UI, not a broken state — the row is correct and
the original plays.

### The nudge is an optimization; the sweep is the guarantee

`enqueueAndKick` commits the row and then calls `after()` to run the job in the
same request. Its errors are swallowed on purpose. If the nudge dies, the
one-minute cron on `/api/jobs/sweep` picks the job up, which the gate proves by
enqueueing an orphaned job no nudge ever saw and watching the sweep drain it.

`CRON_SECRET` fails **closed**: unset gives 503 rather than an open endpoint,
and the comparison is length-safe constant-time. The gate includes a
one-character-short secret because a naive `timingSafeEqual` throws on unequal
lengths, and a thrown comparison is an easy accidental 500 where a 401 belongs.

### What `scripts/check-jobs.mjs` actually proves

27 checks against a real browser, a real build, a real database and real sharp
encodes. Variant sizes are read by decoding JPEG SOF markers over HTTP, not by
trusting what the worker claims it wrote: thumb comes back **400x300**, pdf
**1600x1200**, original **2048x1536** untouched. The timeline is watched for
network requests and asked to have fetched thumbs and never the original.

Controls: a permanently broken job ends `FAILED` at exactly five attempts rather
than looping, the failure is recorded rather than swallowed, and the photo 404s
instead of serving an object that does not exist. Isolation is tested against
another guard **in the same company**, since company scoping alone would let a
different-company row through for the wrong reason.

The gate's own negative control is the one worth keeping: stubbing out
`enqueueAndKick` in `POST /api/media` fails seven checks, all downstream of the
nudge, and it is what exposed the dimensions overclaim above.

## Milestone 6 — PDF report

**Two hashes, not one.** §11 asks for a SHA-256 of the PDF stamped into the
PDF's own footer. That is self-referential: changing the footer changes the
digest. Both of §11's escape hatches (a second pass, a receipt page) have the
same problem. So there are two values with different jobs:

- `contentHash` — SHA-256 of the canonical **facts**, sorted by id rather than
  query order, printed in the footer and in full on the cover. Recomputable
  from the database years later, and unchanged if the report is re-rendered.
- `sha256` — SHA-256 of the finished **bytes**, on the row and in the email.
  Answers "is this the file I was sent".

A test asserts the two differ, so the design cannot silently collapse into one.

**No `render` prop anywhere in the document.** @react-pdf 7.0.x does not lay
out a `render`-prop Text, and a broken one collapses its whole parent. The
footer's report id and hash were painted nowhere while pypdf found every
character of them, so the gate was green over a blank footer. Bisected against
real renders: deleting the `render` sibling fixed it, re-adding it broke it
again. `Page N of M` is gone; the cover states the document's length instead,
settled by a second render pass.

**The gate rasterises.** `check-report.mjs` asserts painted bounding boxes via
pymupdf, not just extractable text via pypdf, because the bug above proves
those are different questions. Reproducing the original footer markup fails
exactly that check and nothing else.

**Size ladder degrades photo size before photo count**, and the last rung wins
even if it is still over cap. A report that is too large beats no report.

**Photos are passed as pre-resolved data URIs**, never URLs. Signed URLs race
their own expiry inside the renderer and fail as silent blank boxes.

**Missing report-template section keys default to ON.** The opposite default
would silently drop new sections from every existing site.

**Report dates carry a year** (`formatDateTimeArchival`). The app's own
formatter does not, because in the app you are looking at today. A report gets
opened by an adjuster eighteen months later, and a date with no year is not
evidence.

## Milestone 7 — email, webhooks, delivery tracking

**Webhooks are matched on `providerMessageId`, never on the email address.** An
address is not unique across reports and changes the moment someone fixes a
typo, so matching on it would apply a bounce for last Tuesday's report to
tonight's.

**An unknown message id and an already-terminal row both answer 200.** They are
ordinary outcomes, not errors. A provider that gets a 4xx retries forever
against a message we will never recognise.

**Reordered-replay protection deliberately excludes QUEUED and SENT.** Those two
we set ourselves, off our own clock: the provider stamps its event when it
accepts the message, we stamp SENT when the HTTP response gets back to us. A
few hundred milliseconds of clock skew the wrong way would make every
`delivered` look like a stale replay and drop it, silently losing the one
signal this product is sold on.

**The console provider confirms after a deliberate 20-second delay**
(`CONFIRM_AFTER_MS`, `src/lib/jobs/confirm-console.ts`). A status that flips to
DELIVERED in the same breath as the send demonstrates nothing, so the local
simulator makes the pending state visible first. The cost is that two sweeps
run back to back legitimately report 0 confirmed, which reads like a broken
sweep and is not one.

**The console outbox is JSON on disk with no `callbackUrl` key.** It records
`messageId, sentAt, to, subject, html, text, attachments`. Anything that wants
to drive a simulated webhook derives the id from `messageId` rather than
expecting the provider to hand back a callback, because the real provider does
not either.

**The local storage driver signs its own URLs** (`src/lib/storage/tokens.ts`).
S3 gets presigned URLs from AWS, so leaving the local driver unsigned would
make the path everyone develops against the one nobody tests. The signature
covers the key, the content type, the byte ceiling and the expiry, so the size
limit is a fact the server knows rather than one the client claims.

## Milestone 8 — end of shift, clock out, dashboard

**The end-of-shift flow polls only while it is waiting.** `router.refresh()`
runs on an interval during report build and send, and stops when neither is
outstanding. A permanent poll would keep the page busy all night for the one
minute of it that needs live state.

**Clock-out is a step in the flow, and a verbal-handover site has two steps
rather than four with two greyed out.** Showing "Generate" and "Send" as
skipped would tell the guard we chose not to do something we could have done,
when the truth is the customer asked us not to hold it at all.

## Milestone 9 — recipients, verification, site configuration

**Three logging modes, not a toggle.** `FULL`, `LIGHT` and `VERBAL` are a site
property, because the same guard company runs a hospital that wants every
door checked and a car park that wants an hourly line. One global setting would
force the strictest site's overhead onto the loosest one.

**A verified recipient goes stale on a timer** (`src/lib/db/recipients.ts`).
Verification is not a one-time flag, because the address that worked last
February belongs to a facilities manager who has since left. Unverified and
bounced addresses are surfaced and chased by a reminder job
(`remindUnverifiedRecipients`), and the list sorts bounced first, then
unverified, so the office sees the addresses that need a human before the ones
that are fine.

## Milestone 10 — push, PWA, offline outbox

**The outbox is the source of truth while offline, not the UI.** Entries are
written to IndexedDB first and replayed on reconnect
(`src/lib/offline/outbox.ts`). A guard in a stairwell with no signal is the
normal case for this product, not an edge case, so the write path assumes the
network is absent and treats its presence as the optimisation.

**Replay is idempotent by client-generated id.** A background sync that fires
twice must not produce two identical entries in the timeline, because the
timeline is evidence and a duplicated incident is a credibility problem.

**Push is the only capability gated by plan on the guard side**
(`push_alerts`). It is an alert about the record, not the record itself, which
is the line drawn in the pricing section: billing restricts pulling history
out and notifying about it, never capturing it.

## Milestone 11 — reports history, settings, export, audit log

**The audit log is append-only and its writer swallows errors.** There is no
update and no delete in `src/lib/db/audit.ts`, and nothing else in the app
writes `auditEvent`. The tradeoff is stated rather than hidden: a dropped row
is a gap nobody is told about, which is worse than a clean log and better than
a guard who cannot clock in because the log was unavailable. A negative control
in `tests/db/audit.test.ts` deliberately provokes a foreign-key failure to
prove the swallow works, which is why `pnpm verify` prints a `prisma:error`
on a passing run.

**Three separate export routes, not one.** Only `audit/export` is plan-gated.
`reports/export` and `me/export` are not, and `me/export` in particular must
never be: someone's right to their own data is not a feature of a paid tier.
Collapsing these into one handler is how that check gets inherited by accident.

## Milestone 12 — seed, end-to-end tests, accessibility

**The golden path asks the database, not the screen.** The final assertion
reads `Report` and `ReportDelivery` rows rather than trusting a success
message, because the screen saying "sent" is the thing under test.

**Tests assert properties, not fixture identities.** Four separate failures in
this build had one shape: the test encoded one selection rule while the app
used another, and passed only while the fixture happened to agree. The golden
path used `ORDER BY scheduledStart DESC LIMIT 1` where the dashboard offers the
active shift first. The repair, applied consistently, is to reset the whole set
and then assert the property that matters (this shift belongs to this guard)
by asking the database what the app actually opened.

**A gate that fabricates state clears it up after itself.** `check-billing`
was free-riding on shifts left behind by `check-shift`, so it passed alone and
failed immediately after `check-auth`. `check-auth` ended on a wrong PIN and
left one failed attempt behind every run, and because the attempt counter is a
per-process Map that only a successful entry clears, its fifth run inside
fifteen minutes read "Too many attempts" instead of "Incorrect PIN". Both now
own their preconditions and their cleanup. All 14 gates pass twice in sequence.

**Playwright spawns `node_modules/.bin/next start` directly.** Going through
`pnpm start` put the server in its own process group, so the teardown signal
hit the pnpm wrapper and never reached the server. Every test passed, the run
then hung forever holding the port, and the survivor was inherited by the next
run because `reuseExistingServer` is true. Two apparent test failures were
actually one wedged server left by a killed run, spinning at 99% CPU in an
uncaught-exception loop. Before trusting any e2e failure, check `ps` on the
port.

## Milestone 13 — final pass

**PIN rate limiting does not survive horizontal scaling.** `src/lib/auth/pin.ts`
argues, correctly, that a 4-digit PIN has 10,000 possibilities so the argon2id
hash is not what protects it — rate limiting is. That argument holds on one
instance. The attempt counter is a per-process `Map`, so on a platform that runs
several instances (Vercel, the documented deploy target) the effective ceiling
is five attempts *per instance* rather than five per user, and a lockout is lost
entirely on redeploy.

Two things keep this off the blocker list. The PIN is a second factor on an
already-authenticated session, never a credential on its own: `verifyPin` is
only ever called for the signed-in user's own id, so an attacker needs a device
that is already signed in through a magic link to that user's inbox. And argon2id
at ~19 MiB still prices each guess. But the security claim in that comment is
weaker in production than it reads, and the honest fix is a shared counter
(Postgres row or Redis) rather than a process-local one. Not built.

**The gallery link in the PDF pointed at localhost, in every environment.**
Found by the pre-push review, not by a test. `build-report.ts` had grown its own
`process.env["APP_URL"]` read for the gallery link, and `APP_URL` is set nowhere
in this repo — not in `.env.example`, not in the README — so it always fell
through to `http://localhost:3000`. `render.ts` then encodes that string into the
QR code on the report. The same report disagreed with itself: the gallery link in
the covering email was correct, because `send-report.ts` uses `baseUrl()`, while
the QR a client actually scans pointed at their own phone.

It survived 329 tests because `tests/db/report-render.test.ts` passes
`galleryUrl` in as a fixture literal. That exercises the renderer, which was
never wrong — it faithfully renders whatever URL it is handed — and never the
caller that computes it. A test that supplies the value the bug corrupts cannot
see the bug, which is the sixth instance of that pattern in this build.

The fix routes it through `appUrl()`, the function `src/lib/url.ts` already
existed to be. The pin is `tests/unit/absolute-links.test.ts`, which asserts the
invariant across the whole source tree rather than the one call site, because
the next handler that needs an absolute link is one `process.env` read away from
doing this again.

**Most of the pricing table is not enforced.** There are 14 entitlements and
exactly two are checked anywhere in the app: `audit_export` and `push_alerts`.
The other twelve (`client_portal`, `custom_templates`, `white_label`,
`vendor_roster`, `report_schedule`, `compliance_dashboard`,
`missing_report_alerts`, `cross_vendor_search`, `procurement_export`, `sso`,
`api_access`, `delivery_attestation`) are named, labelled and priced, and
nothing behind them is built. The comparison table is a plan, not a feature
list, and shipping it to a buyer as-is would be overselling.

**There is no payment processor and no checkout.** No Stripe, no Paddle, no
billing dependency of any kind. Subscriptions exist as rows created by the
seed. A company's plan is set in the database by hand. "Start trial" is not
wired to anything that could take money.

**The `pg` deprecation warning is library-internal.** `Calling client.query()
when the client is already executing a query` appears during e2e runs. Under
`--trace-deprecation` the entire stack sits inside `@prisma/adapter-pg`
`performIO`/`queryRaw` and `@prisma/client/runtime` with no application frame.
Prisma 7.10 with pg 8.23. Recorded so the next person does not go looking for
it in `src/`.

**Three screenshots are deliberately gitignored.** `ui-gallery-*.png` and
`wordmark.png` are verification artifacts a gate regenerates, not documentation,
and committing them would mean reviewing image diffs that carry no information.

## Pricing and packaging

**Two products, two buyers.** Transient is sold both to contract guard
companies (who run the work and are judged at renewal) and to the
organisations that hire them (districts, hospitals, hotels, campuses,
property managers, who need oversight across vendors they do not employ).
Those are different jobs, so they are separate plan lines with separate
meters, not one product with a discount.

**A building can appear on both sides, and the pricing page says so.** A hotel
on the client line and the firm guarding it on the operator line both pay.
Hiding that until the first sales call would be worse than stating it.

**In-house security teams are operators, not clients.** They run the work.

**Billed per active site (operator) or covered property (client), never per
guard.** Rotations turn over constantly, and a per-seat bill pays operators to
share one login across a crew. A shared login destroys attribution, and
attribution *is* the product, so per-guard pricing would charge for the audit
trail while funding its corruption. A site with no shifts clocked in is not
billed, which makes seasonal and event work honest rather than something to
hide by deleting the site.

**Inviting a vendor is free, permanently, on every plan.** It is pinned by a
test asserting no entitlement id matches `/invite/`. A client's fourth guard
company is a new operator using Transient nightly, so charging for it would be
a turnstile on our own funnel as well as a bad answer to give a school
district.

**The pricing system must never be the reason the record is incomplete.** A
lapsed subscription still clocks in, logs entries, captures incidents,
generates a report and sends it. Billing restricts *pulling history out*,
loudly. "Their card expired" is not a defensible answer to why February is
missing from a claim file. Enforced in code: `hasEntitlement(null, x)` is
always `false`, and nothing in `ALWAYS_INCLUDED` is reachable through it, so a
caller cannot accidentally gate recording behind a plan check.

**No backdoor between the lines**, pinned by a test: client plans never carry
`white_label` or `custom_templates`; operator plans never carry
`compliance_dashboard` or `cross_vendor_search`. The cheap client plan must not
become a way to buy the operator product.

**Operator prices are anchored to a public comparable; client prices are
not.** Officer Reports publishes per-site pricing at roughly $40/site/month
mobile and $60-70/site/month static with unlimited officers, which is what the
operator ladder ($39/$79/$149) is set against. No competitor publishes
client-side oversight pricing at all, so $149 (Oversight) and $129 (Portfolio,
deliberately cheaper per unit so volume actually pays) are **a judgement call
with no market benchmark behind them**. Treat them as a starting hypothesis to
test against real buyers, not a researched number.

**Marketing copy reads its prices from `src/lib/billing/plans.ts`.** The
landing page calls `startingPrice(audience)` rather than repeating a figure,
because a page quoting a number the app has stopped charging is the usual way
this drifts.

**30-day trial, no card.** The category norm is 14 days. Thirty is chosen so a
trial spans a full monthly reporting cycle with a real client, which is the
only way this product demonstrates the thing it is for.

**Retention floor of 12 months on every paid plan**, including the cheapest.
Below a year, the evidence stops covering the window claims actually arrive
in, which would make the cheap tier actively misleading.
