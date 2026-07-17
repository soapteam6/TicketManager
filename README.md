# AIS Ticket Concierge

Corporate season-ticket management & distribution for AIS. Replaces the manual Excel/Outlook
process with an end-to-end workflow: request intake → configurable AI-assisted priority scoring →
seat assignment (with hard duplicate-prevention) → waitlist → simulated ticket transfer →
post-game attendance/ROI reconciliation → dashboards.

## Quick start (Windows, non-developer)

1. Install [Node.js 20+ LTS](https://nodejs.org).
2. Double-click **`start-app.bat`**. It installs dependencies, sets up the database with demo
   data, and opens the dashboard at http://localhost:5173.
3. Log in with the seeded admin account:
   - **Email:** `admin@ais.local`
   - **Password:** `ChangeMe123!`

Demo also seeds a sales rep (`rep@ais.local`) and an employee (`employee@ais.local`), password
`ChangeMe123!`.

## Manual start (developers)

```bash
npm install
npm run setup     # copies .env, migrates, seeds base data (admin + scoring config)
npm run dev       # server on :4000, client on :5173 (proxies /api)
```

The app starts as a **clean slate** — add teams by pasting their official website (Teams → New team).
To load a full sample dataset (teams, contacts, requests, a reconciled game) for exploring, run
`npm run seed:demo`.

Other scripts: `npm run db:reset` (wipe to a clean slate), `npm test` (server tests),
`npm run build` then `npm start` (production), `npm run typecheck`.

## Architecture

npm-workspaces monorepo:

- `packages/shared` — enums, constants (team seeds, scoring defaults), and zod DTOs shared by
  server validation and client forms.
- `packages/server` — Express + TypeScript API, SQLite via Drizzle ORM + better-sqlite3.
- `packages/client` — React + Vite + TypeScript dashboard (Tailwind, React Query, Recharts).

### Key guarantees
- **No duplicate seat assignment** — a partial-unique index
  `assignments(seat_id) WHERE status IN ('proposed','approved','transferred')`, enforced inside an
  immediate transaction. Concurrent approvals of the same seat → one wins, the other gets `409`.
- **No over-allocation** — inventory is one row per physical seat; assignments consume distinct rows.
- **Transparent priority** — a deterministic, admin-tunable weighted rules engine
  (`packages/server/src/scoring/`) produces a per-factor breakdown. Optional Claude API narratives
  explain the ranking; the app runs fully without an API key.
- **Simulated-now / real-later integrations** — Outlook intake, ticket transfers, and Excel export
  sit behind adapter interfaces (`packages/server/src/adapters/`, `narrative/`). Set
  `ANTHROPIC_API_KEY` in `.env` to enable AI narratives.
- **Schedule import** — on the Teams page, build a team's schedule three ways: **Import CSV** (download a
  per-team template, fill it in a spreadsheet, upload — deterministic, no AI), **Import (paste)** (paste
  the schedule text from the official site; parsed by the Claude API `claude-sonnet-4-6` in one fast/cheap
  call), or **Add game** (manual). All auto-create the season and the team's default tickets (seats) per
  game. Paste parsing requires `ANTHROPIC_API_KEY`; CSV and manual do not.
- **Dynamics 365 CRM** — the New Request form pulls from Dynamics in three steps
  (`packages/server/src/adapters/crm/`): **1)** search a company (account), **2)** select one or
  more contacts from that account, **3)** pick an opportunity whose **Manual Rep Credit**
  (`ais_manualrepcredit`, configurable via `DYNAMICS_OPP_REVENUE_FIELD`) becomes the request's
  revenue. Selected contacts are linked to local contact records (join table `request_contacts`)
  so the request feeds scoring. Uses sample data until the four `DYNAMICS_*` values are set, then
  queries the live org (OAuth client-credentials + Web API).

### Wiring live Dynamics 365
Register an Azure AD app, create a Dynamics **application user** for it with read access to
`accounts` and `contacts`, then set in `.env`:
`DYNAMICS_URL` (e.g. `https://yourorg.crm.dynamics.com`), `DYNAMICS_TENANT_ID`,
`DYNAMICS_CLIENT_ID`, `DYNAMICS_CLIENT_SECRET`. Restart the app; the CRM badge in the request
form flips from "Sample data" to "Live Dynamics".

## Configuration (`.env`)

Copy `.env.example` to `.env`. Notable keys: `JWT_SECRET` / `JWT_REFRESH_SECRET` (change for real
use), `ANTHROPIC_API_KEY` (optional — enables AI narratives), `ANTHROPIC_MODEL`
(default `claude-sonnet-4-6`).
