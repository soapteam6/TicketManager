"""Prepare the solution-owned Claude environment variable in AIS Development.

Read-only by default. --storage text explicitly selects Dataverse-readable Text
storage; --apply migrates the existing credential in memory to a CURRENT value,
never a default. Secret storage creates only a Secret definition: its Key Vault
reference must be configured before switching the live flow. Does not update the
flow or alter the existing source credential/connection.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import uuid

from dataverse_api import Dataverse, ORG
from schedule_search_flow import KEY_SCHEMA
from ticket_solution import SOLUTION

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage", required=True, choices=["text", "secret"])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    kind = 100000000 if args.storage == "text" else 100000005
    d = Dataverse()
    rows = d.call("GET", "environmentvariabledefinitions", params={"$select": "environmentvariabledefinitionid,type,defaultvalue", "$filter": f"schemaname eq '{KEY_SCHEMA}'"})["value"]
    if len(rows) > 1 or rows and rows[0]["type"] != kind:
        raise RuntimeError("The environment variable already exists with an incompatible or ambiguous type.")
    if rows and rows[0].get("defaultvalue"):
        raise RuntimeError("A default value already exists. Remove it deliberately before configuring this credential.")
    print(f"Verified emikes@ais-now.com; {ORG}; {SOLUTION}; {KEY_SCHEMA}; storage={args.storage}.")
    if not args.apply:
        print("Read-only plan. Announce the selected storage and environment changes before --apply.")
        return

    def write(method, path, body, headers=None):
        # Error bodies can echo credentials. Do not pass secret writes through
        # the general-purpose error reporter or print response JSON.
        response = d.session.request(method, ORG + "/api/data/v9.2/" + path, json=body, headers=headers or {}, timeout=90)
        if not response.ok:
            raise RuntimeError(f"Credential configuration {method} failed with HTTP {response.status_code}; contents withheld.")
        return response.json() if response.content else None

    if rows:
        definition_id = rows[0]["environmentvariabledefinitionid"]
    else:
        definition_id = str(uuid.uuid4())
        write("POST", "environmentvariabledefinitions", {"environmentvariabledefinitionid": definition_id,
            "schemaname": KEY_SCHEMA, "displayname": "Ticket Manager Anthropic API key", "type": kind,
            "description": "Server-side Claude credential. Never include a literal default or the current key value in solution exports.",
            **({"secretstore": 0} if args.storage == "secret" else {})}, {"MSCRM.SolutionUniqueName": SOLUTION})
    values = d.call("GET", "environmentvariablevalues", params={"$select": "environmentvariablevalueid", "$filter": f"_environmentvariabledefinitionid_value eq {definition_id}"})["value"]
    if len(values) > 1:
        raise RuntimeError("Multiple current values exist. Resolve the ambiguity before changing the credential.")
    if args.storage == "text" and not values:
        spec = importlib.util.spec_from_file_location("schedule_setup", ROOT / "scripts/setup-schedule-search.py")
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        key = setup.anthropic_key()
        value_id = str(uuid.uuid4())
        # Deliberately outside AISTicketManager. The definition is portable; the
        # current credential is environment-specific and excluded from the ZIP.
        write("POST", "environmentvariablevalues", {"environmentvariablevalueid": value_id,
            "EnvironmentVariableDefinitionId@odata.bind": f"/environmentvariabledefinitions({definition_id})", "value": key})
        del key
        values = [{"environmentvariablevalueid": value_id}]
    solution_id = d.call("GET", "solutions", params={"$select": "solutionid", "$filter": f"uniquename eq '{SOLUTION}'"})["value"][0]["solutionid"]
    for value in values:
        vid = value["environmentvariablevalueid"]
        members = d.call("GET", "solutioncomponents", params={"$select": "solutioncomponentid", "$filter": f"_solutionid_value eq {solution_id} and componenttype eq 381 and objectid eq {vid}"})["value"]
        if members:
            d.call("POST", "RemoveSolutionComponent", {"SolutionUniqueName": SOLUTION, "ComponentId": vid, "ComponentType": 381})
    d.call("POST", "AddSolutionComponent", {"ComponentId": definition_id, "ComponentType": 380, "SolutionUniqueName": SOLUTION,
        "AddRequiredComponents": False, "DoNotIncludeSubcomponents": True})
    record = {"schemaName": KEY_SCHEMA, "definitionId": definition_id, "storage": args.storage,
        "credentialSource": "textEnvironmentVariable" if args.storage == "text" else "secretEnvironmentVariable",
        "currentValueConfigured": bool(values), "currentValueIncludedInSolution": False, "literalDefaultConfigured": False}
    (ROOT / "solutions/claude-environment.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2))
    print("Live flow unchanged. Configure Key Vault first for Secret storage; then select the credential source and update the flow.")


if __name__ == "__main__":
    main()
