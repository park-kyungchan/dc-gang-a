"""Verify the source snapshots imported into this repository."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs" / "source-import-manifest.json"


def main() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1:
        raise ValueError("unsupported source-import manifest")
    failures: list[str] = []
    for component in data["components"]:
        base = (ROOT / component["name"]).resolve()
        files = component["files"]
        if len(files) != component["file_count"]:
            failures.append(f"{component['name']}:file_count")
        for name, expected in files.items():
            path = (base / name).resolve()
            if not path.is_relative_to(base) or not path.is_file():
                failures.append(f"{component['name']}/{name}:missing_or_unsafe")
            elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                failures.append(f"{component['name']}/{name}:drift")
    if failures:
        print("source_imports=fail " + ", ".join(failures))
        return 1
    print("source_imports=pass " + ", ".join(
        f"{item['name']}:{item['file_count']}" for item in data["components"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
