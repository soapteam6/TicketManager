"""Live transactional smoke test. Creates private, clearly named QA test records.

Uses only emikes@ais-now.com. Does not impersonate users or send messages.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import uuid

from dataverse_api import Dataverse


def main():
    d = Dataverse()

    def api(payload):
        return json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps(payload)})["Result"])

    current = api({"operation": "snapshot"})
    assert current["snapshot"]["persona"]["email"].lower() == "emikes@ais-now.com"
    checks = []

    def command(body, operation_id=None):
        nonlocal current
        payload = {"operation": "command", "revision": current["revision"], "operationId": operation_id or str(uuid.uuid4()), "command": body}
        current = api(payload)
        return payload

    def rejected(body, expected):
        before = current["revision"]
        try:
            command(body)
        except RuntimeError as error:
            assert expected.lower() in str(error).lower(), str(error)
        else:
            raise AssertionError("Expected server rejection: " + expected)
        fresh = api({"operation": "snapshot"})
        assert fresh["revision"] == before, "Rejected command committed a revision"
        checks.append(expected)

    rejected({"type": "createInventory", "kind": "event", "title": "Invalid QA date", "gameDate": ":00Z", "tickets": 1}, "real ISO timestamp")
    title = "QA API smoke " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    date = (datetime.now(timezone.utc) + timedelta(days=30)).replace(microsecond=0).isoformat()
    payload = command({"type": "createInventory", "kind": "event", "title": title, "gameDate": date, "tickets": 1})
    game_id = current["result"]["id"]
    version = current["revision"]
    replay = api(payload)
    assert replay["result"]["id"] == game_id and replay["revision"] == version
    checks.append("idempotent replay creates one event")
    assert next(g for g in current["snapshot"]["catalog"] if g["id"] == game_id)["release"] == "private"
    customer = next(c for c in current["snapshot"]["options"] if c["type"] == "customer")
    request_ids = []
    for _ in range(2):
        command({"type": "interest", "gameId": game_id, "purpose": "customer", "contactIds": [customer["id"]], "quantity": 1, "rationale": "QA concurrency test; no real ticket delivery."})
        request_ids.append(current["result"]["id"])
    game = next(g for g in current["snapshot"]["catalog"] if g["id"] == game_id)
    assert game["availableTickets"] == 1 and game["requestedTickets"] == 2
    checks.append("interest does not consume seats")
    revision = current["revision"]
    # Each thread has its own HTTP session, reusing only the already verified token.
    headers = dict(d.session.headers)

    def competing(request_id):
        import requests
        payload = {"operation": "command", "revision": revision, "operationId": str(uuid.uuid4()),
                   "command": {"type": "allocate", "requestId": request_id, "quantity": 1, "reason": "QA concurrency verification"}}
        response = requests.post("https://org5c824bd0.crm.dynamics.com/api/data/v9.2/cr9cd_TicketReview", headers=headers, json={"Payload": json.dumps(payload)}, timeout=120)
        return response.status_code, response.text

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(competing, request_ids))
    assert sum(200 <= status < 300 for status, _ in results) == 1, [(status, body[:400]) for status, body in results]
    current = api({"operation": "snapshot"})
    allocations = [a for a in current["snapshot"]["allocations"] if a["gameId"] == game_id and a["status"] != "cancelled"]
    assert len(allocations) == 1
    checks.append("competing allocations: one committed, one rejected")
    assignment_id = allocations[0]["id"]
    rejected({"type": "attendance", "assignmentId": assignment_id, "outcome": "attended", "evidence": "QA"}, "before the event")
    command({"type": "cancelAllocation", "assignmentId": assignment_id})
    game = next(g for g in current["snapshot"]["catalog"] if g["id"] == game_id)
    assert game["availableTickets"] == 1
    assert all(r["allocated"] == 0 for r in current["snapshot"]["requests"] if r["gameId"] == game_id)
    checks.append("cancellation frees inventory without auto-promotion")
    contact = next(c for c in current["snapshot"]["contacts"] if c["type"] == "employee" and c["email"].lower() == "emikes@ais-now.com")
    was_active = contact["appActive"]
    command({"type": "contactActive", "contactId": contact["id"], "active": False})
    command({"type": "syncDirectory"})
    assert not next(c for c in current["snapshot"]["contacts"] if c["id"] == contact["id"])["appActive"]
    command({"type": "contactActive", "contactId": contact["id"], "active": was_active})
    checks.append("Dataverse directory sync preserves app override")
    assert not current["snapshot"]["outbox"]
    native = d.call("GET", f"cr9cd_games({game_id})?$select=cr9cd_title,cr9cd_review_scope")
    assert native["cr9cd_title"] == title and native["cr9cd_review_scope"] == "ais-ticket-review-v1"
    checks.append("native game row persisted across separate API calls")
    print(json.dumps({"status": "PASS", "account": "emikes@ais-now.com", "checks": checks, "qaEventId": game_id,
                      "qaEventTitle": title, "revision": current["revision"], "requesterAccountTesting": "pending; no other user authenticated"}, indent=2))


if __name__ == "__main__":
    main()
