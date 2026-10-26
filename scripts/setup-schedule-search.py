"""Provision the explicit schedule-search components in AIS Development.

Default is read-only. --apply creates the table, custom connector, encrypted
connection, connection references and stopped flow in AISTicketManager. --enable
activates that flow. Reuses only the existing AIS Anthropic credential in memory;
no credential is printed, written to the app/repo, or embedded in the flow.
"""
import argparse
import json
from pathlib import Path
import subprocess

import requests

from dataverse_api import Dataverse, ENVIRONMENT, ORG
from pac_service_auth import source_get, token
from schedule_search_flow import definition, FLOW_ID, FLOW_NAME, FLOW_UNIQUE_NAME, TABLE, MODEL
from ticket_solution import SOLUTION

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://946e50453200eb2691603fe967a6b2.1c.environment.api.powerplatform.com"
CLAUDE_CONNECTION_ID = "b65497886cbd4ec6bfdf0aa6b2cb58db"
CONNECTOR_NAME = "Ticket Manager Claude"


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


def anthropic_key():
    rows = source_get("environmentvariabledefinitions", {"$select": "defaultvalue", "$filter": "schemaname eq 'ais_TerritoryMapAnthropicApiKey'", "$expand": "environmentvariabledefinition_environmentvariablevalue($select=value)"})["value"]
    if len(rows) != 1:
        raise RuntimeError("The existing AIS Anthropic credential configuration is missing or ambiguous.")
    values = rows[0].get("environmentvariabledefinition_environmentvariablevalue", [])
    value = next((v.get("value") for v in values if v.get("value")), None) or rows[0].get("defaultvalue")
    if not value or not value.startswith("sk-ant-"):
        raise RuntimeError("The existing AIS Anthropic credential is not available.")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--enable", action="store_true")
    args = parser.parse_args()
    print(f"Target: {ORG}; required account emikes@ais-now.com; solution {SOLUTION}.")
    print("Plan: cr9cd_schedulesearch job table; Ticket Manager Claude custom connector and encrypted connection;")
    print("two connection references; Ticket Manager - Find schedule background flow with web search/fetch.")
    if not args.apply:
        print("Read-only plan. Add --apply after announcing environment changes; --enable to activate the flow.")
        return
    d = Dataverse()
    flows = d.call("GET", "workflows", params={"$select": "workflowid,name,statecode", "$filter": f"workflowid eq {FLOW_ID}"})["value"]
    if flows and (flows[0]["name"] != FLOW_NAME or flows[0]["statecode"] != 0):
        raise RuntimeError("The reserved flow is active or occupied. Inspect it before changing any search components.")
    c = Connections()
    print("Microsoft control-plane and Dataverse identity verified: emikes@ais-now.com.")

    def find(table, select, where):
        return d.call("GET", table, params={"$select": select, "$filter": where})["value"]

    def create(table, body):
        return d.call("POST", table, body, headers={"MSCRM.SolutionUniqueName": SOLUTION, "Prefer": "return=representation"})

    if not d.call("GET", "EntityDefinitions", params={"$select": "MetadataId", "$filter": f"LogicalName eq '{TABLE}'"})["value"]:
        create("EntityDefinitions", {"SchemaName": TABLE, "DisplayName": label("Schedule Search"), "DisplayCollectionName": label("Schedule Searches"), "OwnershipType": "OrganizationOwned", "HasActivities": False, "HasNotes": False, "IsActivity": False,
            "Attributes": [column("cr9cd_name", primary=True), column("cr9cd_requestedby", 36), column("cr9cd_status", 30), column("cr9cd_input", 10000, memo=True), column("cr9cd_result", 1048576, memo=True), column("cr9cd_error", 2000)]})
        d.call("POST", "PublishXml", {"ParameterXml": f"<importexportxml><entities><entity>{TABLE}</entity></entities></importexportxml>"})
        print("Created/published only the Schedule Search table.")
    metadata = d.call("GET", f"EntityDefinitions(LogicalName='{TABLE}')", params={"$select": "MetadataId,EntitySetName"})
    connectors = find("connectors", "connectorid,connectorinternalid,displayname,name", f"displayname eq '{CONNECTOR_NAME}'")
    if not connectors:
        result = subprocess.run(["pac", "connector", "create", "--environment", ORG, "--solution-unique-name", SOLUTION,
            "--api-definition-file", str(ROOT / "flows/schedule-search/claude.swagger.json"), "--api-properties-file", str(ROOT / "flows/schedule-search/claude.properties.json")], capture_output=True, text=True, cwd=ROOT)
        if result.returncode:
            raise RuntimeError("Custom connector creation failed: " + result.stdout[-2500:] + result.stderr[-1000:])
        connectors = find("connectors", "connectorid,connectorinternalid,displayname,name", f"displayname eq '{CONNECTOR_NAME}'")
        print("Created Ticket Manager Claude connector in the solution.")
    if len(connectors) != 1:
        raise RuntimeError("The Ticket Manager Claude connector is missing or ambiguous.")
    connector = connectors[0]
    connector_id = connector["connectorinternalid"].split("/")[-1]
    connector_api = "/providers/Microsoft.PowerApps/apis/" + connector_id
    all_connections = c.call("GET", "connections?%24expand=api").get("value", [])
    dv_connections = [x for x in all_connections if x.get("properties", {}).get("apiId", "").endswith("/shared_commondataserviceforapps") and x.get("properties", {}).get("createdBy", {}).get("email", "").lower() == "emikes@ais-now.com" and any(s.get("status") == "Connected" for s in x.get("properties", {}).get("statuses", []))]
    if len(dv_connections) != 1:
        raise RuntimeError("Expected one connected Dataverse connection owned by emikes@ais-now.com.")
    current = [x for x in all_connections if x.get("name") == CLAUDE_CONNECTION_ID]
    if not current:
        key = anthropic_key()
        models = requests.get("https://api.anthropic.com/v1/models", headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=45)
        if not models.ok or MODEL not in [m["id"] for m in models.json().get("data", [])]:
            raise RuntimeError("The configured Claude model is unavailable to the existing API credential.")
        # API key supplied in memory directly to Microsoft's encrypted connection store.
        current = [c.call("PUT", f"connectors/{connector_id}/connections/{CLAUDE_CONNECTION_ID}", {"properties": {
            "displayName": "Ticket Manager Claude (emikes)", "connectionParameters": {"api_key": key}, "environment": {"name": ENVIRONMENT}
        }})]
        del key
        print("Created the server-side Claude connection; no credentials written to source or flow definition.")

    refs = {}
    for alias, logical_name, api, connection in [
        ("dataverse", "cr9cd_ticketscheduledataverse", "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps", dv_connections[0]["name"]),
        ("claude", "cr9cd_ticketscheduleclaude", connector_api, CLAUDE_CONNECTION_ID),
    ]:
        existing = find("connectionreferences", "connectionreferenceid,connectionreferencelogicalname", f"connectionreferencelogicalname eq '{logical_name}'")
        body = {"connectionreferencelogicalname": logical_name, "connectionreferencedisplayname": "Ticket Manager schedule " + alias, "connectorid": api, "connectionid": connection}
        if existing:
            d.call("PATCH", f"connectionreferences({existing[0]['connectionreferenceid']})", body)
        else:
            create("connectionreferences", body)
        refs[alias] = {"runtimeSource": "embedded", "connection": {"connectionReferenceLogicalName": logical_name}, "api": {"name": api.split("/")[-1]}}
    clientdata = {"properties": {"definition": definition(metadata["EntitySetName"], connector_api), "connectionReferences": refs}, "schemaVersion": "1.0.0.0"}
    flows = find("workflows", "workflowid,name,statecode,resourceid", f"workflowid eq {FLOW_ID}")
    if flows:
        if flows[0]["name"] != FLOW_NAME:
            raise RuntimeError("The reserved workflow ID is occupied by another flow.")
        if flows[0]["statecode"] != 0:
            raise RuntimeError("The flow is already active. Inspect it before updating its definition.")
        d.call("PATCH", f"workflows({FLOW_ID})", {"clientdata": json.dumps(clientdata)})
    else:
        create("workflows", {"workflowid": FLOW_ID, "name": FLOW_NAME, "uniquename": FLOW_UNIQUE_NAME, "category": 5, "type": 1, "primaryentity": "none", "clientdata": json.dumps(clientdata)})
    print("Created/updated the stopped schedule-search flow.")
    if args.enable:
        d.call("PATCH", f"workflows({FLOW_ID})", {"statecode": 1, "statuscode": 2})
        print("Enabled schedule search.")
    record = {"workflowId": FLOW_ID, "name": FLOW_NAME, "connectorId": connector["connectorid"], "connectorApi": connector_api, "claudeConnectionId": CLAUDE_CONNECTION_ID, "jobTable": TABLE, "jobEntitySet": metadata["EntitySetName"], "model": MODEL, "solution": SOLUTION}
    (ROOT / "solutions/schedule-search.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
