"""Refresh byte and SHA-256 pins for the privacy-reviewed backend map only."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "backend-map"
MANIFEST = ROOT / "map-manifest.json"
NEW_SCOPE = (
    "Current source and prior-live review of student-level app/preclass reads, "
    "including a historical pre-study detail candidate and local-versus-production DB boundary; "
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
    files["teacher-site-live-structure-2026-09-29.json"] = {
        "path": "teacher-site-live-structure-2026-09-29.json",
        "evidence_scope": (
            "Bounded authenticated fixed GET structure observations for the two default pre-study "
            "lists and active middle-school textbook catalog; no raw student rows or PDF contents."
        ),
    }
    files["route-registry.json"]["evidence_scope"] = (
        "Operation entries across live, static, source-only, and historical evidence; "
        "textbook_answer_catalog and default pre-study lists have bounded live structure; "
        "textbook_sample_pdf permits only two fixed catalog-observed URLs; "
        "the pre-study detail entry is an unsafe-to-probe historical candidate."
    )
    for name, item in files.items():
        path = ROOT / name
        if not path.is_file() or path.resolve().parent != ROOT.resolve():
            raise ValueError(f"Missing or out-of-scope map file: {name}")
        data = path.read_bytes()
        item["bytes"] = len(data)
        item["sha256"] = hashlib.sha256(data).hexdigest()
    manifest["files"] = [files[name] for name in sorted(files)]
    registry = json.loads((ROOT / "route-registry.json").read_text(encoding="utf-8"))
    entries = registry if isinstance(registry, list) else registry["entries"]
    manifest["evidence_summary"]["route_registry_entries"] = len(entries)
    manifest["evidence_summary"]["route_registry_by_evidence_grade"] = dict(
        sorted(Counter(entry["evidence_grade"] for entry in entries).items())
    )
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
