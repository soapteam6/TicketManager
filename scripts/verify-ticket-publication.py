"""Verify that both solution exports contain the exact current production app build.

Local files only. Run after npm run build, pac code push, and solution export.
Records file hashes and the source commit without publishing or authenticating.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

from ticket_solution import SOLUTION

ROOT = Path(__file__).resolve().parent.parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    config = json.loads((ROOT / "power.config.json").read_text(encoding="utf-8-sig"))
    build = ROOT / config["buildPath"]
    files = sorted(p for p in build.rglob("*") if p.is_file())
    if not files or not (build / config["buildEntryPoint"]).exists():
        raise RuntimeError("Build the production app before verifying exports.")
    exports = []
    for kind in ["unmanaged", "managed"]:
        path = ROOT / "solutions" / (SOLUTION + "_" + kind + ".zip")
        with zipfile.ZipFile(path) as archive:
            entries = [n for n in archive.namelist() if n.startswith("CanvasApps/") and n.endswith("_CodeAppPackages/index.html")]
            if len(entries) != 1:
                raise RuntimeError("Expected exactly one exported code app.")
            prefix = entries[0][:-len("index.html")]
            exported_files = {n[len(prefix):] for n in archive.namelist() if n.startswith(prefix) and not n.endswith("/")}
            build_files = {p.relative_to(build).as_posix() for p in files}
            if exported_files != build_files:
                raise RuntimeError(f"{kind}: exported app file list differs from the production build.")
            for file in files:
                relative = file.relative_to(build).as_posix()
                if archive.read(prefix + relative) != file.read_bytes():
                    raise RuntimeError(f"{kind}: exported app file differs from the production build: {relative}")
        exports.append({"file": path.name, "sha256": digest(path.read_bytes()), "appBuildFilesMatched": len(files)})
        print(f"{kind}: every exported app file matches the production build byte for byte.")
    record = {
        "appId": config["appId"], "environmentId": config["environmentId"], "solution": SOLUTION,
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "verifiedAtUtc": datetime.now(timezone.utc).isoformat(),
        "playUrl": f"https://apps.powerapps.com/play/e/{config['environmentId']}/app/{config['appId']}?tenantId=a22e51ee-6f67-49b3-b98c-0e3a97d49b8a",
        "appBuildFiles": [{"path": p.relative_to(build).as_posix(), "sha256": digest(p.read_bytes())} for p in files],
        "solutionExports": exports,
    }
    (ROOT / "solutions/publication.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print("Recorded verified app/solution hashes and source commit in solutions/publication.json.")


if __name__ == "__main__":
    main()
