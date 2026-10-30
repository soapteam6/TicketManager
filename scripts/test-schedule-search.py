"""Run or inspect a schedule-search job as emikes@ais-now.com.

--create creates one public-web search job and consumes the existing Claude API
service. It never imports inventory. Without --create, pass --job-id for polling.
"""
import argparse
import base64
import mimetypes
import json
import re
from pathlib import Path
import time
import uuid

from dataverse_api import Dataverse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--job-id")
    parser.add_argument("--query", default="Las Vegas Aviators home games in September 2026")
    parser.add_argument("--file", action="append", default=[], help="File to prepare with Claude; never imports ticket data.")
    parser.add_argument("--freeform", action="store_true", help="Resolve the requested season without imposing an existing one.")
    parser.add_argument("--artifact-stem", default="schedule-search-live")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9-]+", args.artifact_stem):
        parser.error("Artifact stem must contain only lowercase letters, numbers and hyphens.")
    if not args.create and not args.job_id:
        parser.error("Use --create after announcing the live search, or --job-id for a read-only status check.")
    d = Dataverse()

    def api(payload):
        return json.loads(d.call("POST", "cr9cd_TicketReview", {"Payload": json.dumps(payload)})["Result"])

    snapshot = api({"operation": "snapshot"})
    before = d.call("GET", "cr9cd_reviewworkspaces(f18b973a-2936-44e5-aa55-271d7424aef3)", params={"$select": "cr9cd_data,cr9cd_revision,cr9cd_lock"})
    job_id = args.job_id or str(uuid.uuid4())
    if args.create:
        seasons = snapshot["snapshot"]["seasons"]
        season = {} if args.freeform or args.file else next((s for s in seasons if s["startDate"] <= "2026-09-01" and s["endDate"] >= "2026-09-30"), seasons[0])
        files = []
        for name in args.file:
            path = Path(name); content = path.read_bytes()
            files.append({"name": path.name, "mediaType": mimetypes.guess_type(path.name)[0] or "application/octet-stream", "size": len(content), "data": base64.b64encode(content).decode()})
        result = api({"operation": "scheduleSearchStart", "jobId": job_id, "request": {"query": args.query, "seasonId": "" if args.freeform or files else season["id"], "ticketsPerEvent": 0 if args.freeform or files else 4, "homeOnly": True, "timeZone": "America/Los_Angeles", **({"files": files} if files else {})}})
        print("Created search job " + job_id + "; status " + result["status"], flush=True)
    else:
        result = api({"operation": "scheduleSearchGet", "jobId": job_id})
    last = ""
    deadline = time.monotonic() + 300
    while True:
        if result["status"] != last:
            print("Search status: " + result["status"], flush=True)
            last = result["status"]
        if result["status"] in ["complete", "failed"] or time.monotonic() >= deadline:
            break
        time.sleep(3)
        result = api({"operation": "scheduleSearchGet", "jobId": job_id})
    artifact = Path(__file__).resolve().parent.parent / f"design-artifacts.local/{args.artifact_stem}.json"
    artifact.parent.mkdir(exist_ok=True)
    artifact.write_text(json.dumps(result, indent=2), encoding="utf-8")
    after = d.call("GET", "cr9cd_reviewworkspaces(f18b973a-2936-44e5-aa55-271d7424aef3)", params={"$select": "cr9cd_data,cr9cd_revision,cr9cd_lock"})
    check = {"jobId": job_id, "status": result["status"], "workspaceUnchanged": before == after,
             "inventoryImported": 0, "artifact": str(artifact)}
    artifact.with_name(args.artifact_stem + "-check.json").write_text(json.dumps(check, indent=2), encoding="utf-8")
    print(json.dumps(check, indent=2))
    if result["status"] != "complete":
        raise RuntimeError(result.get("error") or "Search did not finish within the check window.")


if __name__ == "__main__":
    main()
