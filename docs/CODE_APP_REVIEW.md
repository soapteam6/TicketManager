# Ticket Manager review — Code App adaptation

**2026-10-26 live QA update:** the later user-authorized AIS Development setup
replaces the unavailable `/review` provider with a transactional Dataverse API.
See [Dataverse QA](DATAVERSE_REVIEW_QA.md) for the applied schema contract,
identity, persistence, live API evidence and pending browser/requester acceptance.
The original synthetic implementation report below describes the earlier
boundary and is retained as historical context. Its no-integration/no-deployment
statements do not describe the subsequently authorized QA backend setup.

Base: `code-app` at `76e250279c401df3f36f9dae078afc257b7a838e`. Working branch: `dot/20261026-ticket-manager-review-code-app`. The standalone review branch remains preserved at `2776812ad06aee75b784fb3499a1422787bf8dd4`.

Requirements source: all 398 lines of the Oct 23 Ticket Manager App Review transcript, previously read from the user-supplied Library file. Its product agreements are requirements, not authorization for real data, identity access or communications.

| Agreement | Code App implementation target |
| --- | --- |
| Simpler coordinator/requester journeys; sports and dated events | Focused workflow using the existing React/Tailwind components and HashRouter; legacy SDK routes retained |
| Private inventory; individual/batch/window/scheduled release | Typed review service with explicit UTC instants and an injectable clock; no scheduler or announcement side effect |
| Interest only; aggregate demand; discretionary allocation | Quantity/people/request counts, private request projections, coordinator decisions and atomic synthetic inventory checks |
| Customer/employee purpose, contacts, opportunity and rationale | GUID-based typed view models, active options, on-behalf capture and preserved phone numbers |
| Directory source and independent app override | Synthetic directory interface; app eligibility survives sync; history retained |
| Simple advisory scoring | Category/rationale/season fairness/known reliability; transparent configurable demonstration defaults |
| Attended / confirmed no-show / unknown | Local review outcome separate from generated Dataverse choices; explicit evidence for no-show, no inference from silence |
| Manual transfer and explicit messages | Local confirmation only; preview/mock outbox; optional follow-up disabled by default; optional photo wording, no uploads |
| Practical schedule entry | Manual entry and deterministic CSV preview/import; private by default; no paid AI or schedule retrieval |
| Cross-season repository | Search business/name/email/phone and inspect allocations and attendance across seasons |
| Testable local workflow | Separate review entry/provider, synthetic fixtures, service and browser checks; no platform plugin/context or connectors in review mode |

## Production boundary

The generated SDK files are preserved. Existing `cr9cd_*` models supply GUID identifier types, but review-only release settings, explicit unknown attendance and decision metadata are **not invented Dataverse columns or choice values**. No generated model is edited to pretend those platform capabilities exist.

Before production integration, humans must provide/review release metadata storage, persisted app/directory override semantics, unknown-attendance representation, actual role/row authorization and transactional allocation operations. Existing generated update operations do not provide an atomic compare-and-swap contract. Browser checks and a single-process synthetic transaction do not establish production concurrency or server-side authorization.

The new workflow's platform route stays blocked until that contract is supplied. The isolated review entry never imports the SDK context or generated service implementations. Existing host/SDK routes remain available separately and retain their original limitations, including the temporary all-admin identity model. No real services, deployments, subscriptions, exports or messages are authorized here.

Keep the Code App's existing date-only helpers and calendar semantics intact. Event/release instants are explicit ISO timestamps; calendar dates are treated separately. Do not copy the standalone SQLite migrations, Express role middleware or production-auth claims into this application.

## Architecture and instruction reconciliation

The corrected base is React 19 / React Router 7 / Vite / generated Dataverse SDK. This adaptation uses that actual manifest and architecture. No Express server, SQLite schema, standalone migrations, new runtime dependency, OAuth grant or external connector was added. The generated GUID identifier types are imported with `import type`; the review models explicitly separate unapproved fields from generated platform rows.

`code-app` has no `AGENTS.md` or `.agents/skills` checkout files. The approved instructions from main at `9b312c5d33338a57ec47dab8be291ab9ccacaeb2` were read as context: business-app-ui-design, web-design-guidelines (bundled offline guidance), react-best-practices, composition-patterns, typed-mocks-and-fixtures, code-apps-foundation and platform-compatibility-review. Their stale standalone/React 18 descriptions were reconciled with the user-corrected Code App base. Relevant UI, composition, typed-boundary and platform practices were applied; no platform authentication or migration was inferred from them.

`ReviewProvider` is the single workflow interface; `MockReviewProvider` owns typed fixtures and atomic single-instance writes. View components consume privacy-projected snapshots, not raw SDK rows. Only synthetic directory sync is asynchronous; it clones the latest state after the await so concurrent app overrides survive. No await occurs within an allocation commit. The platform provider deliberately fails closed. Existing SDK routes and functionality remain available; `/review` in the normal Code App explains the missing integration rather than silently substituting mock writes for production persistence.

Season start/end fields remain calendar strings. Existing `src/lib/format.ts` is unchanged. New review event and release instants require full validated ISO timestamps with explicit timezone offsets; UTC-labelled native form controls read their submitted DOM value and validate it before conversion. Calendar overflows, incomplete dates and `:00Z` are rejected. Display formatting is always explicit UTC.

## Assumptions requiring human acceptance

- Initial scoring weights (0.35 category, 0.25 rationale/context, 0.25 season fairness, 0.15 known reliability) and category values (0.8 customer, 0.7 prospect, 0.2 employee) are transparent **demonstration defaults**, not agreed numeric policy. Coordinators may change them and always record an allocation/override reason. The rationale factor records completeness, not automated judgment of business quality or financial validation.
- Fairness counts other allocation requests for the contact/business in the same sports season. Cross-season history is retained but does not add a same-season penalty. Ad hoc events have no implicit season. Reliability displays confirmed ticket outcomes, with unknown excluded; multiple tickets are explicitly labelled as ticket outcomes rather than distinct attendance events or people. No automatic exclusion or employment decision occurs.
- The local personas model workflow boundaries only. Requester submissions are validated by the provider even if UI controls are bypassed. They are not server security. Production requires authoritative role/row permissions, server-side release/eligibility validation and a server clock; a user-controlled persona/clock must never serve as production authorization.
- Scheduled release is lazy visibility evaluation at an injected instant, without a timer service. A real implementation must query/filter and validate against authoritative time even when no user opens the app, and must not depend on a browser scheduling a write.
- Production assignment needs one atomic server transaction across requested quantity, active eligibility, seat capacity/uniqueness and assignment state (including expected version/idempotency). Existing generated get/update APIs do not establish this. Separate browser tabs intentionally have isolated mock stores; local tests do not prove distributed concurrency.
- Unknown attendance cannot be encoded by inventing a generated choice value. Platform mapping/storage needs review and SDK regeneration through the normal human process. Directory eligibility also needs an independent persisted app override plus source status; a nonempty directory-ID-like field is insufficient because existing customer CRM references use that field too.
- Optional post-event wording, timing, recipient scope and evidence standard need acceptance. The disabled template says photos are optional; no reply remains unknown. There is no real scheduler, email, SMS, upload, transfer, provider integration or subscription.
- CSV parsing is local, deterministic, preview-first and private on import. AI-assisted parsing, live schedule retrieval and paid APIs were possibilities, not committed integrations. Real VGK Nov/Dec inventory entry and the stakeholder session remain human activities; synthetic dates are not claimed as real schedules.

## Verification and handoff

See [CODE_APP_REVIEW_QA.md](./CODE_APP_REVIEW_QA.md) for exact startup, reset, clock, fixtures and independent click-through instructions. Status is `READY_FOR_PARENT_QA`; parent independent QA and human acceptance remain pending.

Untouched base at `76e2502`: five existing tests and typecheck passed. Lint had 17 errors, zero warnings, in existing auth/pickers/pages, choice maps and generated model code. The final lint comparison preserves the same file/line/rule findings; no lint suppression or generated-file edit was used. Normal bundles retain the existing large-chunk warning.

Implementation checks: 38 tests pass (three files), also in `America/Los_Angeles` and `Pacific/Auckland`; typecheck passes; review build passes; normal entry build in environment-file-disabled review mode passes. Changed-source lint passes. Full lint exits 1 on the same 17 baseline findings. Chromium desktop (1440px) and mobile (390px) checks pass against both the dev server and built review artifact for private/manual/scheduled release, strict dates, customer and self interest, privacy, discretionary allocation, manual transfer record, attendance evidence, overrides surviving sync, history, CSV, advisory settings, mock outbox, reset and modal keyboard behavior. The browser reports zero page errors and zero external requests. No SDK/auth/generated-service/CRM implementation is loaded by the review entry.

No repository-configured GitHub Actions/deployment workflow or package lifecycle publication script was found; there are no active local Git hooks. External repository integrations are not visible from this checkout. The Power Apps Vite plugin was inspected before builds; build only sets local asset/CORS config and does not deploy/authenticate. No deploy or `pac` command was run. Only the new feature branch may be pushed; `code-app`, main and the earlier standalone branch remain preserved. No PR was requested or created.

Verification incident: one early normal-entry `npm run build -- --mode review` was executed before `vite.config.ts` disabled review-mode environment loading. An ignored `.env` file exists, so Vite's default loader could read it during that build. Its contents were not inspected or printed; that normal bundle was never run, published or committed. Review-mode environment loading is now explicitly disabled, and the normal output was replaced by a fresh build using that configuration. The separate synthetic dev/build entry used `envDir: false` throughout, and its browser checks loaded no SDK/auth code or external endpoints. The ignored `.env` and legacy data files were not edited.
