# AIS Ticket Concierge

Standalone React 18 / Vite client and Express / Drizzle / SQLite server for ticket inventory, discretionary allocation and attendance history.

## Run the synthetic review

With the repository's dependencies installed (`npm ci` on a fresh checkout), run:

```bash
npm run dev:review
```

Open **http://localhost:5173/**. The API listens only on **127.0.0.1:4000**. This launcher builds the shared/server packages, ignores `.env`, forces mock integrations, and creates a fresh **in-memory** database. It does not open or alter `data/app.db`. Stop and restart to reset all fixture changes. No login credentials, paid API keys or directory connection are needed.

Use the visible **Synthetic persona** picker:

- **Demo Coordinator** stages/releases inventory, records interest on behalf of others, makes allocation decisions, records manual transfers, and confirms attendance.
- **Demo Representative** sees released dates, requests tickets for active synthetic customers/contacts or self, and sees only their own requests.
- **Demo Employee** sees released dates and records self interest only.

Selectable personas are a local demonstration, not production security. The server enforces these mock role boundaries and rejects normal API use outside explicit local mock mode. **Real authentication is not implemented**; real operation requires a separately reviewed identity and authorization integration. The legacy `setup`, database scripts and Windows launcher are not the review entry point.

The fixture has a synthetic sports season, private/released games, a dated performance, active directory examples, synthetic customers with phone numbers, pre-release interest, and allocations from current/prior seasons. Dates are invented examples, not verified sports schedules. Sports setup supports manual entry, CSV import and a deterministic local CSV preview. New inventory starts private. Event/game entry and display times are explicitly UTC; supported legacy date-only game entry means midnight UTC.

## Review the workflow

1. In coordinator inventory, select dates or enter an inclusive UTC date window; release immediately or schedule an explicit UTC instant. Release does not send announcements.
2. Switch to a requester and express interest. The catalog shows available tickets, request count, distinct submitting people and requested ticket quantities. Interest never assigns tickets.
3. Switch back, review rationale and advisory ranking, and choose quantities and a decision/override reason. Waitlists remain subject to coordinator decisions.
4. Transfer tickets separately in the provider app, then record that manual step locally. This app cannot deliver tickets.
5. After an event, record attended, confirmed no-show (with evidence/note), or unknown. Missing evidence and unanswered follow-ups stay unknown. Search contacts across seasons to review history.
6. Under mock messages, preview availability and explicitly add it to the local mock outbox. Optional post-event follow-up is disabled by default. No email/SMS or photo upload is implemented.

See [requirements, assumptions and acceptance evidence](docs/APP_REVIEW_2026-10-23.md) and [local QA guide](docs/REVIEW_QA.md).

## Checks

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Tests use isolated in-memory synthetic databases, including migration preservation tests. No lint script is configured. `npm run build` compiles artifacts only; it does not deploy. Optional browser checks are described in the QA guide.

## Architecture and boundaries

- `packages/shared`: typed DTOs, Zod validation, category defaults and advisory factors.
- `packages/server`: API, non-destructive SQL migrations, inventory integrity, release clock and mock service seams.
- `packages/client`: responsive coordinator/requester workflows using existing React Query and Tailwind components.
- `scripts/review-demo.mjs`: isolated local fixture launcher.

Sports retain seasons for fairness/reporting. Dated events ask only for a date and ticket quantity; their legacy internal storage group is hidden from that workflow. Requests and contact records are retired/deactivated rather than deleted so old seasons retain history.

Legacy CRM/directory/narrative adapter code remains for a future separately authorized integration. Mock mode never falls back to live providers. No deployments, external schedules, real communications, real ticket operations, identity grants or subscriptions are part of this review build.
