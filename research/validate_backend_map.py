"""Verify the canonical map pins, local links, and operation count."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent / "backend-map"
MANIFEST = ROOT / "map-manifest.json"
LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    names: set[str] = set()
    checked = 0
    for item in manifest["files"]:
        name = item["path"]
        if name in names:
            raise AssertionError(f"duplicate manifest path: {name}")
        names.add(name)
        path = ROOT / name
        data = path.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise AssertionError(f"hash mismatch: {name}")
        if path.suffix != ".md":
            continue
        for raw in LINK.findall(data.decode("utf-8")):
            target = raw.split("#", 1)[0].split("?", 1)[0]
            if not target or "://" in target or target.startswith("mailto:"):
                continue
            resolved = (path.parent / unquote(target)).resolve()
            if not resolved.exists():
                raise AssertionError(f"broken link: {name} -> {target}")
            checked += 1
    registry = json.loads((ROOT / "route-registry.json").read_text(encoding="utf-8"))
    operations = registry if isinstance(registry, list) else registry.get("entries", [])
    if len(operations) != manifest["evidence_summary"]["route_registry_entries"]:
        raise AssertionError("route count mismatch")
    print(json.dumps({"files": len(names), "local_links": checked, "operations": len(operations), "manifest_sha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest()}))


if __name__ == "__main__":
    main()
