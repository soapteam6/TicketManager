"""Provision the explicit schedule-search components in AIS Development.

Default is read-only. --apply creates the job table, Dataverse connection
reference and stopped ENV-backed flow in AISTicketManager. --enable activates it.
Configure the solution-owned Claude variable first. No custom Claude connector,
extra key connection, external credential lookup or credential output is used.
"""
import argparse
import json
from pathlib import Path

import requests

from dataverse_api import Dataverse, ENVIRONMENT, ORG
from pac_service_auth import token
from schedule_search_flow import definition, FLOW_ID, FLOW_NAME, FLOW_UNIQUE_NAME, TABLE, MODEL, KEY_SCHEMA
from ticket_solution import SOLUTION

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://946e50453200eb2691603fe967a6b2.1c.environment.api.powerplatform.com"


def label(value):
    return {"@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{"Label": value, "LanguageCode": 1033}]}


def column(name, length=300, memo=False, primary=False):
    return {"@odata.type": "Microsoft.Dynamics.CRM." + ("Memo" if memo else "String") + "AttributeMetadata",
            "SchemaName": name, "DisplayName": label(name.removeprefix("cr9cd_").replace("_", " ")), "MaxLength": length,
            "RequiredLevel": {"Value": "None"}, **({"IsPrimaryName": True} if primary else {})}


class Connections:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"Authorization": "Bearer " + token("https://api.powerplatform.com"), "Accept": "application/json"})

    def call(self, method, path, body=None):
        r = self.session.request(method, ENDPOINT + "/connectivity/" + path, json=body, params={"api-version": "1", "$filter": f"environment eq '{ENVIRONMENT}'"}, timeout=90)
        if not r.ok:
            # Connection errors can echo parameter values. Never print raw bodies.
            raise RuntimeError(f"Power Platform {method} failed with HTTP {r.status_code}; response contents withheld.")
        return r.json() if r.content else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--enable", action="store_true")
    args = parser.parse_args()
    print(f"Target: {ORG}; required account emikes@ais-now.com; solution {SOLUTION}.")
    print(f"Plan: Schedule Search table, Dataverse connection reference, ENV-backed AI Import flow using {KEY_SCHEMA}.")
    if not args.apply:
        print("Read-only plan. Announce changes before --apply; add --enable to activate.")
        return
    d = Dataverse()
    def find(table, select, where):
        return d.call("GET", table, params={"$select": select, "$filter": where})["value"]
    def create(table, body):
        return d.call("POST", table, body, headers={"MSCRM.SolutionUniqueName": SOLUTION, "Prefer": "return=representation"})
    flows = find("workflows", "workflowid,name,statecode", f"workflowid eq {FLOW_ID}")
    if flows and (flows[0]["name"] != FLOW_NAME or flows[0]["statecode"] != 0):
        raise RuntimeError("The flow is active or its reserved ID is occupied. Use the guarded definition-update script for updates.")
    variables = find("environmentvariabledefinitions", "environmentvariabledefinitionid,type,defaultvalue", f"schemaname eq '{KEY_SCHEMA}'")
    if len(variables) != 1 or variables[0]["type"] not in [100000000, 100000005] or variables[0].get("defaultvalue"):
        raise RuntimeError("Configure the solution-owned Claude environment variable, without a literal default, before setup.")
    definition_id = variables[0]["environmentvariabledefinitionid"]
    mode = "secretEnvironmentVariable" if variables[0]["type"] == 100000005 else "textEnvironmentVariable"
    values = find("environmentvariablevalues", "environmentvariablevalueid", f"_environmentvariabledefinitionid_value eq {definition_id}")
    if args.enable and len(values) != 1:
        raise RuntimeError("Configure exactly one current value before enabling the flow.")
    if not d.call("GET", "EntityDefinitions", params={"$select": "MetadataId", "$filter": f"LogicalName eq '{TABLE}'"})["value"]:
        create("EntityDefinitions", {"SchemaName": TABLE, "DisplayName": label("Schedule Search"), "DisplayCollectionName": label("Schedule Searches"), "OwnershipType": "OrganizationOwned", "HasActivities": False, "HasNotes": True, "IsActivity": False,
            "Attributes": [column("cr9cd_name", primary=True), column("cr9cd_requestedby", 36), column("cr9cd_status", 30), column("cr9cd_input", 10000, memo=True), column("cr9cd_result", 1048576, memo=True), column("cr9cd_error", 2000)]})
        d.call("POST", "PublishXml", {"ParameterXml": f"<importexportxml><entities><entity>{TABLE}</entity></entities></importexportxml>"})
    metadata = d.call("GET", f"EntityDefinitions(LogicalName='{TABLE}')", params={"$select": "EntitySetName,HasNotes"})
    if not metadata["HasNotes"]:
        d.call("PUT", f"EntityDefinitions(LogicalName='{TABLE}')", {"@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata", "HasNotes": True}, headers={"MSCRM.MergeLabels": "true"})
        d.call("POST", "PublishXml", {"ParameterXml": f"<importexportxml><entities><entity>{TABLE}</entity></entities></importexportxml>"})
    all_connections = Connections().call("GET", "connections?%24expand=api").get("value", [])
    connections = [x for x in all_connections if x.get("properties", {}).get("apiId", "").endswith("/shared_commondataserviceforapps") and x.get("properties", {}).get("createdBy", {}).get("email", "").lower() == "emikes@ais-now.com" and any(v.get("status") == "Connected" for v in x.get("properties", {}).get("statuses", []))]
    if len(connections) != 1:
        raise RuntimeError("Expected one connected Dataverse connection owned by emikes@ais-now.com.")
    name = "cr9cd_ticketscheduledataverse"
    api = "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps"
    refs = find("connectionreferences", "connectionreferenceid", f"connectionreferencelogicalname eq '{name}'")
    body = {"connectionreferencelogicalname": name, "connectionreferencedisplayname": "Ticket Manager schedule dataverse", "connectorid": api, "connectionid": connections[0]["name"]}
    if refs:
        d.call("PATCH", f"connectionreferences({refs[0]['connectionreferenceid']})", body)
    else:
        create("connectionreferences", body)
    refs = {"dataverse": {"runtimeSource": "embedded", "connection": {"connectionReferenceLogicalName": name}, "api": {"name": "shared_commondataserviceforapps"}}}
    client = {"properties": {"definition": definition(metadata["EntitySetName"], credential_mode=mode), "connectionReferences": refs}, "schemaVersion": "1.0.0.0"}
    if flows:
        d.call("PATCH", f"workflows({FLOW_ID})", {"clientdata": json.dumps(client)})
    else:
        create("workflows", {"workflowid": FLOW_ID, "name": FLOW_NAME, "uniquename": FLOW_UNIQUE_NAME, "category": 5, "type": 1, "primaryentity": "none", "clientdata": json.dumps(client)})
    if args.enable:
        d.call("PATCH", f"workflows({FLOW_ID})", {"statecode": 1, "statuscode": 2})
    path = ROOT / "solutions/schedule-search.json"
    record = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    record.update({"workflowId": FLOW_ID, "name": FLOW_NAME, "jobTable": TABLE, "jobEntitySet": metadata["EntitySetName"], "model": MODEL, "solution": SOLUTION,
        "credentialSource": mode, "credentialEnvironmentVariable": KEY_SCHEMA, "credentialDefinitionId": definition_id})
    path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print("Provisioned the ENV-backed flow with the existing Dataverse connection; no key was read or copied.")


if __name__ == "__main__":
    main()
