# Ticket Manager review implementation

Status: **IMPLEMENTATION_READY_FOR_PARENT_QA**. Verification passed; stakeholder acceptance remains pending. Set `WAITING_FOR_HUMAN_TESTING` only after the parent has had a chance to run independent QA.

Source: all 398 lines of the user-supplied **Ticket Manager App Review Transcript.txt**, Oct 23, 2026. Meeting content defines product requirements; it does not authorize live integrations or communications.

| Agreement | Implementation / acceptance surface |
| --- | --- |
| Simpler coordinator and requester journeys | Focused workspace for inventory, interest, allocation and follow-through; existing setup/detail pages retained |
| Private inventory, rolling release windows | Private-by-default migration, individual/selected/date-window release, scheduled UTC instants evaluated on reads/submission with an injectable clock |
| Requests are interest only; show aggregate demand | Public released catalog with available seats, active request count, unique requesting people, and requested tickets; private requester details and admin scores omitted |
| Customer/employee purpose, quantity, contacts, rationale, opportunity | Shared validation and guided interest form; coordinator can record on behalf of others before release |
| Active Directory concept with independent app override | Synthetic directory service sync; directory-active field separate from app-active field; history retained |
| Simple advisory scoring and human override | Configurable defaults; category, rationale, season fairness and known reliability; removed factors default to zero; no automatic awards |
| Attendance attended / confirmed no-show / unknown | Unknown is absence of evidence; explicit recorded outcome and coordinator notes; cross-season repository |
| Availability announcements at coordinator discretion | Template, preview and mock outbox only; optional follow-up disabled by default; no outbound delivery |
| Manual provider transfer using phone details | Coordinator records completion of external manual transfer; mock activity is never represented as delivery |
| Practical schedule entry | Existing manual and CSV entry; deterministic local preview; no paid parsing or schedule retrieval |
| Local complete workflow | Isolated synthetic fixtures and API/integrity checks; responsive accessible UI using existing React/Tailwind components |

## Agreements versus ideas

Confirmed: stagger releases, discretionary allocation, customers and employees, phone numbers for provider transfers, demand visibility, app-level employee inactivity, contact history across seasons, simpler coordinator-only scores, and explicit control over announcements.

Exploratory: AI schedule retrieval, CRM embedding, automatic post-event messages, and photo evidence. This implementation does not call AI or CRM, send messages, or require photos. Optional follow-up wording is configurable and disabled by default. A preview may mention an optional photo, but no upload or real photo storage is implemented. Accept wording and consent/retention expectations before any real integration.

## Assumptions and deferred integrations

- Local demo personas are openly selectable synthetic identities, **not production authentication or authorization**. Server enforcement demonstrates role boundaries only inside explicitly enabled local mock mode. Production identity integration is a separate human setup blocker.
- Existing inventory migrates to private without deleting any request or allocation. Coordinators choose what to release. Scheduled release means eligibility at an absolute UTC instant, lazily evaluated when catalog/request endpoints run; no background job or external scheduler is required. Release never sends an announcement.
- Season scope matters for fairness in sports; ad hoc events ask for a date, not a season. Their internal legacy storage group remains an implementation detail.
- Numeric score defaults are demonstration settings, not agreed business policy; coordinators retain discretion and can record a decision reason. Value/MRR is context, not external financial validation.
- Missing evidence and unanswered follow-up stay unknown. Confirmed no-show needs explicit coordinator action. No employment decisions are automated.
- Live directory, CRM, ticket providers, real email, paid AI, identity grants, exports of live contacts, deployments and subscriptions are out of scope. Humans will later enter and validate actual inventory; synthetic dates are not verified sports schedules.


## Implementation evidence

- Current main was fetched and verified at `9b312c5d33338a57ec47dab8be291ab9ccacaeb2`; the feature branch starts from that actual main. The five relevant UI/React/composition/typed-fixture skills were read, including the pinned accessibility guidelines. Conditional Power Apps skills were not applied.
- Baseline: 8 tests and all-package typecheck passed.
- Expanded checks cover private/scheduled/batch/window release, privacy and mock boundaries, multiple contacts, attribution, active overrides, inventory/reservation integrity, manual transfer records, unknown attendance, mock outbox, schedule preview and non-destructive legacy migration.
- Existing request, reservation, season, report and detail tools remain reachable. Request/contact retirement and team deactivation preserve history; no data was reset or migrated outside isolated fixtures.
- Local demo setup and browser/acceptance evidence are in [REVIEW_QA.md](REVIEW_QA.md). A native Node/SQLite environment issue was diagnosed separately from product behavior; the local binding workaround is recorded there.
- No tracked deployment/workflow/hosting configuration or active local Git hook was found before feature push. External repository webhook configuration is not exposed by the available tools and cannot be independently certified. No deploy command, pull request, main update, release, or external communication is part of this change.


## Final local verification (2026-10-23)

| Check | Exact outcome |
| --- | --- |
| `npm test` | PASS: 5 files, 51 tests (baseline was 2 files, 8 tests) |
| `npm run typecheck` | PASS: shared, server and client |
| `npm run build` | PASS: shared TypeScript, server tsup, client Vite; no deploy |
| `git diff --check` | PASS |
| Lint | No lint script configured; no lint tool was installed |
| `python3 scripts/review-browser-check.py` | PASS: 14 workflow/responsiveness/focus checks; zero browser page errors |
| `python3 scripts/review-browser-setup-check.py` | PASS: 6 setup/import/directory/configuration checks |
| `python3 scripts/review-browser-date-check.py` | PASS: 8 date submission/storage/display checks; zero page errors |
| Pacific server timezone regressions | PASS: 40 date/API tests under `TZ=America/Los_Angeles` |
| Native binding after environment workaround | PASS: 150,000-statement allocation/GC stress using an in-memory database |

The initial browser setup run and combined launch encountered a native Node/SQLite cleanup abort. Rebuilding only the environment's installed binding with compatible verified headers resolved it for the repeated browser suites and stress check. Neither the dependency manifest nor lockfile was changed for that workaround. This is local evidence, not a general claim that upstream Node is fixed.

Browser screenshots were inspected internally at desktop 1440×1000 and mobile 390×844. Keyboard focus containment and Escape were exercised, including nested import dialogs. Screen-reader, 200% zoom, stakeholder wording and actual business policy acceptance remain human checks. The parent has not yet independently tested this work.


## Parent QA date correction

Parent testing of the earlier implementation exposed a date validation defect: empty React date state could serialize to `":00Z"`, which JavaScript permissively parsed as January 1, 2000. Normal keyboard entry succeeded, while a DOM-only fill without a change event reproduced the stale-state path. Strict shared calendar/ISO validation now rejects the malformed payload before writes, and native form submission supplies the validated date value. Valid leap days, explicit offsets and milliseconds remain supported; date-only legacy season/game entry remains midnight UTC.

Catalog, events, details and contact history now show explicit UTC consistently. No existing stored timestamps were rewritten. Browser regressions verify the exact `2026-12-20T18:00:00Z` instant and matching event/history dates in Pacific and Tokyo. Parent's final date creation/display recheck on the correction commit remains pending before stakeholder handoff.
