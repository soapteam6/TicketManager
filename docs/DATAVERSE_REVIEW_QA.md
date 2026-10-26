# Dataverse review QA

AIS Development: `https://org5c824bd0.crm.dynamics.com`

Environment: `946e5045-3200-eb26-9160-3fe967a6b21c`.
Verified tooling account: **emikes@ais-now.com**, Dataverse user
`473bfe9d-8349-f111-bec6-00224802fa72`. Setup scripts reuse the existing Power
Platform CLI cache and verify the actual Dataverse domain user before accessing
the environment. They do not use Azure CLI or switch accounts.

## Open the app

The hosted UI was published on 2026-10-26 into **AIS Ticket Manager** as
`emikes@ais-now.com`.
[Open the app](https://apps.powerapps.com/play/e/946e5045-3200-eb26-9160-3fe967a6b21c/app/1323f8ca-47e5-402e-9657-45f8651af4dc?tenantId=a22e51ee-6f67-49b3-b98c-0e3a97d49b8a).
Local servers are only needed for local development. Published build/export
hashes and source commit are recorded in `solutions/publication.json`.

For local development, run both servers in separate terminals:

```powershell
npm run dev -- --port 3000
```

```powershell
pac auth who
pac code run
```

Confirm PAC reports **emikes@ais-now.com**. Open the exact Local Play URL
printed by **pac code run**, using its default host and port. The user confirmed
this command pair works; do not substitute a manually assembled launch URL.
The Allocation desk opens directly. Check the signed-in email in the
workspace header. Keep both processes running while using Local Play.

If the Power Apps host says "This app isn't working", try appending
`&PAOverrideFGRollout.EnableAuthenticatedGateway=false` to the Local Play URL.
[Microsoft issue #504](https://github.com/microsoft/PowerAppsCodeApps/issues/504)
describes a recent host regression that ignores the local app URL when this
rollout flag is enabled. Microsoft reported disabling the rollout on October 22;
the URL override is a troubleshooting step, not a confirmed diagnosis for every
host error. It does not change the Dataverse environment or publish the app.
If the error persists, obtain its error code from the host's details panel before
changing connections or authentication.

`npm run dev:review` remains a separate platform-free in-memory regression demo.

## Applied environment changes

The complete development solution is now **AISTicketManager** ([solution and
deployment notes](../solutions/README.md)). It includes the existing code app,
16 complete custom table definitions, the three app roles plus the legacy Ticket
Manager User role definition, assembly and Custom
API. Managed and unmanaged exports passed content inspection with zero missing
dependencies. The redundant **AISTicketReviewQA** unmanaged solution container
has been exported for recovery and removed. All 29 component entries were
verified as covered by the main solution, preserving component definitions and
workspace revision 14. Setup/packaging now share a single solution configuration
in `scripts/ticket_solution.py`, so setup does not recreate the QA container.
Changes were announced before application and made only in AIS Development:

- `cr9cd_review_scope` (text) and `cr9cd_review_data` (JSON memo) on
  `cr9cd_team`, `cr9cd_season`, `cr9cd_game`, `cr9cd_seat`,
  `cr9cd_contact_beneficiary`, `cr9cd_ticketrequest`, and `cr9cd_assignment`.
- Organization-owned `cr9cd_reviewworkspace` table with name, data memo,
  revision integer and lock token. The QA settings row is
  `f18b973a-2936-44e5-aa55-271d7424aef3`; optimistic concurrency is enabled.
- Signed sandbox assembly `TicketReview`, type `Ais.TicketReview.ReviewApi`,
  and synchronous unbound Custom API `cr9cd_TicketReview` with string
  `Payload` and `Result` parameters. No CRUD event steps were registered.
- App roles `Ticket Manager Coordinator`, `Ticket Manager Representative`, and
  `Ticket Manager Employee`. Each now includes the API's `prvReadOrganization`
  prerequisite alongside Dataverse's pre-existing baseline privileges. No
  individual users were assigned roles by this setup. CRM Sales Rep was later
  explicitly linked with a members-only group role, as described below.
- Five fixture events, their teams/seasons/seats, three customer contacts,
  historical requests/allocations, and employee contacts sourced from active
  full-access Dataverse users. Native display names begin `[QA]`; queries for
  this workflow require `cr9cd_review_scope = 'ais-ticket-review-v1'`.
- One additional private event named `QA API smoke 2026-10-26 15:29:53`, two
  test requests and a cancelled test allocation were created by verification.

Existing inventory records were not migrated or changed. Generated models were
not edited. The JSON memo stores the versioned review DTO, including release,
eligibility, decision and unknown-attendance metadata. Standard native fields
and lookups are written alongside it. Scoring settings, message previews,
attendance audit history and operation receipts live in the workspace settings.

This is a QA integration contract. Only the review API understands all of its
metadata. Use `/review` to edit these records: legacy pages and exports do not
interpret the complete contract. Cross-org CRM/opportunity search, Entra/Office
365 directory integration, native attendance rollups and automated delivery are
not exercised by this route. Opportunity is free-text context; directory sync
reads this environment's Dataverse users.

## Web schedule search

**Setup & import → AI Import** calls the review API to
create a job in the new organization-owned `cr9cd_schedulesearch` table.
The **Ticket Manager - AI Import** cloud flow researches public schedules
with Claude web search/fetch, then saves its result to that job. The API enforces
coordinator permission, authenticated requester ownership, scoped season input
and idempotent job IDs. Polling and job creation bypass the ticket-workspace
lock/revision; the flow writes only job status/results, never inventory.

The screen previews editable games and source links. Native web-tool results
must support each source URL. UTC conversion is checked against each source's
local date, time and IANA timezone. UTC instants are calculated independently;
TBD or ambiguous DST times are excluded. The preview and event screens display
and accept the browser's local timezone. Existing timestamps remain UTC and are
not rewritten. CSV text continues to require UTC input. Games
stay unimported until the coordinator selects **Import selected games**; normal
transactional CSV validation then creates private inventory. CSV input remains
available as a fallback.

All new components belong to `AISTicketManager`: the 17th custom table, the flow,
custom Claude connector and two connection references. The key is encrypted in
the server connection and absent from the client/repository/flow definition.
Only public search text, season date bounds and home-only selection go to the
model. The original Claude flows and individual role associations were untouched.

A live search as `emikes@ais-now.com` completed queued → searching → complete:
Las Vegas Aviators home games in September 2026, 9 rows, 8 ready, 1 time TBD,
18 tool-returned sources, zero inventory imports and unchanged workspace.
[Evidence](../solutions/schedule-search-test.json) and
[setup/export commands](../solutions/README.md#schedule-search) are recorded.
Synthetic desktop and both iPad orientations pass the new preview/import flow.
Human hosted-app acceptance and clean-environment import remain pending.

## Identity and transactions

The API resolves `InitiatingUserId` and direct/team Dataverse security roles.
Only the authenticated logins `emikes@ais-now.com`, `jjackson@ais-now.com`, and
`aharouff@ais-now.com` receive fixed app-admin access: coordinator permissions
plus the ability to assign app roles. The check uses the active user's Dataverse
login and Entra identity, not a client email or editable contact address.
Other users need a Ticket Manager role; System Administrator or System Customizer
alone no longer implies application access. An ordinary coordinator cannot
assign roles. Client persona keys are never sent to the API. No all-admin UI
override from the legacy authentication service authorizes review writes.

Admins see **User access**, with names/emails, direct roles, inherited team roles
and effective access. Saves replace only the three supported direct app-role
associations, preserving all other roles and teams. Business-unit role copies
resolve by root role identity. Fixed admins cannot be demoted here; stale role
edits are rejected. A new table is not required. Customers are beneficiary contact
records rather than a separate sign-in role.

**User access → Groups** manages linked Microsoft Entra security/Microsoft 365
group roles. Connect group accepts the Object ID and uses Dataverse to validate
and resolve the group name; new links are members-only, excluding guests. Saves
change only the three app role families on that group and preserve individual
roles, unrelated team roles and directory membership. Group administration is
restricted to the fixed app-admin allowlist.

**CRM Sales Rep** (`e4f13002-21b5-4479-a530-f73c8579eaf7`) was connected and assigned
Sales representative for members after the user provided its screenshot. Its
native team binding and role association were verified live. All 301 individual
role associations remained unchanged. The group configuration is recorded in
`solutions/group-access.json` and can be planned/applied with
`scripts/configure-ticket-groups.py`. Group links/assignments must be configured
separately when migrating environments; they are not solution components.

Requester projections omit coordinator datasets and other people's requests.
The API validates private/scheduled release and employee self-interest. For
multiuser testing, an app admin can deliberately assign a chosen active Dataverse
tester a role from User access. Environment access, app sharing, licensing and
connection consent remain separate. Inherited group access can be changed through
Groups; directory membership remains in Microsoft Entra. Other team roles remain
in Dataverse administration. Dataverse refreshes membership at sign-in/cache
refresh, so directory changes need not appear immediately.

Mutations require an expected workspace revision and unique operation ID.
Dataverse locks the workspace row with optimistic concurrency before reading
the records. Validation, native row writes and revision update execute in the
same synchronous transaction; failure rolls everything back. The latest 100
operation receipts support duplicate-call reconciliation. The UI refreshes after
a failed write and asks the tester to review before retrying; it does not retry
commands automatically. Scheduled release and attendance validation use UTC
server time. Refresh to see another session's changes or a newly due release.

The API internally uses the system service after checking caller roles. Review
privacy does not override any broader native-table privileges a tester already
has. Environment-wide table security, production deployment and testing with
actual requester accounts remain separate acceptance work.

## Manual acceptance

1. Confirm the signed-in email and coordinator role. Inventory should contain
   the five sample events and the private API smoke event.
2. Add a uniquely named dated event without a season. Refresh the page and
   verify persistence. Keep actual inventory separate from these QA records.
3. Release private inventory or schedule release a few minutes ahead. Refresh
   after the scheduled instant. Requester verification requires an actual
   separately authorized requester session; there is no live persona switch.
4. Express customer interest using Alex/Quinn from Juniper Example Labs, or
   employee interest using your own directory contact. Interest should increase
   demand while leaving availability unchanged. On-behalf options are actual
   enabled Dataverse users.
5. Review advisory factors and allocate with a reason. Refresh in another tab;
   verify availability and request status. Competing stale writes must be rejected.
6. Record a manual transfer only for a deliberately simulated QA step. This saves
   a confirmation, and performs no provider operation or delivery.
7. On Past Demo Night, reject no-show without evidence, save a confirmation,
   then correct to Unknown. History should retain the change and reliability
   should exclude Unknown. Future confirmed attendance must fail.
8. Disable your QA employee contact, sync Dataverse users, and verify the app
   override survives. Restore its prior active state after the test.
9. Preview and import a unique CSV batch. Verify imported records start private;
   invalid dates, extra columns and duplicates should roll back the entire import.
10. Save advisory settings and a message preview. Refresh and verify they persist.
    No message is sent. Reload never resets live QA data.
11. With approved requester accounts, check catalog visibility, own-request
    privacy, employee-only self selection, role denial and server authorization
    when bypassing UI controls. Do not treat coordinator-only checks as proof of
    these multiuser acceptance cases.

## Verification and maintenance

On 2026-10-26, live checks as emikes@ais-now.com passed invalid timestamp
rollback, idempotent create replay, interest without seat reservation,
two competing allocations with exactly one winner, future-attendance rejection,
cancellation without auto-promotion, app override surviving directory sync, and
native game persistence across independent requests. Workspace revision after
these checks: **9**. No other user was authenticated or impersonated.

Latest local validation: **64 frontend tests**, **24 offline C# security tests**,
TypeScript, changed-source ESLint and the normal production build pass. Synthetic
browser checks passed at desktop and both iPad orientations, including role grant
and reversal, group linking/assignment and coordinator/admin separation. This does not claim live browser
acceptance or a physical iPad test.

After the admin backend deployment, live read-only checks verified the exact
three-account allowlist, 103 active users, role projections and solution
membership and the native CRM Sales Rep members-only role. Twelve concurrent loads left workspace revision **14**, ETag and
lock unchanged. No user was authenticated or impersonated other than
`emikes@ais-now.com`, and the deployment did not assign individual user roles. Live individual grants
and requester acceptance with approved testers remain pending. The hosted UI
has now been published and both solution exports are verified against its
production build. Hosted-browser and physical-iPad acceptance are not implied by
the artifact and API checks.

```powershell
# Read-only description of provisioning:
python scripts/setup-dataverse-review.py

# Live smoke tests CREATE private QA records; announce before running:
python scripts/test-dataverse-review.py

# Reapply provisioning only after announcing environment changes:
python scripts/setup-dataverse-review.py --apply --seed

# Upload a rebuilt plug-in only, after announcing the environment update:
python scripts/setup-dataverse-review.py --apply --plugin-only
```

The scripts need the installed Python `requests`, `msal`, and `msal-extensions`
packages and a current PAC login. Plug-in source is in
`plugins/TicketReview`; build with `dotnet build plugins/TicketReview/TicketReview.csproj -c Release`.
The signing key is local and ignored. Retain that key for assembly updates;
do not commit it or generate a replacement for an existing registration.
Provisioning reruns do not overwrite a seeded workspace. No automatic cleanup
or delete-all reset is supplied. Announce and explicitly scope any cleanup to
the QA workspace before deleting data.

The platform implementation follows Microsoft's [Custom API registration](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/create-custom-api-with-code)
and [optimistic concurrency](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/optimistic-concurrency)
contracts. Local Play behavior was checked against the installed Power Apps
Vite plug-in README.

## Interactive QA feedback, 2026-10-26

The user confirmed that the review workflow opens, persistence works, and future
attendance is rejected. The rejection reason was too easy to miss. The UI now
shows a persistent, dismissible error popup above dialogs and preserves nested
Dataverse validation messages. Recheck the future-attendance case after reload.

Coordinator request cards and allocation dialogs now distinguish the requesting
person (name and email), the beneficiaries, and a different coordinator who
entered interest on their behalf. The existing QA plug-in was updated to resolve
these names from Dataverse, including historical users. Its live API response
and unchanged future-attendance rejection were checked as emikes@ais-now.com;
no successful attendance change was made by that check.

Some regular licensed users in this environment have a literal leading `#` in
their Dataverse profile names. It is not an app eligibility flag and was not used
to classify these people as application accounts. Display names now omit that
prefix; contact/requester source spelling remains available on hover and the
stored names and user IDs are preserved.

## Startup concurrency correction, 2026-10-26

The initial implementation locked the workspace row for snapshots as well as
mutations. Duplicate startup loads (including React StrictMode) or concurrent
tabs could therefore reject each other with a RowVersion conflict before the UI
opened. This was an integration defect, not an allocation conflict.

Snapshot operations now perform no writes. They read the revision before loading
records and check it again after building the projection, repeating the read if
an edit committed across it. Actual mutations retain the existing transactional
write lock, expected revision check and operation receipts.

The client shares pending startup reads, bounds automatic retries to transient
read conflicts, and never retries authentication/permission failures or commands
automatically. A delayed refresh cannot replace a newer save response. The
loading UI uses the normal Allocation desk identity and plain recovery messages;
platform RowVersion wording is translated rather than shown to the user.

The existing TicketReview plug-in update was announced and applied in AIS
Development as emikes@ais-now.com. A live regression ran 12 snapshot requests
with six concurrent callers: all succeeded, with unchanged workspace ETag,
lock token, modified time and revision (11). No test records were created.
Repeat that read-only check with
`python scripts/test-dataverse-review-loading.py`.

Local verification: 57 tests, TypeScript, changed-source lint, plug-in build and
platform build pass. The existing large-bundle warning remains.
