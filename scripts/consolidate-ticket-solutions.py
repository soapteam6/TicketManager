"""Retire only the redundant unmanaged QA solution after proving component coverage.

Default is a read-only plan. --apply exports the retired solution for recovery,
then deletes its container only. Refuses managed solutions, unexpected IDs,
missing components, or loss of full-table subcomponent coverage. Does not
delete component definitions, change data/role assignments, or publish the app.
"""
import argparse
import base64
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

from dataverse_api import Dataverse, ORG
from ticket_solution import SOLUTION

ROOT = Path(__file__).resolve().parent.parent
RETIRED = "AISTicketReviewQA"
RETIRED_ID = "40fd135d-51d1-f111-a05b-6045bd0695f8"
TARGET_ID = "1c411462-63d1-f111-a05b-6045bd069cda"
WORKSPACE_ID = "f18b973a-2936-44e5-aa55-271d7424aef3"


def solution(d, name):
    rows = d.call("GET", "solutions", params={"$select": "solutionid,uniquename,ismanaged", "$filter": f"uniquename eq '{name}'"})["value"]
    if len(rows) > 1:
        raise RuntimeError("Ambiguous solution identity.")
    return rows[0] if rows else None


def components(d, sid):
    return d.call("GET", "solutioncomponents", params={"$select": "solutioncomponentid,componenttype,objectid,rootcomponentbehavior,rootsolutioncomponentid", "$filter": "_solutionid_value eq " + sid})["value"]


def coverage(source, target):
    """Full root components include their explicit source subcomponents."""
    target_keys = {(r["componenttype"], r["objectid"]): r for r in target}
    source_ids = {r["solutioncomponentid"]: r for r in source}
    uncovered = []
    for row in source:
        match = target_keys.get((row["componenttype"], row["objectid"]))
        if match:
            if row["componenttype"] == 1 and row["rootcomponentbehavior"] == 0 and match["rootcomponentbehavior"] != 0:
                uncovered.append(row)
            continue
        parent = source_ids.get(row.get("rootsolutioncomponentid"))
        full_parent = target_keys.get((parent["componenttype"], parent["objectid"])) if parent else None
        if not full_parent or full_parent["rootcomponentbehavior"] != 0:
            uncovered.append(row)
    return uncovered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    d = Dataverse()
    print(f"Verified emikes@ais-now.com; target {ORG}")
    target = solution(d, SOLUTION)
    source = solution(d, RETIRED)
    if not target or target["solutionid"] != TARGET_ID or target["ismanaged"]:
        raise RuntimeError("Expected the existing unmanaged AIS Ticket Manager solution; refusing a change.")
    if not source:
        print("Already consolidated: the retired QA solution does not exist.")
        return
    if source["solutionid"] != RETIRED_ID or source["ismanaged"]:
        raise RuntimeError("Expected only the known unmanaged QA container; refusing deletion.")
    source_rows = components(d, RETIRED_ID)
    target_rows = components(d, TARGET_ID)
    missing = coverage(source_rows, target_rows)
    if missing:
        raise RuntimeError("Target does not cover the retired solution: " + json.dumps(missing))
    print(f"All {len(source_rows)} source components are covered by {SOLUTION}, including full table subcomponents.")
    if not args.apply:
        print(f"Read-only plan: export {RETIRED}, then delete only its unmanaged solution container.")
        return
    result = d.call("POST", "ExportSolution", {"SolutionName": RETIRED, "Managed": False})
    backup = ROOT / "solutions" / (RETIRED + "_before_consolidation.zip")
    backup.parent.mkdir(exist_ok=True)
    backup.write_bytes(base64.b64decode(result["ExportSolutionFile"]))
    with zipfile.ZipFile(backup) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Retired solution export is corrupt; refusing deletion.")
        manifest = ET.fromstring(archive.read("solution.xml"))
        if manifest.findtext("./SolutionManifest/UniqueName") != RETIRED:
            raise RuntimeError("Unexpected backup solution identity; refusing deletion.")
    # Recheck identity/coverage immediately before the only destructive endpoint.
    source = solution(d, RETIRED)
    if not source or source["solutionid"] != RETIRED_ID or source["ismanaged"]:
        raise RuntimeError("The source solution changed; refusing deletion.")
    if coverage(components(d, RETIRED_ID), components(d, TARGET_ID)):
        raise RuntimeError("Source/target component coverage changed; refusing deletion.")
    before = d.call("GET", f"cr9cd_reviewworkspaces({WORKSPACE_ID})", params={"$select": "cr9cd_data,cr9cd_revision,cr9cd_lock"})
    d.call("DELETE", f"solutions({RETIRED_ID})")
    if solution(d, RETIRED) is not None:
        raise RuntimeError("The retired solution is still present; inspect the environment.")
    if coverage(source_rows, components(d, TARGET_ID)):
        raise RuntimeError("Component coverage changed after consolidation; inspect the environment.")
    after = d.call("GET", f"cr9cd_reviewworkspaces({WORKSPACE_ID})", params={"$select": "cr9cd_data,cr9cd_revision,cr9cd_lock"})
    if before != after:
        raise RuntimeError("Workspace changed during consolidation; investigate concurrent app activity.")
    audit = {"retiredSolution": RETIRED, "retiredSolutionId": RETIRED_ID, "activeSolution": SOLUTION,
             "activeSolutionId": TARGET_ID, "sourceComponentsCovered": len(source_rows), "workspaceRevision": after["cr9cd_revision"],
             "workspaceUnchanged": True, "backup": backup.name}
    (ROOT / "solutions/consolidation.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
