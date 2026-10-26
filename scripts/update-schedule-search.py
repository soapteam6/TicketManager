"""Update only the existing Ticket Manager AI Import flow in AIS Development.

Read-only by default. Announce the environment change before --apply. Refuses
to interrupt recently pending search jobs; retains existing connections and ID.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from dataverse_api import Dataverse, ORG
from schedule_search_flow import definition, FLOW_ID, FLOW_NAME

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    d = Dataverse()
    config = json.loads((ROOT / "solutions/schedule-search.json").read_text(encoding="utf-8"))
    assert config["workflowId"] == FLOW_ID
    path = f"workflows({FLOW_ID})"
    flow = d.call("GET", path, params={"$select": "name,statecode,category,clientdata"})
    assert flow["category"] == 5 and flow["name"] in ["Ticket Manager - Find schedule", FLOW_NAME]
    client = json.loads(flow["clientdata"])
    client["properties"]["definition"] = definition(config["jobEntitySet"], config["connectorApi"])
    print(f"Verified emikes@ais-now.com; {ORG}; update only {FLOW_ID} with the AI Import prompt/date context.")
    if not args.apply:
        print("Read-only plan; use --apply after announcing the flow update.")
        return
    since = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    pending = d.call("GET", config["jobEntitySet"], params={"$select": "cr9cd_schedulesearchid", "$top": 1,
        "$filter": f"(cr9cd_status eq 'queued' or cr9cd_status eq 'searching') and createdon ge {since}"})["value"]
    if pending:
        raise RuntimeError("A search is still running. Retry this update after it finishes.")
    active = flow["statecode"] == 1
    try:
        if active:
            d.call("PATCH", path, {"statecode": 0, "statuscode": 1}, headers={"If-Match": flow["@odata.etag"]})
        d.call("PATCH", path, {"name": FLOW_NAME, "clientdata": json.dumps(client)})
        if active:
            d.call("PATCH", path, {"statecode": 1, "statuscode": 2})
    except Exception:
        d.call("PATCH", path, {"name": flow["name"], "clientdata": flow["clientdata"]})
        if active:
            d.call("PATCH", path, {"statecode": 1, "statuscode": 2})
        raise
    config["name"] = FLOW_NAME
    (ROOT / "solutions/schedule-search.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print("Updated the existing flow and restored its activation state. Connections and inventory unchanged.")


if __name__ == "__main__":
    main()
