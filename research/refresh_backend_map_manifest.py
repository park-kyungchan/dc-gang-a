"""Refresh byte and SHA-256 pins for the privacy-reviewed backend map only."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "backend-map"
MANIFEST = ROOT / "map-manifest.json"
NEW_SCOPE = (
    "Current source and prior-live review of student-level app/preclass reads; "
    "no selected-student submission, grading, video, or stable join verified."
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    files = {item["path"]: item for item in manifest["files"]}
    files["app-read-contracts.md"] = {
        "path": "app-read-contracts.md",
        "evidence_scope": NEW_SCOPE,
    }
    for name, item in files.items():
        path = ROOT / name
        if not path.is_file() or path.resolve().parent != ROOT.resolve():
            raise ValueError(f"Missing or out-of-scope map file: {name}")
        data = path.read_bytes()
        item["bytes"] = len(data)
        item["sha256"] = hashlib.sha256(data).hexdigest()
    manifest["files"] = [files[name] for name in sorted(files)]
    manifest["generated_utc"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest["note"] = (
        f"Hashes cover the {len(files)} canonical files listed above. "
        "This manifest excludes itself and files outside research/backend-map. "
        "Evidence summaries are bounded to the dated sources cited by each map file."
    )
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    reread = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for item in reread["files"]:
        if item["sha256"] != sha256(ROOT / item["path"]):
            raise AssertionError(item["path"])
    print(json.dumps({"files": len(files), "manifest_sha256": sha256(MANIFEST)}))


if __name__ == "__main__":
    main()
