"""Plan or apply the explicit Ticket Manager group bindings in AIS Development.

Default is read-only. --apply calls the role-authorized transactional Custom API.
Uses only emikes@ais-now.com; no Graph consent, directory-group writes, individual
role assignments, fixture data changes or code app publication.
"""
import argparse
import json
from pathlib import Path
import uuid

from dataverse_api import Dataverse, ORG

CONFIG = Path(__file__).resolve().parent.parent / "solutions/group-access.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    assert config["schemaVersion"] == 1
    d = Dataverse()
    print(f"Verified emikes@ais-now.com; target {ORG}")

    def api(payload):
        return json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps(payload)})["Result"])

    response = api({"operation": "snapshot"})
    if not response["snapshot"]["persona"].get("isAppAdmin") or "accessGroups" not in response["snapshot"]:
        raise RuntimeError("An app admin and the group-access backend are required.")
    def user_assignments():
        path = "systemuserrolescollection"
        params = {"$select": "systemuserid,roleid"}
        result = set()
        while path:
            page = d.call("GET", path, params=params)
            result.update((r["systemuserid"], r["roleid"]) for r in page["value"])
            path = page.get("@odata.nextLink", "").removeprefix(ORG + "/api/data/v9.2/")
            params = None
        return result
    before_assignments = user_assignments() if args.apply else None
    for entry in config["groups"]:
        directory_id = str(uuid.UUID(entry["directoryId"]))
        if entry["membership"] != "members" or entry["role"] not in ("coordinator", "rep", "employee"):
            raise RuntimeError("Only explicit members-only app-role bindings are supported.")
        groups = [g for g in response["snapshot"]["accessGroups"] if g["directoryId"].lower() == directory_id and g["membership"] == "members"]
        if len(groups) > 1:
            raise RuntimeError("Ambiguous group team binding; refusing a change.")
        if groups and groups[0]["name"].casefold() != entry["name"].casefold():
            raise RuntimeError("The native directory group name differs from the configured target.")
        current = groups[0] if groups else None
        print(f"{entry['name']} ({directory_id}): members -> {entry['role']}; " + ("already assigned" if current and current["roles"] == [entry["role"]] else "change required"))
        if not args.apply or current and current["roles"] == [entry["role"]]:
            continue
        command = {"type": "setGroupRole", "groupId": current["id"], "role": entry["role"], "expectedRoles": current["roles"]} if current else {
            "type": "connectGroup", "directoryId": directory_id, "role": entry["role"], "expectedName": entry["name"]}
        response = api({"operation": "command", "command": command, "revision": response["revision"], "operationId": str(uuid.uuid4())})
        matched = [g for g in response["snapshot"]["accessGroups"] if g["directoryId"].lower() == directory_id and g["membership"] == "members"]
        assert len(matched) == 1 and matched[0]["roles"] == [entry["role"]]
        print(f"Verified native group binding: {matched[0]['name']}; workspace revision {response['revision']}.")
    if args.apply:
        assert user_assignments() == before_assignments, "Individual role associations changed during the group update; investigate concurrent administration."
        print(f"Verified all {len(before_assignments)} individual role associations are unchanged.")
    print("Complete. " + ("No individual user role assignments were made." if args.apply else "Read-only plan; add --apply to assign group roles."))


if __name__ == "__main__":
    main()
