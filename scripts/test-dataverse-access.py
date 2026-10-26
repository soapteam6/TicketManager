"""Read-only checks of deployed app-admin projection and the packaged solution.

Uses only the cached emikes@ais-now.com PAC identity. Does not grant roles,
impersonate users, change workspace rows, or publish the app.
"""
import json
from pathlib import Path

from dataverse_api import Dataverse
from ticket_solution import SOLUTION

ADMINS = {"emikes@ais-now.com", "jjackson@ais-now.com", "aharouff@ais-now.com"}
APP_ID = "1323f8ca-47e5-402e-9657-45f8651af4dc"


def main():
    d = Dataverse()
    response = json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps({"operation": "snapshot"})})["Result"])
    snapshot = response["snapshot"]
    assert snapshot["persona"]["email"].lower() == "emikes@ais-now.com"
    assert snapshot["persona"]["isAppAdmin"] is True and snapshot["persona"]["role"] == "coordinator"
    users = snapshot["accessUsers"]
    assert {u["email"].lower() for u in users if u["isAppAdmin"]} == ADMINS
    for user in users:
        assert user["id"] and set(user["directRoles"] + user["inheritedRoles"]) <= {"coordinator", "rep", "employee"}
        expected = "coordinator" if user["isAppAdmin"] else next((r for r in ["coordinator", "rep", "employee"] if r in user["directRoles"] + user["inheritedRoles"]), "none")
        assert user["effectiveRole"] == expected
    groups = snapshot["accessGroups"]
    expected_groups = json.loads((Path(__file__).resolve().parent.parent / "solutions/group-access.json").read_text(encoding="utf-8"))["groups"]
    for expected_group in expected_groups:
        matches = [g for g in groups if g["directoryId"].lower() == expected_group["directoryId"].lower() and g["membership"] == expected_group["membership"]]
        assert len(matches) == 1, "Expected group binding is missing or ambiguous"
        group = matches[0]
        assert group["name"] == expected_group["name"] and group["roles"] == [expected_group["role"]]
        native = d.call("GET", f"teams({group['id']})", params={"$select": "name,teamtype,membershiptype,azureactivedirectoryobjectid", "$expand": "teamroles_association($select=roleid,name)"})
        assert native["teamtype"] in [2, 3] and native["membershiptype"] == 1
        assert native["azureactivedirectoryobjectid"] == expected_group["directoryId"]
        assert "Ticket Manager Representative" in [r["name"] for r in native["teamroles_association"]]
    roles = d.call("GET", "roles", params={"$select": "roleid,name,_parentrootroleid_value", "$filter": "name eq 'Ticket Manager Coordinator' or name eq 'Ticket Manager Representative' or name eq 'Ticket Manager Employee'"})["value"]
    privilege = d.call("GET", "privileges", params={"$select": "privilegeid", "$filter": "name eq 'prvReadOrganization'"})["value"][0]["privilegeid"]
    for role in roles:
        privileges = d.call("GET", f"RetrieveRolePrivilegesRole(RoleId={role['roleid']})")["RolePrivileges"]
        assert any(p["PrivilegeId"] == privilege for p in privileges), role["name"]
    solution = d.call("GET", "solutions", params={"$select": "solutionid,uniquename", "$filter": f"uniquename eq '{SOLUTION}'"})["value"][0]
    assert not d.call("GET", "solutions", params={"$select": "solutionid", "$filter": "uniquename eq 'AISTicketReviewQA'"})["value"], "Retired QA solution still exists"
    members = d.call("GET", "solutioncomponents", params={"$select": "componenttype,objectid,rootcomponentbehavior", "$filter": "_solutionid_value eq " + solution["solutionid"]})["value"]
    assert any(c["componenttype"] == 300 and c["objectid"] == APP_ID for c in members), "Code app missing"
    assert len([c for c in members if c["componenttype"] == 1 and c["rootcomponentbehavior"] == 0]) >= 16, "Full table definitions missing"
    assert {20, 91, 10026}.issubset({c["componenttype"] for c in members}), "Backend or roles missing"
    legacy = d.call("GET", "roles", params={"$select": "roleid,_parentrootroleid_value", "$filter": "name eq 'Ticket Manager User'"})["value"]
    legacy = [r for r in legacy if r.get("_parentrootroleid_value", r["roleid"]) == r["roleid"]]
    for role in roles + legacy:
        assert any(c["componenttype"] == 20 and c["objectid"] == role["roleid"] for c in members), "A Ticket Manager role is missing from the main solution"
    print(json.dumps({"status": "PASS", "authenticatedAs": "emikes@ais-now.com", "revision": response["revision"],
                      "adminAccounts": sorted(ADMINS), "activeUsers": len(users), "solution": solution["uniquename"],
                      "groups": [{"name": g["name"], "directoryId": g["directoryId"], "membership": g["membership"], "roles": g["roles"]} for g in groups],
                      "checks": ["server app-admin identity", "exactly three fixed admins", "effective direct/team role projection", "configured native group-role bindings", "API prerequisite privileges", "app and full table solution membership", "backend and all role solution membership", "retired QA solution absent"],
                      "mutations": 0, "otherUsersAuthenticated": 0}, indent=2))


if __name__ == "__main__":
    main()
