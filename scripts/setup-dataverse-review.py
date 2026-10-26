"""Provision isolated native-table QA in AIS Development using the PAC account.

Default is a read-only plan. --apply creates the listed components. --seed adds
fixtures once, refusing an occupied workspace. No app publication or role grants.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import uuid

from dataverse_api import Dataverse, ORG
from ticket_solution import SOLUTION, SOLUTION_DISPLAY_NAME, SOLUTION_VERSION

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_ID = "f18b973a-2936-44e5-aa55-271d7424aef3"
TABLES = ["cr9cd_team", "cr9cd_season", "cr9cd_game", "cr9cd_seat",
          "cr9cd_contact_beneficiary", "cr9cd_ticketrequest", "cr9cd_assignment"]


def label(text):
    return {"@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{"Label": text, "LanguageCode": 1033}]}


def column(name, kind="String", length=100, primary=False):
    data = {"@odata.type": f"Microsoft.Dynamics.CRM.{kind}AttributeMetadata",
            "SchemaName": name, "DisplayName": label(name.replace("cr9cd_", "").replace("_", " ")),
            "RequiredLevel": {"Value": "None"}}
    if kind in ("String", "Memo"):
        data["MaxLength"] = length
        data["FormatName" if kind == "String" else "Format"] = {"Value": "Text"} if kind == "String" else "TextArea"
    if primary:
        data["IsPrimaryName"] = True
    if kind == "Integer":
        data.update({"MinValue": 0, "MaxValue": 2147483647, "Format": "None"})
    return data


def empty_settings():
    return {"attendanceHistory": [], "outbox": [], "receipts": {},
            "followup": {"enabled": False, "subject": "How was the event?", "body": "Please confirm attendance. Photos are optional; no reply leaves attendance unknown."},
            "scoring": {"weights": {"strategicValue": .35, "attendanceRate": 0, "reliability": .15,
                                    "salesOpportunity": .25, "fairness": .25, "employeeCustomerBalance": 0,
                                    "leadTime": 0, "premiumDemandBalance": 0},
                        "category": {"customer": .8, "prospect": .7, "employee": .2}}}


def fixture_state():
    # The fixture file has only type imports; transpile it without installing a runner.
    js = """const fs=require('node:fs'); const ts=require('typescript');
    const source=fs.readFileSync('src/review/fixtures.ts','utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64')).then(m=>process.stdout.write(JSON.stringify(m.createFixtures())));
    """
    state = json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT, text=True, encoding="utf-8"))
    mapping = {row["id"]: str(uuid.uuid5(uuid.UUID(WORKSPACE_ID), row["id"]))
               for key in ["teams", "seasons", "games", "seats", "contacts", "requests", "allocations"] for row in state[key]}

    def remap(item):
        if isinstance(item, str):
            return mapping.get(item, item)
        if isinstance(item, list):
            return [remap(x) for x in item]
        if isinstance(item, dict):
            return {k: remap(v) for k, v in item.items()}
        return item
    return remap(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--plugin-only", action="store_true")
    args = parser.parse_args()
    print(f"Target: {ORG}; required account: emikes@ais-now.com")
    if args.plugin_only:
        print("Plan: upload the signed TicketReview sandbox assembly and verify a snapshot; no table, role or fixture changes.")
    else:
        print(f"Plan: solution {SOLUTION}; cr9cd_review_scope + cr9cd_review_data on seven ticket tables;")
        print("new cr9cd_reviewworkspace table; TicketReview sandbox assembly; cr9cd_TicketReview Custom API;")
        print("three Ticket Manager roles (no assignments); one QA settings row; optional one-time fixtures.")
    if not args.apply:
        print("Read-only plan. Add --apply to provision; --seed to create fixtures once.")
        return
    dll = ROOT / "plugins/TicketReview/bin/Release/net462/TicketReview.dll"
    if not dll.exists():
        raise RuntimeError("Build plugins/TicketReview/TicketReview.csproj first.")
    d = Dataverse()  # Verifies the actual Dataverse domain user, not just the cache name.
    print("Authenticated Dataverse account verified: emikes@ais-now.com")

    def find(entity_set, field, value):
        return d.call("GET", f"{entity_set}?$filter={field} eq '{value}'")["value"]

    def create(entity_set, body):
        return d.call("POST", entity_set, body, headers={"MSCRM.SolutionUniqueName": SOLUTION, "Prefer": "return=representation"})

    if not args.plugin_only:
        if not find("solutions", "uniquename", SOLUTION):
            publishers = find("publishers", "customizationprefix", "cr9cd")
            if not publishers:
                raise RuntimeError("Existing cr9cd publisher not found; refusing a different prefix.")
            d.call("POST", "solutions", {"uniquename": SOLUTION, "friendlyname": SOLUTION_DISPLAY_NAME, "version": SOLUTION_VERSION,
                   "publisherid@odata.bind": f"/publishers({publishers[0]['publisherid']})"})
            print(f"Created {SOLUTION_DISPLAY_NAME} solution.")
        for table in TABLES:
            existing = d.call("GET", f"EntityDefinitions(LogicalName='{table}')/Attributes?$select=LogicalName")["value"]
            names = {a["LogicalName"] for a in existing}
            for definition in [column("cr9cd_review_scope"), column("cr9cd_review_data", "Memo", 100000)]:
                if definition["SchemaName"] not in names:
                    create(f"EntityDefinitions(LogicalName='{table}')/Attributes", definition)
                    print(f"Added {table}.{definition['SchemaName']}")
        entities = d.call("GET", "EntityDefinitions?$select=LogicalName&$filter=LogicalName eq 'cr9cd_reviewworkspace'")["value"]
        if not entities:
            create("EntityDefinitions", {"SchemaName": "cr9cd_reviewworkspace", "DisplayName": label("Ticket Review QA Workspace"),
                   "DisplayCollectionName": label("Ticket Review QA Workspaces"), "OwnershipType": "OrganizationOwned",
                   "HasActivities": False, "HasNotes": False, "IsActivity": False,
                   "Attributes": [column("cr9cd_name", length=200, primary=True), column("cr9cd_data", "Memo", 1048576),
                                  column("cr9cd_revision", "Integer"), column("cr9cd_lock")]})
            print("Created QA workspace table.")
        # Explicit opt-in to optimistic concurrency for the workspace lock.
        d.call("PUT", "EntityDefinitions(LogicalName='cr9cd_reviewworkspace')", {"@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata", "IsOptimisticConcurrencyEnabled": True}, headers={"MSCRM.MergeLabels": "true"})
        bu = d.call("GET", "WhoAmI")["BusinessUnitId"]
        for name in ["Ticket Manager Coordinator", "Ticket Manager Representative", "Ticket Manager Employee"]:
            if not find("roles", "name", name):
                create("roles", {"name": name, "businessunitid@odata.bind": f"/businessunits({bu})"})
                print(f"Created empty role: {name}; assigned to nobody.")
        meta = d.call("GET", "EntityDefinitions(LogicalName='cr9cd_reviewworkspace')?$select=EntitySetName")
        workspace_set = meta["EntitySetName"]
        if not d.call("GET", f"{workspace_set}?$filter=cr9cd_reviewworkspaceid eq {WORKSPACE_ID}")["value"]:
            create(workspace_set, {"cr9cd_reviewworkspaceid": WORKSPACE_ID, "cr9cd_name": "AIS Ticket Review QA v1",
                                  "cr9cd_data": json.dumps(empty_settings()), "cr9cd_revision": 0, "cr9cd_lock": "initial"})
            print("Created empty QA settings row.")

    assemblies = find("pluginassemblies", "name", "TicketReview")
    content = base64.b64encode(dll.read_bytes()).decode()
    if assemblies:
        assembly_id = assemblies[0]["pluginassemblyid"]
        d.call("PATCH", f"pluginassemblies({assembly_id})", {"content": content})
        print("Updated TicketReview sandbox assembly.")
    else:
        assembly_id = create("pluginassemblies", {"name": "TicketReview", "content": content, "isolationmode": 2, "sourcetype": 0})["pluginassemblyid"]
        print("Registered TicketReview sandbox assembly.")
    types = find("plugintypes", "typename", "Ais.TicketReview.ReviewApi")
    if types:
        type_id = types[0]["plugintypeid"]
    else:
        type_id = create("plugintypes", {"typename": "Ais.TicketReview.ReviewApi", "name": "Ais.TicketReview.ReviewApi", "friendlyname": "AIS Ticket Review QA API",
                         "pluginassemblyid@odata.bind": f"/pluginassemblies({assembly_id})"})["plugintypeid"]
    apis = find("customapis", "uniquename", "cr9cd_TicketReview")
    if not apis:
        api_id = create("customapis", {"uniquename": "cr9cd_TicketReview", "name": "Ticket Review QA", "displayname": "Ticket Review QA", "description": "Transactional, role-authorized Ticket Manager QA workspace.",
                        "bindingtype": 0, "isfunction": False, "isprivate": False, "allowedcustomprocessingsteptype": 0,
                        "executeprivilegename": "prvReadOrganization", "PluginTypeId@odata.bind": f"/plugintypes({type_id})",
                        "CustomAPIRequestParameters": [{"uniquename": "Payload", "name": "cr9cd_TicketReview.Payload", "displayname": "Payload", "description": "JSON operation and expected workspace revision.", "type": 10, "isoptional": False}],
                        "CustomAPIResponseProperties": [{"uniquename": "Result", "name": "cr9cd_TicketReview.Result", "displayname": "Result", "description": "JSON server-authorized snapshot and result.", "type": 10}]})["customapiid"]
        print("Created Custom API with string Payload/Result contract.")
    # Publish only the QA metadata, not all pending environment customizations.
    if not args.plugin_only:
        names = "".join(f"<entity>{t}</entity>" for t in TABLES + ["cr9cd_reviewworkspace"])
        d.call("POST", "PublishXml", {"ParameterXml": f"<importexportxml><entities>{names}</entities></importexportxml>"})
        print("Published only QA table metadata.")
    result = json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps({"operation": "snapshot"})})["Result"])
    if args.seed:
        if result["snapshot"]["catalog"]:
            print("QA inventory already exists; seed skipped, existing data retained.")
        else:
            payload = {"operation": "seed", "operationId": str(uuid.uuid4()), "revision": result["revision"], "state": fixture_state()}
            result = json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps(payload)})["Result"])
            print("Seeded native QA records; actual Dataverse users supply employee options.")
    print(json.dumps({"status": "API_READY", "revision": result["revision"], "caller": result["snapshot"]["persona"],
                      "inventory": len(result["snapshot"]["catalog"]), "contacts": len(result["snapshot"].get("contacts", []))}, indent=2))


if __name__ == "__main__":
    main()
