# Test the Code App review in Dataverse

**Live QA setup: ready in AIS Development.** The `/review` route now uses the
`cr9cd_TicketReview` Custom API and persistent native Dataverse records. The
environment setup and live API checks were run on 2026-10-26, authenticated as
**emikes@ais-now.com**. No other user was authenticated or impersonated.

**The hosted Allocation desk UI was published on 2026-10-26** to AIS Development
in the AIS Ticket Manager solution, authenticated as `emikes@ais-now.com`.
[Open the hosted app](https://apps.powerapps.com/play/e/946e5045-3200-eb26-9160-3fe967a6b21c/app/1323f8ca-47e5-402e-9657-45f8651af4dc?tenantId=a22e51ee-6f67-49b3-b98c-0e3a97d49b8a).
Hosted testing does not need local servers. Both solution exports are checked
against the production build; see [publication evidence](../solutions/publication.json).

For local development, run **both** local servers on this computer:

```powershell
# Terminal 1: Vite application server
npm run dev -- --port 3000

# Terminal 2: Power Platform connection server (PAC account must be emikes@ais-now.com)
pac code run
```

Open the exact Local Play URL printed by **pac code run**. The user confirmed
this command pair works on 2026-10-26. Use the printed host, ports and URLs
without substituting `127.0.0.1` or a manually assembled link.
Sign in as **emikes@ais-now.com**, the Allocation desk opens directly.
Confirm the workspace header shows your email and coordinator access. Allow the
browser's local network access prompt if shown.

If the host still reports an app-load error, the URL-only workaround
`&PAOverrideFGRollout.EnableAuthenticatedGateway=false` is described in
[Microsoft issue #504](https://github.com/microsoft/PowerAppsCodeApps/issues/504).
See
[Dataverse QA setup and acceptance checks](DATAVERSE_REVIEW_QA.md) for the
applied environment changes, test evidence, roles, and remaining checks.

## Main UI

Allocation desk (B) is the only UI, available at `#/` and `#/review`. The layout
comparison bar and alternate-layout routes have been removed. Old bookmarks
redirect to the main workspace. The isolated synthetic preview uses this same UI. Refresh progress and a brief Updated confirmation appear on the refresh button. Decorative page and list footers have been removed.

Lists start without an automatically selected record. Close buttons clear the selection and return the space to the list. Routine successful saves do not display banners; errors remain explicit.

Errors offer **Copy error** without expanding the visible message. Startup,
refresh, save, AI Import and CSV validation failures copy a JSON report with the
failed action, occurrence time, browser/timezone, original error/cause and
available status codes and request/correlation IDs. Reports omit request payloads,
workspace data and credential headers; recognized credentials in error text and
URL query/fragment values are redacted. If the host blocks clipboard access, a
selected, read-only text area lets the user copy manually. Copying makes no server
request and does not retry a failed change.

The copy diagnostics checks pass in the isolated desktop/iPad browser harness,
including a simulated startup authentication failure, fresh diagnostics after
retry, AI Import failure, CSV validation, clipboard fallback and blocked-clipboard
manual selection. All 93 unit tests, the production build and lint on changed
source files pass. Repository-wide lint still has 17 existing errors in unrelated
legacy/generated files.

The repeated Ticket management/page breadcrumb has been removed, reclaiming its
vertical space for the active workspace.
The top bar also omits the environment label and connection-status dot. The
workspace opens only after its authenticated Dataverse snapshot loads; startup
connection or access failures show the loading error/retry screen instead.

B keeps the workspace within the viewport. Lists, details, and editor panes
scroll independently. Inventory, allocation, contact, team and season rows can
be selected by clicking the row or using Tab and Enter/Space. Nested action
buttons and checkboxes retain their own actions. Allocation and contact details
open on the right. Setup has separate Teams, Seasons and AI Import
sections; import uses a source editor and a validation table before commit.

Desktop and iPad are the target sizes. Browser checks against isolated synthetic
fixtures passed at 1440?1050, 1024?768 and 768?1024, with no page errors or external
requests. They covered row/keyboard selection, event creation, interest,
allocation, visible rejection reasons, history, directory-role projections,
team/season creation, schedule preview/import, bounded page height, and separate
pane scrolling. These checks do not claim live browser or physical iPad acceptance.

Reproduce using `npm run dev:review`, a separate Chrome debugging instance on
port 9224, and `node scripts/design-browser-checks.mjs`. Screenshots and results
are stored in ignored `design-artifacts.local/`. Both Vite configurations exclude
that folder from file watching so browser profile locks do not stop the servers.

The live workspace uses real signed-in identity and server time. It has **no
persona selector, clock override, or reset button**. Refresh and page reload
preserve records. Messages remain saved previews and transfers remain manual.

Live verification passed: native record persistence, invalid-date rollback,
idempotent replay, demand without reservation, competing allocations with exactly
one winner, future-attendance rejection, cancellation without auto-promotion,
and directory synchronization preserving app eligibility. Local checks: **86
frontend tests and 36 offline C# security tests pass**, typecheck and
changed-source lint pass, and platform build passes.
Browser click-through and requester testing with separately authorized accounts
remain pending; these results are API verification, not browser acceptance.

## App admins and solution packaging

The backend now gives `emikes@ais-now.com`, `jjackson@ais-now.com`, and
`aharouff@ais-now.com` fixed coordinator access plus **User access** administration.
Other coordinators cannot assign roles. User access shows name/email, direct
roles, inherited roles and effective access. Choose a row, select an app role
in the right panel and save; refresh to verify it. Group-inherited access can be
managed through Groups; directory membership remains in Entra. Other team roles
remain in Dataverse team administration. Customers remain beneficiary
contacts, not a separate sign-in role.

Live read-only checks verified exactly these three admins and 103 active users;
the setup did not assign individual users new roles. **CRM Sales Rep** is now
connected as a members-only group with Sales representative access. All 301
individual role associations were verified unchanged. Admins can manage it under
**User access → Groups** or connect another security/Microsoft 365 group using
its Object ID. Group members inherit access through Dataverse; membership changes
may require a new sign-in or cache refresh. App sharing and environment access
remain separate. Requester sign-in with approved testers remains an acceptance
task.

The single **AIS Ticket Manager** authoring solution contains the existing app,
17 custom table definitions, the three app roles plus the legacy Ticket Manager
User role definition, signed plug-in and Custom API. The old unmanaged QA
container was backed up and retired after all 29 component entries were verified
as covered. Future setup runs target the main solution.
Managed/unmanaged exports pass content/credential inspection and declare only
the built-in Microsoft EnvironmentVariables prerequisite for runtime key lookup.
See [solution artifacts, commands and deployment boundaries](../solutions/README.md).
The exports contain the current published Allocation desk and User access UI,
including group role administration. The hosted package is verified against the
production build; requester sign-in acceptance remains pending.

## AI Import

As a coordinator, open **Setup & import → AI Import** and describe what you
need, for example: “I got VGK tickets for next season. Find their home schedule
so I can give the tickets out to people.” Select **Prepare import**. No team,
season or ticket quantity is required before asking. The AI resolves team
abbreviations and relative season wording using today's date and public sources.
An unpublished schedule produces an explained empty result rather than invented
games. Other ticket work can continue while the search runs.

After results arrive, review the resolved team/season and choose an existing
season or the proposed new destination. Enter the number of tickets the company
owns per game; the AI never assumes venue capacity is company inventory. New
team/season names and dates can be corrected here. **Create season & import**
saves the new destination and selected private games in one transaction. An
invalid row rolls back the complete command. Existing-season imports use
**Import selected games**. Nothing is allocated, released or sent to people by
the AI, even if the request describes that future intent.

Results appear as an editable preview with source links. Inspect the dates,
opponents and warnings; select the rows to keep, then **Import selected games**.
Search itself creates no inventory. Imported games start private. Unconfirmed
times, unverified sources, out-of-season dates and existing inventory duplicates
cannot be imported as ready rows. Confirmed times are checked against the source
timezone, including daylight saving. UTC is calculated from the source local
date/time and IANA timezone; ambiguous or skipped DST times are excluded. A
current-season substitution for a next-season request is withheld. The preview
date controls display and accept the browser's local timezone, shown beside the
selected count. Event lists, details, event creation and scheduled releases use
that same local timezone. Instants remain stored/transmitted as UTC; existing
inventory timestamps are not rewritten. **CSV import** retains its explicit UTC
input contract and remains available beside AI Import.

The **Ticket Manager - AI Import** Power Automate flow, Dataverse connection
reference, search-job table and `cr9cd_TicketManagerAnthropicApiKey` environment
variable are included in **AIS Ticket Manager**. The key is an environment-specific
Text current value, explicitly approved on 2026-10-27; authorized Dataverse
administrators can read it. Both the runtime key lookup and Claude HTTP call
hide inputs/outputs. The literal key is absent from the browser, source, flow
definition and solution exports. The obsolete Claude connection/connector were
removed after a successful ENV-backed live test. Only the search
phrase, season bounds and home-game choice go to Claude; contacts, requests,
roles and ticket inventory are not sent.

Live verification as `emikes@ais-now.com` searched Las Vegas Aviators home games
in September 2026: **9 games found, 8 ready for review, 1 time TBD excluded**,
with 18 tool-returned source links. No inventory was imported and the workspace
was unchanged. These checks validate the flow and parser; reviewers still need
to check schedule completeness and source accuracy before importing. See
[test evidence](../solutions/schedule-search-test.json).

The 2026-10-27 ENV-backed credential test returned one verified-source VGK game,
with zero inventory imports and unchanged workspace revision 19. The solution
exports contain the variable definition without a default/current key value.
See [credential deployment](../solutions/claude-environment.json) and
[live test](../solutions/claude-environment-test.json).

The plain-language VGK next-season test resolved **Vegas Golden Knights,
2027–28** using the server-pinned date 2026-10-26, and returned an unpublished
schedule explanation with zero games. No existing season was selected, no
inventory was imported and workspace revision 18 was unchanged. An earlier
current-season substitution was rejected; UTC conversion is now calculated in
the client from source local fields. See [AI Import evidence](../solutions/ai-import-test.json).

Local regression coverage now includes **86 frontend tests and 36 backend
security tests**, plus the desktop and iPad preview/import checks. Requester
sign-in and human acceptance in the hosted app remain pending.

## Isolated synthetic regression testing

The instructions below describe the separate in-memory regression entry. Use
the live workflow above for Dataverse testing. Its earlier implementation handoff follows.

Status: **READY_FOR_PARENT_QA**. Implementation checks below were performed by the implementing agent. Independent parent browser QA and human acceptance are pending; this document does not claim either has happened.

Use `dot/20261026-ticket-manager-review-code-app` at the exact commit supplied in the handoff. It is based on `code-app`, not the earlier standalone implementation. No SQLite database or native SQLite binding is involved.

## Start safely

Tested with Node **24.19.0**, npm 11.9.0 and the committed lockfile. In an isolated checkout of the feature commit:

```sh
npm ci --ignore-scripts --cache /tmp/ticket-manager-review-npm-cache --no-audit --no-fund
npm run dev:review
```

Open **http://127.0.0.1:5173/** in a browser on the same machine. This entry uses `vite.review.config.ts`, disables `.env` loading, omits the Power Apps plugin and imports no SDK context, authentication service, generated service implementation or CRM client. Do not substitute `npm run dev`, which starts the existing platform entry.

The server binds loopback only. There is no supported cross-container preview route in this execution environment. The parent cloud browser cannot reach the implementing container's localhost; run this exact commit in the parent's desktop workspace instead. No tunnel, deployment or public publication is required or authorized.

For the built artifact instead:

```sh
npm run build:review
npm run preview:review
```

Open **http://127.0.0.1:4173/** on the same machine. `review-dist/` is ignored. Never serve the normal `dist/` bundle for mock QA: it contains the existing SDK entry.

## Fixtures, personas and reset

All records are invented: Synthetic Comets, Juniper Example Labs, Cobalt Sample Studio, `.invalid` email addresses, 555 phone numbers and GUIDs generated for fixtures. Sports dates are examples, not verified real schedules.

- **Demo Coordinator**: setup, private inventory, release, on-behalf interest, advisory review, allocations, manual transfer records, attendance, contacts, eligibility overrides and local previews.
- **Demo Representative**: released inventory, own interest, customer contacts and self employee option. It never receives other requesters' private requests, scores, reliability history or coordinator datasets.
- **Demo Employee**: released inventory and self employee interest only. No other employee choices.

The fixed initial demo clock is **2026-10-26 12:00 UTC**. Expand “Demo clock” as coordinator to apply a different instant. This is an explicit test control, not an authoritative production clock. Event/release/history timestamps display in the browser's local timezone; stored instants and the fixture reference table below use UTC. Seasons keep date-only calendar strings; existing Code App date-only helpers are unchanged.

Data is held only in one provider instance in browser memory. Switching personas preserves it for that tab. **Reset synthetic demo** or a page reload restores fixtures, the clock, eligibility overrides, scores and empty outbox. Each tab starts independently. There is no persistence, localStorage, database or shared server, and no real service call.

Initial inventory:

| Synthetic item | Visibility | Date/time UTC | Fixture state |
| --- | --- | --- | --- |
| Synthetic Comets · Example Rivals | Private | Nov 5, 2026 03:00 | 4 tickets, existing 2-ticket interest entered on behalf of representative; no allocation |
| Synthetic Comets · Sample Visitors | Released | Dec 9, 2026 03:00 | 4 tickets, no interest |
| Synthetic Winter Performance | Private, no season | Dec 15, 2026 02:00 | 4 tickets |
| Past Demo Night | Private/completed | Oct 1, 2026 02:00 | One historical Alex allocation with unknown attendance |
| Previous Season Example | Private/completed | Mar 1, 2026 02:00 | One historical Alex allocation with confirmed attended outcome |

## Independent click-through

1. In a Pacific-time browser, add a **Dated event** titled “QA Concert”, date/time **2026-12-20 18:00 local**, 2 tickets. It needs no season and starts private. This is Dec 21 02:00 UTC; an Eastern-time browser should show Dec 20 21:00. Malformed dates and ambiguous/skipped daylight-saving times must fail validation.
2. Switch to representative: only Sample Visitors is initially visible. Return to coordinator, select Example Rivals and Winter Performance, choose Release now and Save visibility. Return to representative and verify both appear. In Mock messages the outbox stays empty.
3. On Sample Visitors, express customer interest for 2 tickets. Choose Juniper Example Labs, Alex and Quinn, optional synthetic opportunity, and a concise rationale. Verify 4/4 tickets remain available; demand becomes 1 request / 1 requesting person / 2 tickets requested. These count requesting people, not contact/beneficiary headcount. Fulfilled interest stays included in the demand totals; cancelled interest does not.
4. As employee, enter self interest for 1 ticket on the same game. Verify availability is still 4/4. My interest shows only the employee's own request; other requesters' identities and rationale are absent.
5. As coordinator under Requests, filter Sample Visitors. Expand advisory factors; review category, rationale, same-season fairness and confirmed reliability. Allocate 2 tickets to the customer request with an explicit reason. Availability becomes 2/4. Repeated or excessive allocations are rejected; two competing synthetic commands cannot claim one ticket. Optionally waitlist another request; it reserves no seats and never auto-promotes.
6. Under Transfer & attendance, locate a new allocation and retain the contact's email/phone for the manual provider-app step. The checkbox/reference records only a **synthetic local confirmation**. No provider is contacted and no ticket is delivered. Attendance remains unknown. Trying Attended for a future event must fail.
7. On Past Demo Night, No-show without evidence must fail. Add explicit synthetic confirmation and save, then inspect Alex's coordinator reliability flag/history. Correcting back to Unknown retains the audit trail and removes it from confirmed no-show evidence. Silence or missing photos never creates a no-show.
8. In Contacts & history, search “Demo Employee”, make app inactive, then Sync synthetic directory. App inactive and directory active remain distinct. Employee persona now has no eligible beneficiary and cannot submit self interest. Reactivate only if wanted. Alex's history remains across both seasons; search also supports business, email and phone. Customer contacts can be added/edited without changing directory state.
9. In Setup & import, add a synthetic team/season or preview the supplied two-row CSV. Preview does not create inventory. Import explicitly and verify both new items are private, with the dated event outside any season. Wrong calendar dates, extra columns or duplicate rows must fail the command atomically.
10. In a Pacific-time browser, select QA Concert, choose Schedule release, set **2026-10-26 06:00 local** (13:00 UTC). It stays hidden to requesters before that instant. Apply demo clock 13:00 UTC as coordinator; the requester catalog now includes it. No external scheduler or automatic message runs. Date-window inputs use local wall time and are converted to UTC instants for comparison.
11. In Scoring, adjust demonstration weights/category values and save. Values are transparent and advisory; no automatic allocations or employment decision follows. Lead time, premium balance, employee/customer balance and duplicate attendance weighting stay disabled. Equal scores use stable IDs, with no hidden tier/lead-time tiebreak.
12. In Mock messages, refresh the availability summary and explicitly add it to the mock outbox. Follow-up is disabled initially. Enable and save the optional template before adding a follow-up preview. No send control, SMS, game-day reminders, subscription, upload or real delivery exists.
13. At a narrow viewport (390px), verify wrapped navigation/cards, labels, empty/error states, dialog initial focus, Tab/Shift+Tab loop, Escape dismissal and focus return. Reset the demo and verify all changes disappear.

## Automated checks

```sh
npm test
TZ=America/Los_Angeles npm test
TZ=Pacific/Auckland npm test
npm run typecheck
npm run build:review
npm run build -- --mode review
npm run lint
```

`npm test` uses the platform-free `vitest.review.config.ts` for the existing scoring tests and new review tests. The normal build in `--mode review` disables environment-file loading, compiles the existing platform entry without running/authenticating it, and does not deploy anything.

Optional browser automation uses an already installed Python Playwright driver and Chromium, not a repo skill installation:

```sh
python3 scripts/review-browser-checks.py
REVIEW_URL=http://127.0.0.1:4173 python3 scripts/review-browser-checks.py
```

Run the respective loopback server first. Override `CHROMIUM_PATH` for another installed Chromium. The script rejects non-loopback URLs, blocks external requests, drives real desktop/mobile UI and checks for SDK/auth imports and page errors. Artifacts go to `/tmp/ticket-manager-code-app-browser` (override `REVIEW_ARTIFACTS`), never to the repository or a real service. Parent may follow the manual guide if this optional driver is unavailable; do not authenticate or install platform integrations to test the demo.

Implemented-agent results are recorded in [CODE_APP_REVIEW.md](./CODE_APP_REVIEW.md). Parent must report its own independent results before the human handoff is marked `WAITING_FOR_HUMAN_TESTING`.
