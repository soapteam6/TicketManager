# Reproduce the synthetic Code App review

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

The fixed initial demo clock is **2026-10-26 12:00 UTC**. Expand “Demo clock” as coordinator to apply a different instant. This is an explicit test control, not an authoritative production clock. All review event/release/history timestamps show UTC even when the browser is in another timezone. Seasons keep date-only calendar strings; existing Code App date-only helpers are unchanged.

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

1. As coordinator, add a **Dated event** titled “QA Concert”, date/time **2026-12-20 18:00 UTC**, 2 tickets. It needs no season and starts private. Verify the displayed instant stays Dec 20, 18:00 UTC in another browser timezone. Malformed date inputs such as `:00Z` are rejected by the service as well as form validation.
2. Switch to representative: only Sample Visitors is initially visible. Return to coordinator, select Example Rivals and Winter Performance, choose Release now and Save visibility. Return to representative and verify both appear. In Mock messages the outbox stays empty.
3. On Sample Visitors, express customer interest for 2 tickets. Choose Juniper Example Labs, Alex and Quinn, optional synthetic opportunity, and a concise rationale. Verify 4/4 tickets remain available; demand becomes 1 request / 1 requesting person / 2 tickets requested. These count requesting people, not contact/beneficiary headcount. Fulfilled interest stays included in the demand totals; cancelled interest does not.
4. As employee, enter self interest for 1 ticket on the same game. Verify availability is still 4/4. My interest shows only the employee's own request; other requesters' identities and rationale are absent.
5. As coordinator under Requests, filter Sample Visitors. Expand advisory factors; review category, rationale, same-season fairness and confirmed reliability. Allocate 2 tickets to the customer request with an explicit reason. Availability becomes 2/4. Repeated or excessive allocations are rejected; two competing synthetic commands cannot claim one ticket. Optionally waitlist another request; it reserves no seats and never auto-promotes.
6. Under Transfer & attendance, locate a new allocation and retain the contact's email/phone for the manual provider-app step. The checkbox/reference records only a **synthetic local confirmation**. No provider is contacted and no ticket is delivered. Attendance remains unknown. Trying Attended for a future event must fail.
7. On Past Demo Night, No-show without evidence must fail. Add explicit synthetic confirmation and save, then inspect Alex's coordinator reliability flag/history. Correcting back to Unknown retains the audit trail and removes it from confirmed no-show evidence. Silence or missing photos never creates a no-show.
8. In Contacts & history, search “Demo Employee”, make app inactive, then Sync synthetic directory. App inactive and directory active remain distinct. Employee persona now has no eligible beneficiary and cannot submit self interest. Reactivate only if wanted. Alex's history remains across both seasons; search also supports business, email and phone. Customer contacts can be added/edited without changing directory state.
9. In Setup & import, add a synthetic team/season or preview the supplied two-row CSV. Preview does not create inventory. Import explicitly and verify both new items are private, with the dated event outside any season. Wrong calendar dates, extra columns or duplicate rows must fail the command atomically.
10. Select QA Concert, choose Schedule release, set **2026-10-26 13:00 UTC**. It stays hidden to requesters before that instant. Apply demo clock 13:00 as coordinator; the requester catalog now includes it. No external scheduler or automatic message runs. Date-window release supports inclusive UTC boundaries for rolling batches.
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
