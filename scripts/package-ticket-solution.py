"""Collect the Ticket Manager app and backend in one unmanaged development solution.

Defaults to a read-only plan. --apply changes solution membership and supplies the
three app roles with the Custom API's read-organization prerequisite. --export
exports the existing solution to ignored local ZIPs. No user role assignments,
fixture writes, table publication, or code-app publication occur here.
"""
import argparse
import base64
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

from dataverse_api import Dataverse, ORG
from ticket_solution import SOLUTION, SOLUTION_DISPLAY_NAME, SOLUTION_VERSION

ROOT = Path(__file__).resolve().parent.parent
ROLE_NAMES = ["Ticket Manager Coordinator", "Ticket Manager Representative", "Ticket Manager Employee"]


def find(d, table, select, where):
    return d.call("GET", table, params={"$select": select, "$filter": where})["value"]


def plan(d):
    config = json.loads((ROOT / "power.config.json").read_text(encoding="utf-8"))
    names = {source["logicalName"] for db in config["databaseReferences"].values()
             for source in db["dataSources"].values() if source["logicalName"].startswith("cr9cd_")}
    names.add("cr9cd_reviewworkspace")
    components = []
    for name in sorted(names):
        table = d.call("GET", f"EntityDefinitions(LogicalName='{name}')", params={"$select": "MetadataId,LogicalName"})
        components.append({"name": name, "id": table["MetadataId"], "type": 1})
    roles = find(d, "roles", "roleid,name,_parentrootroleid_value", " or ".join(f"name eq '{name}'" for name in ROLE_NAMES))
    roles = [r for r in roles if r.get("_parentrootroleid_value", r["roleid"]) == r["roleid"]]
    for name in ROLE_NAMES:
        matches = [r for r in roles if r["name"] == name]
        if len(matches) != 1:
            raise RuntimeError(f"Expected one root role named {name}; found {len(matches)}.")
        components.append({"name": name, "id": matches[0]["roleid"], "type": 20})
    # Preserve the pre-review app's role definition in the same authoring solution.
    # It is not one of the three role families managed by the application.
    legacy = find(d, "roles", "roleid,name,_parentrootroleid_value", "name eq 'Ticket Manager User'")
    legacy = [r for r in legacy if r.get("_parentrootroleid_value", r["roleid"]) == r["roleid"]]
    if len(legacy) > 1:
        raise RuntimeError("The legacy Ticket Manager User role is ambiguous.")
    components.extend({"name": r["name"], "id": r["roleid"], "type": 20} for r in legacy)
    for table, select, where, kind, label in [
        ("pluginassemblies", "pluginassemblyid,name", "name eq 'TicketReview'", 91, "TicketReview assembly"),
        ("customapis", "customapiid,uniquename", "uniquename eq 'cr9cd_TicketReview'", 10026, "cr9cd_TicketReview API"),
        ("canvasapps", "canvasappid,displayname", "canvasappid eq " + config["appId"], 300, "AIS Ticket Concierge code app"),
    ]:
        rows = find(d, table, select, where)
        if len(rows) != 1:
            raise RuntimeError(f"Expected one {label}; found {len(rows)}.")
        components.append({"name": label, "id": rows[0][select.split(',')[0]], "type": kind})
    return components, roles


def inspect_zip(path):
    with zipfile.ZipFile(path) as archive:
        solution = ET.fromstring(archive.read("solution.xml"))
        roots = solution.findall("./SolutionManifest/RootComponents/RootComponent")
        missing = solution.findall("./SolutionManifest/MissingDependencies/MissingDependency")
        summary = {
            "file": path.name, "bytes": path.stat().st_size,
            "rootComponents": [dict(r.attrib) for r in roots],
            "missingDependencies": [ET.tostring(r, encoding="unicode") for r in missing],
            "files": archive.namelist(),
        }
        (path.with_suffix(".manifest.json")).write_text(json.dumps(summary, indent=2), encoding="utf-8")
        types = {int(r.attrib["type"]) for r in roots}
        # Custom APIs export as separate XML files rather than RootComponents entries.
        if not {1, 20, 91, 300}.issubset(types):
            raise RuntimeError(f"Export is missing expected root component types: {types}")
        for required in ["customapis/cr9cd_TicketReview/customapi.xml",
                         "customapis/cr9cd_TicketReview/customapirequestparameters/Payload/customapirequestparameter.xml",
                         "customapis/cr9cd_TicketReview/customapiresponseproperties/Result/customapiresponseproperty.xml"]:
            if required not in archive.namelist():
                raise RuntimeError("Export is missing " + required)
        if not any(f.startswith("PluginAssemblies/") and f.endswith("/TicketReview.dll") for f in archive.namelist()):
            raise RuntimeError("Export is missing the plug-in binary.")
        if not any(f.startswith("CanvasApps/") and f.endswith("/index.html") for f in archive.namelist()):
            raise RuntimeError("Export is missing the code app package.")
        print(f"Inspected {path.name}: {len(roots)} root components; {len(missing)} dependency declarations; {path.stat().st_size} bytes.")
        if missing:
            print("Dependency declarations recorded in the manifest; inspect these before importing into another environment.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--export", action="store_true")
    args = parser.parse_args()
    d = Dataverse()
    print(f"Verified emikes@ais-now.com; target {ORG}")
    components, roles = plan(d)
    print(f"Solution: {SOLUTION}; {len(components)} explicit components (full custom tables, {sum(c['type'] == 20 for c in components)} roles, assembly, API, existing app).")
    for c in components:
        print(f"  {c['type']}: {c['name']}")
    existing = find(d, "solutions", "solutionid,version,ismanaged", f"uniquename eq '{SOLUTION}'")
    if existing and existing[0]["ismanaged"]:
        raise RuntimeError("Refusing to modify a managed solution.")
    if args.apply:
        if not existing:
            publisher = find(d, "publishers", "publisherid", "customizationprefix eq 'cr9cd'")
            if len(publisher) != 1:
                raise RuntimeError("Expected the existing cr9cd publisher.")
            d.call("POST", "solutions", {"uniquename": SOLUTION, "friendlyname": SOLUTION_DISPLAY_NAME, "version": SOLUTION_VERSION,
                   "description": "Ticket Manager code app, transactional API, native tables and app security roles.",
                   "publisherid@odata.bind": f"/publishers({publisher[0]['publisherid']})"})
            existing = find(d, "solutions", "solutionid,version,ismanaged", f"uniquename eq '{SOLUTION}'")
            print("Created AIS Ticket Manager solution.")
        privilege = find(d, "privileges", "privilegeid", "name eq 'prvReadOrganization'")[0]["privilegeid"]
        for role in roles:
            current = d.call("GET", f"RetrieveRolePrivilegesRole(RoleId={role['roleid']})")["RolePrivileges"]
            if not any(p["PrivilegeId"] == privilege for p in current):
                d.call("POST", f"roles({role['roleid']})/Microsoft.Dynamics.CRM.AddPrivilegesRole",
                       {"Privileges": [{"PrivilegeId": privilege, "Depth": "Global"}]})
                print(f"Added only the API execution prerequisite to {role['name']}.")
        members = d.call("GET", "solutioncomponents", params={"$select": "componenttype,objectid,rootcomponentbehavior", "$filter": "_solutionid_value eq " + existing[0]["solutionid"]})["value"]
        included = {(m["componenttype"], m["objectid"]): m for m in members}
        unchanged = 0
        for component in components:
            current = included.get((component["type"], component["id"]))
            if current and current["rootcomponentbehavior"] == 0:
                unchanged += 1
                continue
            d.call("POST", "AddSolutionComponent", {
                "ComponentId": component["id"], "ComponentType": component["type"], "SolutionUniqueName": SOLUTION,
                "AddRequiredComponents": True, "DoNotIncludeSubcomponents": False,
            })
            print("Included " + component["name"])
        print(f"{unchanged} existing full components retained without a membership update.")
    if not existing:
        print("Read-only plan complete; solution does not exist yet.")
        return
    sid = existing[0]["solutionid"]
    print(f"Solution link: https://make.powerapps.com/environments/946e5045-3200-eb26-9160-3fe967a6b21c/solutions/{sid}/overview")
    if args.export:
        folder = ROOT / "solutions"
        folder.mkdir(exist_ok=True)
        for managed in [False, True]:
            result = d.call("POST", "ExportSolution", {"SolutionName": SOLUTION, "Managed": managed, "ExportAutoNumberingSettings": False,
                            "ExportCalendarSettings": False, "ExportCustomizationSettings": False, "ExportEmailTrackingSettings": False,
                            "ExportGeneralSettings": False, "ExportMarketingSettings": False, "ExportOutlookSynchronizationSettings": False,
                            "ExportRelationshipRoles": False, "ExportIsvConfig": False, "ExportSales": False, "ExportExternalApplications": False})
            path = folder / (SOLUTION + ("_managed" if managed else "_unmanaged") + ".zip")
            path.write_bytes(base64.b64decode(result["ExportSolutionFile"]))
            inspect_zip(path)


if __name__ == "__main__":
    main()
