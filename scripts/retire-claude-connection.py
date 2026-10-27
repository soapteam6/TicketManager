"""Retire only Ticket Manager's obsolete Claude connection after ENV migration.

Read-only by default. --apply requires an enabled ENV-backed flow, a completed
live test, exact resource ownership/IDs and no other active flow dependencies.
"""
import argparse
import importlib.util
import json
from pathlib import Path

from dataverse_api import Dataverse

ROOT = Path(__file__).resolve().parent.parent
OLD_CONNECTOR = "b811dfc7-70d1-f111-a05b-6045bd069cda"
OLD_CONNECTION = "b65497886cbd4ec6bfdf0aa6b2cb58db"
OLD_REFERENCE = "cr9cd_ticketscheduleclaude"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    path = ROOT / "solutions/schedule-search.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("retiredClaudeResources"):
        print("The old Claude resources are already retired.")
        return
    assert config["connectorId"] == OLD_CONNECTOR and config["claudeConnectionId"] == OLD_CONNECTION
    assert config["credentialSource"] == "textEnvironmentVariable"
    d = Dataverse()
    flow = d.call("GET", f"workflows({config['workflowId']})", params={"$select": "statecode,clientdata"})
    client = json.loads(flow["clientdata"])
    assert flow["statecode"] == 1 and "claude" not in client["properties"]["connectionReferences"]
    assert OLD_CONNECTION not in flow["clientdata"] and config["connectorApi"] not in flow["clientdata"]
    test = json.loads((ROOT / "solutions/claude-environment-test.json").read_text(encoding="utf-8"))
    job = d.call("GET", f"{config['jobEntitySet']}({test['jobId']})", params={"$select": "cr9cd_status"})
    assert test["status"] == "complete" and job["cr9cd_status"] == "complete" and test["inventoryImported"] == 0
    active = d.call("GET", "workflows", params={"$select": "workflowid", "$filter": f"category eq 5 and statecode eq 1 and contains(clientdata,'{OLD_REFERENCE}')"})["value"]
    assert not active, "Another active flow uses the old reference."
    refs = d.call("GET", "connectionreferences", params={"$select": "connectionreferenceid,_customconnectorid_value", "$filter": f"connectionreferencelogicalname eq '{OLD_REFERENCE}'"})["value"]
    assert len(refs) == 1 and refs[0]["_customconnectorid_value"] == OLD_CONNECTOR
    ref_id = refs[0]["connectionreferenceid"]
    assert not d.call("GET", f"RetrieveDependenciesForDelete(ObjectId={ref_id},ComponentType=10083)")["value"], "Old reference still has dependencies."
    dependencies = d.call("GET", f"RetrieveDependenciesForDelete(ObjectId={OLD_CONNECTOR},ComponentType=372)")["value"]
    assert all(r["dependentcomponentobjectid"] == ref_id for r in dependencies), "Connector has other dependants."
    spec = importlib.util.spec_from_file_location("schedule_setup", ROOT / "scripts/setup-schedule-search.py")
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    control = setup.Connections()
    connections = control.call("GET", "connections?%24expand=api").get("value", [])
    old = [c for c in connections if c["name"] == OLD_CONNECTION]
    assert len(old) == 1
    assert old[0]["properties"]["createdBy"]["email"].lower() == "emikes@ais-now.com"
    assert old[0]["properties"]["apiId"] == config["connectorApi"]
    print("Verified emikes ownership, completed ENV-backed search, masked live flow and no other dependencies.")
    if not args.apply:
        print("Read-only plan: remove only the obsolete Claude reference, connection and connector. Announce before --apply.")
        return
    d.call("DELETE", f"connectionreferences({ref_id})", headers={"If-Match": refs[0]["@odata.etag"]})
    assert not d.call("GET", f"RetrieveDependenciesForDelete(ObjectId={OLD_CONNECTOR},ComponentType=372)")["value"]
    control.call("DELETE", f"connectors/{config['connectorApi'].split('/')[-1]}/connections/{OLD_CONNECTION}")
    d.call("DELETE", f"connectors({OLD_CONNECTOR})")
    assert not d.call("GET", "connectors", params={"$select": "connectorid", "$filter": f"connectorid eq {OLD_CONNECTOR}"})["value"]
    assert not any(c["name"] == OLD_CONNECTION for c in control.call("GET", "connections?%24expand=api").get("value", []))
    config["retiredClaudeResources"] = {"connectorId": OLD_CONNECTOR, "connectionId": OLD_CONNECTION,
        "reference": OLD_REFERENCE, "connectionDeleted": True, "connectorDeleted": True, "referenceDeleted": True}
    for key in ["connectorId", "connectorApi", "claudeConnectionId"]:
        config.pop(key)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print("Retired the obsolete Claude connection, connector and reference. ENV-backed flow remains active.")


if __name__ == "__main__":
    main()
