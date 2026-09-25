# Transient

Shift logging and reporting for contract security guards. A guard clocks in on
their phone, logs what happened as it happens, and ends the shift; the client
gets a report in their inbox before the guard has left the parking lot.

Built mobile-first and offline-capable, because the people using it are
standing outside at 3am on a phone with one bar.

> Status: in development. Build-order step 1 of 13 is complete — the scaffold,
> design system and UI primitives. See `ASSUMPTIONS.md` for every decision made
> along the way.

## Quick start

```bash
pnpm install
cp .env.example .env     # fill in what you have; local defaults work as-is
pnpm db:up               # postgres + minio via docker compose
pnpm dev
```

Then open <http://localhost:3000>. The design-system gallery is at
`/dev/ui` — both themes side by side, every primitive, every state.

If Docker is unavailable, any Postgres 17 reachable on port 5544 works; point
`DATABASE_URL` wherever it actually lives.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next dev server |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm verify` | typecheck → lint → contrast gate → unit tests. Run this before committing. |
| `pnpm check:ui` | Browser gate: themes, tap targets, wordmark pixels. **Needs a server running** — `BASE=http://127.0.0.1:3210 pnpm check:ui` |
| `pnpm contrast` | Print the contrast table; `contrast:check` fails the build on a violation |
| `pnpm test` / `pnpm test:watch` | Unit tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright) |
| `pnpm db:up` / `db:down` | Postgres + MinIO containers |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:reset` / `db:studio` | Prisma |
| `pnpm jobs:sweep` | Run the retention/cleanup job by hand |
| `pnpm gen:vapid` / `gen:icons` | Generate Web Push keys / PWA icons |

## Architecture

**Next.js 16** (App Router, React 19, TypeScript strict) on **Postgres 17 via
Prisma 7**, with **S3-compatible object storage** for photos and generated PDFs.

Route groups mirror who is looking at the page:

- `(marketing)` — public landing, privacy, terms. Statically generated.
- `(auth)` — magic link, then a PIN for fast re-entry on a shared phone.
- `(app)` — the authenticated shell: dashboard, live shift timeline, clock-in
  and end-of-shift flows, report status, history, site config, recipients.
- `r/[token]` — a signed public link so a client can open the report and photo
  gallery without an account.

`src/lib` is split by concern (`auth`, `db`, `storage`, `email`, `pdf`, `jobs`,
`push`, `media`, `speech`, `offline`, `validators`) so the API routes stay thin.

### Design system

Tokens live in `src/app/globals.css` as CSS variables, in three layers: a
literal palette, a semantic layer that names roles rather than colours
(`--surface`, `--text-primary`, `--accent`), and a `@theme inline` bridge that
makes Tailwind utilities emit `var(--x)` so a class like `bg-surface` follows
the active theme at runtime instead of freezing a value at build time.

Themes switch by toggling `.theme-dark` / `.theme-light` on `<html>`, set by an
inline pre-paint script so there is no flash of the wrong theme.

Two gates protect it, and both have negative controls that are checked to
actually fail:

- **`pnpm contrast:check`** computes WCAG ratios for all 35 approved colour
  pairings and refuses to pass if any drops below its floor. Four known-bad
  pairings are asserted to stay below, so the gate can be seen failing.
- **`pnpm check:ui`** drives a real browser: it asserts both themes compute to
  genuinely different colours, that every interactive control is hit-testable
  across a full 48×48 area via `elementFromPoint`, and that the wordmark's
  accent dot lands on the "i" by reading the rendered pixels.

UI primitives are in `src/components/ui`: `badge`, `button`, `card`,
`checklist`, `data-table`, `feedback`, `input`, `offline-banner`, `photo-grid`,
`sheet`, `status-tracker`, `timeline`, `timer`, `toast`, `toggle`.

## Screenshots

_Added at build-order step 12, once the real screens exist. The design-system
gallery is browsable at `/dev/ui` in the meantime._

## Testing

```bash
pnpm verify                                    # everything that runs headless
PORT=3210 pnpm start &                         # then, against a live server:
BASE=http://127.0.0.1:3210 pnpm check:ui
```

Use an explicit `PORT`. Port 3000 is a common collision, and `next start`
failing with `EADDRINUSE` while something else answers on that port produces a
`200` that proves nothing.
