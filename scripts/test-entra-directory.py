"""Plan or verify employee contact sync from the built-in Entra virtual table.

Default reads only. --verify-backend also calls the coordinator-only read probe.
--apply performs one announced real contact sync, preserving IDs, eligibility,
customers, ticket history and role projections. No fixture, role or account edits.
Never prints or saves directory profiles, access tokens or contact details.
"""
import argparse
from datetime import datetime, timezone
import json
import re
from pathlib import Path
import uuid

from dataverse_api import Dataverse, ORG

ROOT = Path(__file__).resolve().parent.parent
COLUMNS = "aaduserid,accountenabled,usertype,displayname,mail,userprincipalname,mobilephone,businessphones,companyname"
POLICY = json.loads((ROOT / "config/directory-people-policy.json").read_text(encoding="utf-8"))


def is_person(profile):
    addresses = [(profile.get(key) or "").strip() for key in ["mail", "userprincipalname"]]
    excluded = {value.lower() for value in POLICY["excludedAddresses"]}
    if any(value.lower() in excluded for value in addresses):
        return False
    identities = [value.split("@")[0] for value in addresses] + [(profile.get("displayname") or "").strip().lstrip("#").strip()]
    return not any(re.search(POLICY["excludedIdentityPattern"], value, re.IGNORECASE) for value in identities)


def directory(d):
    url = ORG + "/api/data/v9.2/aadusers"
    params = {"$select": COLUMNS, "$filter": "accountenabled eq true and usertype eq 'Member'"}
    rows = {}
    excluded = 0
    seen = set()
    pages = set()
    while url:
        if not url.startswith(ORG + "/api/data/v9.2/aadusers") or url in pages:
            raise RuntimeError("Unexpected or repeated Entra paging URL; no sync was attempted.")
        pages.add(url)
        response = d.session.get(url, params=params, headers={"Prefer": "odata.maxpagesize=100"}, timeout=60)
        if not response.ok:
            raise RuntimeError(f"Entra directory read failed with HTTP {response.status_code}; profile contents withheld.")
        data = response.json()
        for row in data["value"]:
            key = str(uuid.UUID(row["aaduserid"]))
            assert row["accountenabled"] is True and row["usertype"].lower() == "member", "Unexpected account eligibility"
            assert key not in seen, "Duplicate Entra profile"
            seen.add(key)
            if not is_person(row):
                excluded += 1
                continue
            rows[key] = row
        url = data.get("@odata.nextLink")
        params = None
    assert rows, "Entra returned no enabled member accounts; no sync was attempted"
    return rows, len(pages), excluded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-backend", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    d = Dataverse()  # Verifies emikes@ais-now.com against native WhoAmI.

    def api(payload):
        return json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps(payload)})["Result"])

    profiles, pages, excluded = directory(d)
    before = api({"operation": "snapshot"})
    assert before["snapshot"]["persona"]["email"].lower() == "emikes@ais-now.com"
    contacts = before["state"]["contacts"]
    existing = {str(uuid.UUID(c["directoryId"])): c for c in contacts if c["type"] == "employee"}
    record = {
        "authenticatedAs": "emikes@ais-now.com", "source": "Microsoft Entra ID", "virtualTable": "aaduser",
        "enabledMemberProfiles": len(profiles), "directoryReadPages": pages,
        "rawEnabledMembers": len(profiles) + excluded, "excludedServiceOrTestProfiles": excluded,
        "peoplePolicyVersion": POLICY["version"],
        "existingEmployeeContacts": len(existing), "matchingExisting": len(profiles.keys() & existing.keys()),
        "newEmployeeContacts": len(profiles.keys() - existing.keys()),
        "existingEmployeesOutsideEnabledMembers": len(existing.keys() - profiles.keys()),
        "revisionBefore": before["revision"], "writes": 0,
    }
    if args.verify_backend or args.apply:
        preview = api({"operation": "directoryPreview"})
        assert preview["source"] == "Microsoft Entra ID" and preview["activeMembers"] == len(profiles) and preview["writes"] == 0
        assert api({"operation": "snapshot"})["revision"] == before["revision"], "Read probe changed the workspace"
        record["callerDirectoryReadVerified"] = True
    if args.apply:
        synced = api({"operation": "command", "revision": before["revision"], "operationId": str(uuid.uuid4()), "command": {"type": "syncDirectory"}})
        after = api({"operation": "snapshot"})
        assert after["revision"] == synced["revision"] == before["revision"] + 1
        current = {c["id"]: c for c in after["state"]["contacts"]}
        for original in contacts:
            saved = current[original["id"]]
            if original["type"] == "customer":
                assert saved == original, "Customer contact changed"
            else:
                for field in ["id", "directoryId", "appActive", "tier", "type"]:
                    assert saved[field] == original[field], "Employee identity, override or category changed"
        for field, value in before["state"].items():
            if field != "contacts":
                assert after["state"][field] == value, "Non-contact workspace state changed: " + field
        for field in ["accessUsers", "accessGroups"]:
            assert after["snapshot"][field] == before["snapshot"][field], "User/group access changed"
        employees = [c for c in current.values() if c["type"] == "employee"]
        by_directory = {str(uuid.UUID(c["directoryId"])): c for c in employees}
        assert len(by_directory) == len(employees), "Duplicate employee identities"
        assert {key for key, c in by_directory.items() if c["directoryActive"]} == set(profiles), "Filtered people coverage differs from Entra"
        for key, profile in profiles.items():
            contact = by_directory[key]
            assert contact["name"] == profile["displayname"].strip()
            assert contact["email"] == (profile.get("mail") or profile["userprincipalname"]).strip()
            if key not in existing:
                assert contact["appActive"] is True
        record.update({
            "status": "PASS", "verifiedAtUtc": datetime.now(timezone.utc).isoformat(),
            "revisionAfter": after["revision"], "writes": 1, "syncResult": synced["result"]["directory"],
            "employeeContactsAfter": len(employees), "totalContactsAfter": len(current),
            "existingContactIdsPreserved": True, "appEligibilityOverridesPreserved": True,
            "customersUnchanged": True, "ticketHistoryAndInventoryUnchanged": True,
            "userAndGroupAccessUnchanged": True, "newConnectionsCreated": 0, "newPermissionsGranted": 0,
        })
        (ROOT / "solutions/directory-people-test.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
