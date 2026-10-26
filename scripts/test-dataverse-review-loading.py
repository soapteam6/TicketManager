"""Read-only regression: concurrent workspace loads must not write the lock row.

Uses the verified emikes@ais-now.com PAC session. Creates no test records.
"""
from concurrent.futures import ThreadPoolExecutor
import json

import requests

from dataverse_api import Dataverse, ORG

WORKSPACE_ID = "f18b973a-2936-44e5-aa55-271d7424aef3"


def main():
    d = Dataverse()
    table = d.call("GET", "EntityDefinitions(LogicalName='cr9cd_reviewworkspace')?$select=EntitySetName")["EntitySetName"]
    path = f"{table}({WORKSPACE_ID})?$select=cr9cd_revision,modifiedon,cr9cd_lock"
    before = d.call("GET", path)
    headers = dict(d.session.headers)

    def load(_):
        with requests.Session() as session:
            response = session.post(ORG + "/api/data/v9.2/cr9cd_TicketReview", headers=headers,
                                    json={"Payload": json.dumps({"operation": "snapshot"})}, timeout=120)
            assert response.ok, f"Concurrent load failed: {response.status_code} {response.text[:500]}"
            result = json.loads(response.json()["Result"])
            assert result["snapshot"]["persona"]["email"].lower() == "emikes@ais-now.com"
            assert result["revision"] == before["cr9cd_revision"]
            return result["revision"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        revisions = list(pool.map(load, range(12)))
    after = d.call("GET", path)
    for key in ["@odata.etag", "modifiedon", "cr9cd_revision", "cr9cd_lock"]:
        assert before.get(key) == after.get(key), f"Workspace changed during read-only loads: {key}"
    print(json.dumps({"status": "PASS", "account": "emikes@ais-now.com", "successfulLoads": len(revisions),
                      "concurrency": 6, "revision": after["cr9cd_revision"],
                      "workspaceEtagUnchanged": True, "workspaceLockUnchanged": True,
                      "businessRecordsCreated": 0}, indent=2))


if __name__ == "__main__":
    main()
