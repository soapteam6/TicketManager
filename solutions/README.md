# AIS Ticket Manager solution

The unmanaged **AIS Ticket Manager** solution (`AISTicketManager`, version
`1.1.0.0`) was assembled in AIS Development on 2026-10-26. The app remains the
same app ID; adding it to this solution does not create another app or move data.

[Open the solution](https://make.powerapps.com/environments/946e5045-3200-eb26-9160-3fe967a6b21c/solutions/1c411462-63d1-f111-a05b-6045bd069cda/overview).

It contains all 16 custom tables declared by the project (including the review
workspace), the three active app security roles plus the legacy Ticket Manager
User role definition, the signed `TicketReview`
plug-in assembly, the `cr9cd_TicketReview` Custom API and its Payload/Result
contract, and the existing AIS Ticket Concierge code app. Dependencies were
included by Dataverse. Both managed and unmanaged exports reported **zero missing
dependencies** and passed local content inspection. The unmanaged export was
also successfully unpacked with PAC. Import into a separate environment has not
been tested.

**AIS Ticket Manager is the single authoring solution for this project.** The
redundant unmanaged `AISTicketReviewQA` container was retired on 2026-10-26 after
all **29** of its component entries were verified as covered by the main
solution. Its partial table entries and 14 explicit columns are included through
the main solution's full table definitions. The old definition was exported to
ignored `AISTicketReviewQA_before_consolidation.zip` before deletion. Component
definitions, workspace revision **14**, ETag and settings were preserved.
[consolidation.json](consolidation.json) records the result.

Provisioning and packaging share `scripts/ticket_solution.py`; setup runs now
target `AISTicketManager` and do not recreate the retired QA container. Dataverse's
built-in Default solution continues to expose unmanaged components as usual.

## Local artifacts and repeatable export

```powershell
# Read-only plan, pinned to AIS Development and emikes@ais-now.com:
python scripts/package-ticket-solution.py

# Reapply membership and the API prerequisite privileges only after announcing
# the environment changes. Does not assign roles or publish the code app:
python scripts/package-ticket-solution.py --apply

# Export the existing solution without changing its membership:
python scripts/package-ticket-solution.py --export

# Read-only consolidation audit; reports already consolidated after retirement:
python scripts/consolidate-ticket-solutions.py

# Unpack into an ignored local folder:
pac solution unpack --zipfile solutions/AISTicketManager_unmanaged.zip --folder solutions/AISTicketManager.local --packagetype Unmanaged --allowWrite
```

The ZIPs and unpacked `.local` folder are ignored. The two `.manifest.json` files
record their contents and dependency inspection. Source for the app and plug-in
remains in `src/` and `plugins/TicketReview/`; the original signing key is local
and ignored. Retain that key for updates to this assembly.

The legacy Ticket Manager User role is included to keep its definition with the
project. Its privileges and assignments were preserved; it is not an app-admin
role and is not offered by the application's three-role assignment controls.

**The approved Allocation desk and User access UI were published on 2026-10-26**
to the existing AIS Development app in this solution, using only
`emikes@ais-now.com`. This includes the Groups role-management screen.
[Open the hosted app](https://apps.powerapps.com/play/e/946e5045-3200-eb26-9160-3fe967a6b21c/app/1323f8ca-47e5-402e-9657-45f8651af4dc?tenantId=a22e51ee-6f67-49b3-b98c-0e3a97d49b8a).
Local servers are not needed for the hosted app. The production build and all
64 frontend tests passed before publication; live read-only checks verified the
backend, admins, group binding and solution membership afterward.

Both managed and unmanaged solution exports contain the current app build.
Every app file is compared byte for byte with `dist/`; file hashes, verification
time and deployed source commit are recorded in [publication.json](publication.json).
For subsequent approved publications, the installed PAC 2.9.3 commands are:

```powershell
npm run build
pac code push --environment https://org5c824bd0.crm.dynamics.com --solutionName AISTicketManager
python scripts/package-ticket-solution.py --export
python scripts/verify-ticket-publication.py
```

Verify the active PAC account is `emikes@ais-now.com`, announce that publication
before running it, and export again afterward so the ZIPs contain the new bundle.
The installed CLI uses `--solutionName`; newer documentation may describe
different flags. Do not run a publish command merely to refresh the local app.

The first export verification found the binary WebP logo rewritten as UTF-8
replacement bytes by the Dataverse solution export. The unchanged logo now uses
Vite's explicit `?inline` import, preserving its original bytes as a data URL in
the JavaScript bundle. See [Vite's asset import documentation](https://vite.dev/guide/assets#explicit-inline-handling).
This fix was rebuilt, tested and republished before the final export comparison.
Future binary assets should also be checked with the publication verifier.

## Roles and deployment boundaries

The three fixed app admins are `emikes@ais-now.com`, `jjackson@ais-now.com`, and
`aharouff@ais-now.com`. The plug-in verifies the authenticated Dataverse login
and active user identity. Admins receive coordinator access plus role assignment;
an ordinary coordinator cannot assign roles. These are application admins, not
Dataverse System Administrator grants.

Role assignments use existing native Dataverse security-role associations.
There is no new role-assignment table. User access can replace or remove direct
assignments of only Ticket Manager Coordinator, Representative or Employee.
Other security roles and team memberships are preserved. Team-inherited access
is shown separately and cannot be removed by changing the direct assignment.
All three roles now include `prvReadOrganization`, required by this Custom API,
in addition to Dataverse's pre-existing baseline privileges. No individual user
roles were assigned by the deployment scripts. The explicit group binding below
was applied after the user identified the group and its Object ID in a screenshot.

### Directory groups

Admins can select **User access → Groups**, select a linked group by name or ID,
and assign its app role in the right panel. **Connect group** links an existing
Microsoft Entra security or Microsoft 365 group by Object ID. Dataverse validates
the group and supplies its real name/type; new links use **Members** membership
(not guests). No Entra group is created and memberships are not copied into
individual user roles. Ordinary coordinators cannot administer group access.

**CRM Sales Rep**, Object ID `e4f13002-21b5-4479-a530-f73c8579eaf7`, is now linked
in AIS Development with **Members → Sales representative**. Its source screenshot
showed 15 direct members. The native team-role assignment was verified, and all
**301 individual role associations** were unchanged before/after the operation.
The pre-existing FLOW group's roles and membership were left unchanged.

The server already honors direct and team-inherited app roles. Dataverse derives
group membership when users access the environment; changes can require a new
sign-in or refresh of Dataverse's membership cache. The team member list does
not necessarily contain every directory member before they sign in. See
[Microsoft's group-team guidance](https://learn.microsoft.com/en-us/power-platform/admin/manage-group-teams).

The current PAC application's Graph login cannot list tenant groups (HTTP 403),
so the UI searches already-linked groups and accepts an Object ID for a new link.
No new connector, consent request, interactive login or Azure CLI was introduced.

[group-access.json](group-access.json) records the tenant-specific deployment
binding. Native group teams and their role associations are data, not components
carried by the solution ZIP. Apply deliberate bindings separately after import,
reviewing each target tenant/group first:

```powershell
# Read-only plan against AIS Development, verified emikes@ais-now.com:
python scripts/configure-ticket-groups.py

# Announce the exact target group/role before applying. Repeating a matching
# binding makes no changes; stale role edits and duplicate links are rejected:
python scripts/configure-ticket-groups.py --apply
```

Customers are beneficiary contacts in this app, not a fourth sign-in role.
Sales representatives can request for customer contacts or themselves;
employees can request for themselves. Environment access, licensing, app sharing
and the user's connection consent remain separate from app role assignment.

Solution exports contain metadata and app files. They do **not** migrate user
role assignments, business records or the workspace settings row. A fresh
environment needs an explicit bootstrap of workspace
`f18b973a-2936-44e5-aa55-271d7424aef3`, using the initial settings contract in
`scripts/setup-dataverse-review.py::empty_settings`, plus deliberate data
migration or approved fixtures. Deployment scripts are intentionally pinned to
AIS Development; provisioning another environment requires a separately reviewed
target and credentials. The current API reads only records scoped to
`ais-ticket-review-v1`. Unscoped legacy records have not been migrated.

## Verification

On 2026-10-26: production build and changed-source lint passed; **64 frontend
tests** and **24 offline C# security tests** passed. Synthetic browser checks
passed at desktop, iPad landscape and iPad portrait sizes, including granting
and reversing a role, ordinary coordinator privacy, row selection, closable
right-side details and bounded page scrolling. Group checks covered connecting
a group, assigning its role, admin-only management, inherited access, stale
edits, preservation of other roles and members-only scope.

Live read-only checks as `emikes@ais-now.com` verified exactly three fixed admins,
103 active directory users, direct/team role projections, role prerequisite
privileges, the live CRM Sales Rep group binding and complete solution membership.
Twelve concurrent snapshot loads left workspace revision **14**, its ETag and
lock unchanged. The deployed backend
was verified without authenticating or impersonating other users.

```powershell
dotnet build plugins/TicketReview.Tests/TicketReview.Tests.csproj -c Release
./plugins/TicketReview.Tests/bin/Release/net462/TicketReview.Tests.exe
python scripts/test-ticket-solution.py
python scripts/test-dataverse-access.py
python scripts/test-dataverse-review-loading.py
```

The consolidation guard also passed **7 offline tests**, covering full-table
column inclusion, missing standalone components, mismatched IDs and incomplete
table exports. Post-consolidation live checks verified the retired QA solution is
absent and all four Ticket Manager role definitions remain in the main solution.

Live individual role assignment/removal with approved testers, requester sign-in acceptance,
hosted-browser acceptance and a clean-environment import/bootstrap remain manual
acceptance/deployment work. The offline tests exercise role replacement, stale
edits, fixed-admin protection, preservation of unrelated and inherited roles,
business-unit copies and paginated queries; they do not replace those live checks.
