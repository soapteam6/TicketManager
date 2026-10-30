"""Clear only AIS Ticket Manager business data in AIS Development.

Read-only unless --apply. Requires the cached emikes identity, verifies solution
membership, backs up records locally, preserves all user/group access, and keeps
the empty workspace row required by the app. Never deletes schema or credentials.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import uuid

from dataverse_api import Dataverse, ORG, ENVIRONMENT
from schedule_search_flow import FLOW_ID
from ticket_solution import SOLUTION

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_ID = "f18b973a-2936-44e5-aa55-271d7424aef3"
TABLES = {
    "cr9cd_assignment", "cr9cd_attendancerecord", "cr9cd_contact_beneficiary",
    "cr9cd_game", "cr9cd_integrationlog", "cr9cd_notification",
    "cr9cd_notificationtemplate", "cr9cd_requestcontact", "cr9cd_reservation",
    "cr9cd_reviewworkspace", "cr9cd_schedulesearch", "cr9cd_scoringconfig",
    "cr9cd_season", "cr9cd_seat", "cr9cd_team", "cr9cd_ticketrequest", "cr9cd_waitlistentry",
}
EARLY = {"cr9cd_schedulesearch", "cr9cd_integrationlog", "cr9cd_notificationtemplate"}


def all_rows(d, entity_set, select=None, where=None):
    params = {}
    if select:
        params["$select"] = select
    if where:
        params["$filter"] = where
    result = d.call("GET", entity_set, params=params, headers={"Prefer": "odata.maxpagesize=5000"})
    rows = result["value"]
    while result.get("@odata.nextLink"):
        prefix = ORG + "/api/data/v9.2/"
        if not result["@odata.nextLink"].startswith(prefix):
            raise RuntimeError("Refusing a pagination link outside AIS Development.")
        result = d.call("GET", result["@odata.nextLink"][len(prefix):])
        rows.extend(result["value"])
    return rows


def snapshot(d):
    return json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": '{"operation":"snapshot"}'})["Result"])


def access_fingerprint(s):
    users = [{k: u[k] for k in ["id", "email", "isAppAdmin", "effectiveRole"]} |
             {k: sorted(u[k]) for k in ["directRoles", "inheritedRoles"]} for u in s["accessUsers"]]
    groups = [{k: g[k] for k in ["id", "directoryId", "membership"]} | {"roles": sorted(g["roles"])} for g in s["accessGroups"]]
    value = json.dumps({"users": sorted(users, key=lambda u: u["id"]), "groups": sorted(groups, key=lambda g: g["id"])}, sort_keys=True)
    return hashlib.sha256(value.encode()).hexdigest()


def deletion_order(metadata):
    remaining = set(TABLES) - {"cr9cd_reviewworkspace"}
    order = []
    while remaining:
        ready = sorted(t for t in remaining if not any(t in metadata[child]["parents"] for child in remaining if child != t))
        if not ready:
            raise RuntimeError("Unexpected dependency cycle; no deletion attempted.")
        order.extend(ready)
        remaining.difference_update(ready)
    return order


def operation(method, entity_set, record, key, body=None):
    record_id = str(uuid.UUID(record[key]))
    etag = record.get("@odata.etag", "")
    if not re.fullmatch(r'W/"\d+"', etag):
        raise RuntimeError("Missing concurrency protection; no unconditional deletes allowed.")
    return {"method": method, "path": f"{entity_set}({record_id})", "etag": etag, "body": body}


def changeset(d, operations):
    if not operations:
        return
    if len(operations) > 1000:
        raise RuntimeError("Refusing a changeset larger than 1000 requests.")
    batch = "batch_" + uuid.uuid4().hex
    change = "changeset_" + uuid.uuid4().hex
    lines = ["--" + batch, "Content-Type: multipart/mixed; boundary=" + change, ""]
    for index, op in enumerate(operations, 1):
        lines.extend(["--" + change, "Content-Type: application/http", "Content-Transfer-Encoding: binary", f"Content-ID: {index}", "",
                      f"{op['method']} {ORG}/api/data/v9.2/{op['path']} HTTP/1.1", "Accept: application/json", "If-Match: " + op["etag"]])
        if op["body"] is not None:
            lines.extend(["Content-Type: application/json", "", json.dumps(op["body"])])
        else:
            lines.append("")
        lines.append("")
    lines.extend(["--" + change + "--", "--" + batch + "--", ""])
    response = d.session.post(ORG + "/api/data/v9.2/$batch", data="\r\n".join(lines).encode(),
                              headers={"Content-Type": "multipart/mixed; boundary=" + batch}, timeout=120)
    if not response.ok:
        raise RuntimeError(f"Scoped cleanup batch failed with HTTP {response.status_code}; response contents withheld.")
    statuses = [int(code) for code in re.findall(r"HTTP/1.1 (\d{3})", response.text)]
    if len(statuses) != len(operations) or any(code >= 300 for code in statuses):
        codes = re.findall(r'"code"\s*:\s*"([A-Za-z0-9_.-]+)"', response.text)
        raise RuntimeError(f"Scoped changeset failed; statuses={statuses[:4]}, errorCodes={codes[:2]}. No automatic retry.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    assert ORG == "https://org5c824bd0.crm.dynamics.com" and ENVIRONMENT == "946e5045-3200-eb26-9160-3fe967a6b21c"
    d = Dataverse()
    before = snapshot(d)
    access_before = access_fingerprint(before["snapshot"])
    solution = all_rows(d, "solutions", "solutionid", f"uniquename eq '{SOLUTION}'")
    if len(solution) != 1:
        raise RuntimeError("Expected the existing AIS Ticket Manager solution.")
    components = all_rows(d, "solutioncomponents", "objectid", f"_solutionid_value eq {solution[0]['solutionid']} and componenttype eq 1")
    component_ids = {c["objectid"] for c in components}
    metadata, records = {}, {}
    for name in sorted(TABLES):
        meta = d.call("GET", f"EntityDefinitions(LogicalName='{name}')", params={"$select": "MetadataId,EntitySetName,PrimaryIdAttribute"})
        if meta["MetadataId"] not in component_ids:
            raise RuntimeError("Refusing a table outside this app's solution: " + name)
        parents = d.call("GET", f"EntityDefinitions(LogicalName='{name}')/ManyToOneRelationships", params={"$select": "ReferencedEntity"})["value"]
        metadata[name] = {"set": meta["EntitySetName"], "key": meta["PrimaryIdAttribute"], "parents": [r["ReferencedEntity"] for r in parents if r["ReferencedEntity"] in TABLES]}
        records[name] = all_rows(d, meta["EntitySetName"])
    if any(r["cr9cd_status"] in ["queued", "searching"] for r in records["cr9cd_schedulesearch"]):
        raise RuntimeError("An AI import is running. Wait for its cleanup to finish before resetting data.")
    workspace = next(r for r in records["cr9cd_reviewworkspace"] if r["cr9cd_reviewworkspaceid"] == WORKSPACE_ID)
    notes = all_rows(d, "annotations", "annotationid,objecttypecode")
    app_notes = [d.call("GET", f"annotations({r['annotationid']})") for r in notes if r.get("objecttypecode") in TABLES]
    other_note_ids = {r["annotationid"] for r in notes if r.get("objecttypecode") not in TABLES}
    counts = {name: len(rows) for name, rows in records.items()}
    print(json.dumps({"environment": "AIS Development", "authenticatedAs": "emikes@ais-now.com", "tableRows": counts,
                      "appAttachments": len(app_notes), "preservedAccessUsers": len(before["snapshot"]["accessUsers"]),
                      "preservedAccessGroups": len(before["snapshot"]["accessGroups"]), "mode": "apply" if args.apply else "read-only"}, indent=2), flush=True)
    if not args.apply:
        return
    config_spec = importlib.util.spec_from_file_location("review_setup", ROOT / "scripts/setup-dataverse-review.py")
    config_module = importlib.util.module_from_spec(config_spec)
    config_spec.loader.exec_module(config_module)
    revision = workspace["cr9cd_revision"] + 1
    reset = {"cr9cd_data": json.dumps(config_module.empty_settings()), "cr9cd_revision": revision, "cr9cd_lock": str(uuid.uuid4())}
    early, main_ops = [], [operation("PATCH", metadata["cr9cd_reviewworkspace"]["set"], workspace, "cr9cd_reviewworkspaceid", reset)]
    for table in deletion_order(metadata):
        for record in records[table]:
            (early if table in EARLY else main_ops).append(operation("DELETE", metadata[table]["set"], record, metadata[table]["key"]))
    for record in records["cr9cd_reviewworkspace"]:
        if record["cr9cd_reviewworkspaceid"] != WORKSPACE_ID:
            main_ops.append(operation("DELETE", metadata["cr9cd_reviewworkspace"]["set"], record, "cr9cd_reviewworkspaceid"))
    if len(early) > 1000 or len(main_ops) > 1000:
        raise RuntimeError("Cleanup requires a reviewed larger batch plan; nothing deleted.")
    backup = ROOT / "design-artifacts.local" / ("ticket-manager-reset-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    backup.mkdir(parents=True, exist_ok=False)
    (backup / "records.json").write_text(json.dumps({"tables": records, "appNotes": app_notes}), encoding="utf-8")
    flow_path = f"workflows({FLOW_ID})"
    flow = d.call("GET", flow_path, params={"$select": "name,statecode"})
    if flow["name"] != "Ticket Manager - AI Import":
        raise RuntimeError("Unexpected flow identity.")
    active = flow["statecode"] == 1
    try:
        if active:
            d.call("PATCH", flow_path, {"statecode": 0, "statuscode": 1}, headers={"If-Match": flow["@odata.etag"]})
        pending = all_rows(d, metadata["cr9cd_schedulesearch"]["set"], "cr9cd_schedulesearchid", "cr9cd_status eq 'queued' or cr9cd_status eq 'searching'")
        if pending:
            raise RuntimeError("A new import started before the pause; no cleanup attempted.")
        changeset(d, early)
        print(f"Cleared {len(early)} import/log/template rows; clearing business records atomically.", flush=True)
        changeset(d, main_ops)
    finally:
        if active:
            d.call("PATCH", flow_path, {"statecode": 1, "statuscode": 2})
    after_counts = {name: len(all_rows(d, meta["set"], meta["key"])) for name, meta in metadata.items()}
    if any(count != (1 if name == "cr9cd_reviewworkspace" else 0) for name, count in after_counts.items()):
        raise RuntimeError("Post-cleanup row counts are not empty; inspect before retrying.")
    remaining_notes = all_rows(d, "annotations", "annotationid,objecttypecode")
    if any(n.get("objecttypecode") in TABLES for n in remaining_notes) or {n["annotationid"] for n in remaining_notes} != other_note_ids:
        raise RuntimeError("Attachment isolation verification failed.")
    after = snapshot(d)
    restored = d.call("GET", flow_path, params={"$select": "statecode"})["statecode"] == 1
    if restored != active:
        raise RuntimeError("The AI Import activation state was not restored.")
    if access_fingerprint(after["snapshot"]) != access_before:
        raise RuntimeError("Access verification differs; no access changes were requested or performed by this script.")
    for key in ["catalog", "teams", "seasons", "contacts", "requests", "allocations"]:
        if after["snapshot"].get(key):
            raise RuntimeError("App snapshot still contains " + key)
    result = {"environment": "AIS Development", "authenticatedAs": "emikes@ais-now.com", "solution": SOLUTION,
              "rowsDeleted": sum(counts.values()) - 1, "attachmentsDeleted": len(app_notes), "beforeCounts": counts,
              "afterCounts": after_counts, "workspaceRevision": after["revision"], "accessPreserved": True,
              "accessUsers": len(after["snapshot"]["accessUsers"]), "accessGroups": len(after["snapshot"]["accessGroups"]),
              "accessFingerprint": access_before, "unrelatedAttachmentsPreserved": len(other_note_ids), "aiFlowRestored": active,
              "clearedAtUtc": datetime.now(timezone.utc).isoformat()}
    (ROOT / "solutions/data-reset.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
