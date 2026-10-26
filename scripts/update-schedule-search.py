"""Update only the existing Ticket Manager AI Import flow in AIS Development.

Read-only by default. Announce the environment change before --apply. Refuses
to interrupt recently pending search jobs; retains existing connections and ID.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from dataverse_api import Dataverse, ORG
from schedule_search_flow import definition, FLOW_ID, FLOW_NAME, KEY_SCHEMA

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--credential-source", choices=["secretEnvironmentVariable", "textEnvironmentVariable"])
    args = parser.parse_args()
    d = Dataverse()
    config = json.loads((ROOT / "solutions/schedule-search.json").read_text(encoding="utf-8"))
    assert config["workflowId"] == FLOW_ID
    path = f"workflows({FLOW_ID})"
    flow = d.call("GET", path, params={"$select": "name,statecode,category,clientdata"})
    assert flow["category"] == 5 and flow["name"] in ["Ticket Manager - Find schedule", FLOW_NAME]
    client = json.loads(flow["clientdata"])
    credential_mode = args.credential_source or config.get("credentialSource", "connection")
    definition_id = None
    if credential_mode != "connection":
        definitions = d.call("GET", "environmentvariabledefinitions", params={"$select": "environmentvariabledefinitionid,type,defaultvalue", "$filter": f"schemaname eq '{KEY_SCHEMA}'"})["value"]
        expected = 100000005 if credential_mode == "secretEnvironmentVariable" else 100000000
        if len(definitions) != 1 or definitions[0]["type"] != expected or definitions[0].get("defaultvalue"):
            raise RuntimeError("The solution variable must exist with the selected type and no literal default before switching the flow.")
        definition_id = definitions[0]["environmentvariabledefinitionid"]
        values = d.call("GET", "environmentvariablevalues", params={"$select": "environmentvariablevalueid", "$filter": f"_environmentvariabledefinitionid_value eq {definition_id}"})["value"]
        if len(values) != 1:
            raise RuntimeError("Configure exactly one environment-specific current value before switching the flow.")
    client["properties"]["definition"] = definition(config["jobEntitySet"], config["connectorApi"], credential_mode)
    if credential_mode != "connection":
        client["properties"]["connectionReferences"].pop("claude", None)
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
    if credential_mode != "connection":
        config.update({"credentialSource": credential_mode, "credentialEnvironmentVariable": KEY_SCHEMA, "credentialDefinitionId": definition_id})
    (ROOT / "solutions/schedule-search.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print("Updated the existing flow and restored its activation state. Connections and inventory unchanged.")


if __name__ == "__main__":
    main()
