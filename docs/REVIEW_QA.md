# Local review QA

Implementation status: **IMPLEMENTATION_READY_FOR_PARENT_QA**; human stakeholder acceptance is still pending. Do not represent this as production ready or as already tested by the parent.

## Start and reset

From the repository root, with installed dependencies:

```bash
npm run dev:review
```

This execution environment exposed the native-addon cleanup regression described in [nodejs/node#65446](https://github.com/nodejs/node/issues/65446). Both installed Node 24 runtimes initially aborted intermittently with the preinstalled SQLite binding. Switching runtime alone did not fix it.

The environment binding was rebuilt locally against official **Node 24.18.1 headers**, downloaded to `/tmp/ticket-manager-review-native/` and checked against the official SHA-256 manifest (`bee7344a7fc6e3252c4822ca916a50cd6ddda9bb39374d6140a8046d9238fded` for the headers archive). No application dependency or lockfile changed. The installed Node 24.19 runtime can run that compatible binding. The exact rebuild used:

```bash
cd node_modules/better-sqlite3
node /opt/codex/runtimes/codex-primary-runtime/dependencies/node/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/tmp/ticket-manager-review-native/node-v24.18.1
```

This command is environment-specific, changes only installed native build artifacts, and never opens a database. It is not needed on machines with a working compatible binding. If using another existing runtime, `REVIEW_NODE_BINARY=/path/to/node npm run dev:review` is supported; no runtime is downloaded by the launcher.

- UI: `http://localhost:5173/` (Vite, loopback).
- API: `http://127.0.0.1:4000/api/health`.
- Ports must be free. The server should report “Synthetic review API”.
- Data is in memory. Stop the entire launcher, wait for both processes to exit, then restart to reset fixture edits and the mock outbox.
- `.env` is skipped, `data/app.db` is never used, and directory/CRM/narrative/notification/transfer behavior stays local/mock. No credentials or external connections are needed.
- **External preview boundary:** this environment exposes no supported private port-forwarding/preview URL tool. These loopback addresses are proven reachable by Chromium inside the container, not proven reachable from a separate cloud browser. No public tunnel, hosting service or deployment was created. Parent can use the same environment or reproduce locally; cross-container access remains unverified.

## Synthetic fixture

Coordinator, representative and employee personas use `example.invalid` addresses. Synthetic Comets has private and released future inventory, one private dated performance, a current-season past allocation and a prior-season attendance record. Juniper Example Labs has two active contacts with invented phone numbers; Cobalt Sample Studio is a prospect. Synthetic directory entries include inactive source state. None of the dates is an asserted real team schedule.

## Automated checks

- Baseline before edits: 8 tests passed; typecheck passed.
- Final test, build and browser results are recorded in `APP_REVIEW_2026-10-23.md`.
- `npm test`: in-memory API, integrity, scoring and migration checks; never run seed/reset scripts against the local database to verify this change.
- `npm run typecheck`: all three packages.
- `npm run build`: shared, server and client compilation; no deployment.
- `git diff --check`: whitespace validation. There is no configured lint script.

Optional browser regression, with the existing Python Playwright package and system Chromium (no skill installation):

```bash
# Start a fresh review fixture, then in another terminal:
python3 scripts/review-browser-check.py
python3 scripts/review-browser-setup-check.py
```

The browser script mutates only the running synthetic fixture, requires `http://localhost:5173/`, and writes internal screenshots beneath `/tmp/ticket-manager-review-browser/`. Restart before rerunning to avoid duplicate example events. It checks desktop/mobile journeys, no page errors, focus containment, Escape dismissal and responsive overflow.

## Parent / human acceptance route

1. Coordinator: create a dated event, select it and release it. Check the private/released labels. Exercise a future scheduled UTC instant and an inclusive event-date window. Withdraw release and verify existing requests/allocations remain.
2. Representative: choose a released event, customer and contacts; enter quantity, optional opportunity and rationale. Confirm interest has not assigned tickets and other requesters' details/scores are absent. Employee persona supports self interest only.
3. Coordinator: record pre-release interest on behalf of the representative. View advisory factors and category defaults; choose a human allocation with a decision reason. Try assigning beyond capacity; verify the error retains the draft and no partial allocation remains. Waitlist another request and verify freed inventory still requires a coordinator action.
4. Record a simulated external manual transfer. The UI must say no delivery occurs here. On the past demo event, record unknown, then attended or a confirmed no-show with a note. Try a future event: confirming attendance must fail.
5. Contacts: search by business/email/phone; open history across seasons. Make a directory-backed employee inactive in the app, sync the synthetic directory and verify the override remains. History remains intact and inactive beneficiaries cannot receive new interest/allocations.
6. Mock messages: confirm release created no outbox item. Explicitly add an availability preview. Optional follow-up starts disabled; enable/save it before adding a local mock preview. No SMS, reminders, real recipients or uploads should appear.
7. Sports setup: manual game entry and CSV preview/import should create private inventory. Do not enter actual VGK inventory during automated checks.
8. Inspect keyboard/screen-reader behavior, 200% zoom, long contact names and business rationale, narrow widths, contrast and non-UTC local environments. Automated DOM/mobile checks do not replace assistive-technology acceptance.

## Decisions still needed

- Accept actual business category priorities/weights and override practices; defaults are demonstrations.
- Accept optional follow-up wording, who would receive it, photo optionality and retention expectations before any future real service.
- Plan real authentication/authorization, directory and CRM connection, provider transfer and real email separately. None is enabled by this implementation.
- Parent must have a chance to perform independent QA before the stakeholder handoff is marked `WAITING_FOR_HUMAN_TESTING`.
