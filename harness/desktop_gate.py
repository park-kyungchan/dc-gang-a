"""Read-only Windows Desktop gate for the Daechi Main Sheet workspace.

It runs only the synthetic workbench tests and pinned map/transition checks.
It never opens credentials, student data, an academy session, or a remote host.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = Path.home() / "Desktop"
TRANSITION = DESKTOP / "Runtime-Guide" / "handoffs" / "codex-desktop-transition-2026-09-27"
SPT = DESKTOP / "spt-ios-workbench" / "worktree"
SPT_CANDIDATE_PIN = ROOT / "harness" / "spt-candidate-pin.json"
SPT_HANDOFF_RELATIVE = "handoffs/2026-09-27-spt-ios.md"
TRANSITION_HISTORY_SPT_HANDOFF = ROOT / "harness" / "transition-history" / "spt-handoff-2026-09-27.md"
RETIRED = (
    ".agents/skills/ganga-read-client/SKILL.md",
    "GEMINI.md",
    "src/client.py",
    "src/harness_check.py",
    "src/mcp_server.py",
    "tests/test_pipeline.py",
    "research/lms_index_probe.py",
    "config/session.json",
)
CORE_REQUIRED_CHECKS = (
    "python_3_12", "workspace", "context_links", "retired_session_workflow",
    "synthetic_workbench", "harness_policy_tests", "backend_map",
    "academy_source_contract", "transition_pack", "spt_checkout",
)
LIVE_REQUIRED_CHECKS = CORE_REQUIRED_CHECKS + (
    "academy_live_import", "live_dependency_lock",
)
REQUIRED_CHECKS_BY_PROFILE = {"core": CORE_REQUIRED_CHECKS, "live": LIVE_REQUIRED_CHECKS}


def failed_required(checks: dict[str, object], profile: str = "core") -> list[str]:
    """A drift or unavailable required check is a failed local gate."""
    return [name for name in REQUIRED_CHECKS_BY_PROFILE[profile]
            if not isinstance(checks.get(name), dict)
            or checks[name].get("status") != "pass"]


def run(*argv: str, cwd: Path = ROOT) -> dict[str, object]:
    result = subprocess.run(
        argv, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=90, check=False,
    )
    output = result.stdout + result.stderr
    if result.returncode == 0 and "unittest" in argv:
        output = " | ".join(
            line.strip() for line in output.splitlines()
            if line.startswith("Ran ") or line.strip() == "OK"
        )
    return {
        "status": "pass" if result.returncode == 0 else "fail",
        "exit_code": result.returncode,
        "output": output[
            -350 if result.returncode == 0 else -3000:
        ].strip(),
    }


def _reviewed_transition_item(
    files: list[dict[str, object]], name: str, expected_path: Path
) -> dict[str, object] | None:
    matches = [item for item in files if item.get("name") == name]
    if len(matches) != 1 or not isinstance(matches[0].get("path"), str):
        return None
    try:
        return matches[0] if Path(str(matches[0]["path"])).resolve() == expected_path.resolve() else None
    except (OSError, RuntimeError):
        return None


def _pinned_bytes_match(data: bytes | None, item: dict[str, object]) -> bool:
    return (
        data is not None
        and len(data) == item.get("bytes")
        and hashlib.sha256(data).hexdigest() == item.get("sha256")
    )

def check_transition_pins(
    files: list[dict[str, object]], actual: dict[str, bytes],
    historical_map: bytes | None, current_map_valid: bool,
    historical_spt_handoff: bytes | None = None,
    current_spt_handoff_sha256: str | None = None,
    spt_handoff_route_valid: bool = False,
) -> dict[str, object]:
    """Allow only the two reviewed, byte-proven transition supersessions.

    The academy map needs exact Git-HEAD history plus current map validation.
    The SPT handoff needs an exact preserved copy, the reviewed manifest path,
    and a current handoff digest bound to the validated SPT source manifest.
    All other transition pins stay exact.
    """
    names = [str(item.get("name", "")) for item in files]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    superseded_map: list[str] = []
    superseded_spt: list[str] = []
    mismatched: list[str] = list(duplicates)
    for item in files:
        name = str(item.get("name", ""))
        if name in duplicates:
            continue
        data = actual.get(name)
        if _pinned_bytes_match(data, item):
            continue
        if (name == "academy_map_manifest" and current_map_valid
                and _pinned_bytes_match(historical_map, item)):
            superseded_map.append(name)
            continue
        current_spt_handoff_matches = (
            name == "spt_handoff" and data is not None
            and current_spt_handoff_sha256 is not None
            and hashlib.sha256(data).hexdigest() == current_spt_handoff_sha256
        )
        if (current_spt_handoff_matches and spt_handoff_route_valid
                and _pinned_bytes_match(historical_spt_handoff, item)):
            superseded_spt.append(name)
            continue
        mismatched.append(name)
    spt_item = next((item for item in files if item.get("name") == "spt_handoff"), None)
    spt_data = actual.get("spt_handoff")
    return {
        "status": "pass" if not mismatched else "fail",
        "pinned_files": len(files),
        "exact_current_files": len(files) - len(superseded_map) - len(superseded_spt) - len(mismatched),
        "superseded_historical_map": superseded_map,
        "superseded_historical_spt_handoff": superseded_spt,
        "mismatched_files": mismatched,
        "current_map_separately_validated": current_map_valid,
        "current_spt_handoff_matches_manifest": (
            spt_data is not None and current_spt_handoff_sha256 is not None
            and hashlib.sha256(spt_data).hexdigest() == current_spt_handoff_sha256
        ),
        "spt_handoff_route_validated": spt_handoff_route_valid,
        "historical_spt_handoff_bytes_match_pin": (
            _pinned_bytes_match(historical_spt_handoff, spt_item) if spt_item else False
        ),
    }

def _read_historical_spt_handoff(current_spt_handoff_sha256: str | None) -> bytes | None:
    if (current_spt_handoff_sha256 is None
            or re.fullmatch(r"[0-9a-f]{64}", current_spt_handoff_sha256) is None):
        return None
    try:
        return TRANSITION_HISTORY_SPT_HANDOFF.read_bytes()
    except OSError:
        return None


def verify_transition_pack(
    current_map_valid: bool, current_spt_handoff_sha256: str | None = None
) -> dict[str, object]:
    manifest_path = TRANSITION / "manifest.json"
    if not manifest_path.is_file():
        return {"status": "unavailable", "path": str(manifest_path)}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        files = manifest["files"]
        if not isinstance(files, list) or not all(isinstance(item, dict) for item in files):
            return {"status": "fail", "reason": "invalid_transition_file_list"}
        actual = {str(item["name"]): Path(str(item["path"])).read_bytes()
                  for item in files}
    except (OSError, KeyError, TypeError, ValueError) as exc:
        return {"status": "fail", "reason": type(exc).__name__}

    expected_map_path = ROOT / "research" / "backend-map" / "map-manifest.json"
    map_item = _reviewed_transition_item(files, "academy_map_manifest", expected_map_path)
    historical_map = None
    if map_item is not None:
        prior = subprocess.run(
            ("git", "show", "HEAD:research/backend-map/map-manifest.json"),
            cwd=ROOT, capture_output=True, timeout=15, check=False,
        )
        if prior.returncode == 0:
            historical_map = prior.stdout

    expected_spt_handoff_path = SPT / "handoffs" / "2026-09-27-spt-ios.md"
    spt_item = _reviewed_transition_item(files, "spt_handoff", expected_spt_handoff_path)
    historical_spt_handoff = (
        _read_historical_spt_handoff(current_spt_handoff_sha256)
        if spt_item is not None else None
    )
    checks = check_transition_pins(
        files, actual, historical_map, current_map_valid,
        historical_spt_handoff, current_spt_handoff_sha256,
        spt_handoff_route_valid=spt_item is not None,
    )
    checks["reviewed_spt_handoff_route"] = spt_item is not None
    checks["historical_spt_handoff_path"] = str(TRANSITION_HISTORY_SPT_HANDOFF)
    checks["historical_spt_handoff_copy_readable"] = historical_spt_handoff is not None
    return checks

def verify_spt_checkout() -> dict[str, object]:
    spt_pin_path = (SPT_CANDIDATE_PIN if SPT_CANDIDATE_PIN.is_file()
                    else TRANSITION / "manifest.json")
    if not (SPT / ".git").exists() or not spt_pin_path.is_file():
        return {"status": "unavailable", "path": str(SPT)}
    try:
        pinned = json.loads(spt_pin_path.read_text(encoding="utf-8"))
        candidate_files = None
        candidate_content_ok = True
        spt_handoff_sha256 = None
        if spt_pin_path == SPT_CANDIDATE_PIN:
            manifest_path = ROOT / "harness" / "spt-candidate-source-manifest.json"
            if manifest_path.is_file():
                raw_manifest = manifest_path.read_bytes()
                parsed_manifest = json.loads(raw_manifest)
                candidate_files = parsed_manifest if isinstance(parsed_manifest, dict) else None
                file_hashes = candidate_files.get("files") if candidate_files else None
                expected_hash = pinned.get("postcommit_manifest_sha256", "")
                expected_count = pinned.get("source_file_hashes_compared")
                candidate_content_ok = (
                    isinstance(file_hashes, dict)
                    and hashlib.sha256(raw_manifest).hexdigest() == expected_hash
                    and candidate_files.get("archive_sha256") == pinned.get("postcommit_archive_sha256")
                    and len(file_hashes) == expected_count
                )
                if isinstance(file_hashes, dict):
                    possible_handoff_hash = file_hashes.get(SPT_HANDOFF_RELATIVE)
                    if (isinstance(possible_handoff_hash, str)
                            and re.fullmatch(r"[0-9a-f]{64}", possible_handoff_hash)):
                        spt_handoff_sha256 = possible_handoff_hash
                    else:
                        candidate_content_ok = False
                    for name, digest in file_hashes.items():
                        if not isinstance(name, str) or not isinstance(digest, str):
                            candidate_content_ok = False
                            break
                        source_path = (SPT / name).resolve()
                        if (not source_path.is_relative_to(SPT.resolve()) or not source_path.is_file()
                                or hashlib.sha256(source_path.read_bytes()).hexdigest() != digest):
                            candidate_content_ok = False
                            break
                else:
                    candidate_content_ok = False
            else:
                candidate_content_ok = False
        git_checks = {
            "head": ("git", "rev-parse", "HEAD"),
            "branch": ("git", "branch", "--show-current"),
            "status": ("git", "status", "--short"),
            "diff_check": ("git", "diff", "--check"),
        }
        observed = {
            name: subprocess.run(argv, cwd=SPT, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=30, check=False)
            for name, argv in git_checks.items()
        }
        actual_status = observed["status"].stdout.strip().replace("\r\n", "\n")
        expected_status = pinned["spt_git_status_short"].strip().replace("\r\n", "\n")
        matches = (
            all(item.returncode == 0 for item in observed.values())
            and observed["head"].stdout.strip() == pinned["spt_git_head"]
            and observed["branch"].stdout.strip() == pinned["spt_git_branch"]
            and actual_status == expected_status
            and candidate_content_ok
        )
        return {
            "status": "pass" if matches else "drift",
            "pin_source": str(spt_pin_path),
            "head_matches_pin": observed["head"].stdout.strip() == pinned["spt_git_head"],
            "branch_matches_pin": observed["branch"].stdout.strip() == pinned["spt_git_branch"],
            "dirty_paths_match_pin": actual_status == expected_status,
            "source_content_matches_pin": candidate_content_ok if spt_pin_path == SPT_CANDIDATE_PIN else None,
            "source_files_checked": len(candidate_files.get("files", {})) if candidate_files else 0,
            "spt_handoff_sha256": spt_handoff_sha256,
            "changed_paths": len(actual_status.splitlines()),
            "dirty_content": "hash_verified" if candidate_files and candidate_content_ok else "not_verified",
            "mutation": "none",
        }
    except (OSError, KeyError, TypeError, ValueError, RuntimeError) as exc:
        return {"status": "fail", "path": str(spt_pin_path), "reason": type(exc).__name__}


def validated_current_spt_handoff_sha256(check: dict[str, object]) -> str | None:
    try:
        pin_source = Path(str(check.get("pin_source", ""))).resolve()
        candidate_pin = SPT_CANDIDATE_PIN.resolve()
    except (OSError, RuntimeError):
        return None
    digest = check.get("spt_handoff_sha256")
    if not (
        check.get("status") == "pass"
        and pin_source == candidate_pin
        and check.get("source_content_matches_pin") is True
        and isinstance(digest, str)
        and re.fullmatch(r"[0-9a-f]{64}", digest)
    ):
        return None
    return digest

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=tuple(REQUIRED_CHECKS_BY_PROFILE),
                        default="core", help="core works in a clean worktree; live requires project dependencies")
    args = parser.parse_args()
    checks: dict[str, object] = {}
    checks["python_3_12"] = {
        "status": "pass" if sys.version_info[:2] == (3, 12) else "fail",
        "version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
    }
    checks["workspace"] = {
        "status": "pass" if (ROOT / "AGENTS.md").is_file() else "fail",
        "root": str(ROOT),
    }
    context_map = ROOT / "harness" / "context-map.md"
    local_links = re.findall(r"(?<!!)\[[^\]]+\]\(([^)]+)\)",
                             context_map.read_text(encoding="utf-8"))
    broken_links = [link for link in local_links
                    if not (context_map.parent / link.split("#", 1)[0]).resolve().exists()]
    checks["context_links"] = {
        "status": "pass" if not broken_links else "fail",
        "checked": len(local_links), "broken": broken_links,
    }
    present = [path for path in RETIRED if (ROOT / path).exists()]
    checks["retired_session_workflow"] = {
        "status": "pass" if not present else "fail", "unexpected_paths": present,
    }
    checks["synthetic_workbench"] = run(
        sys.executable, "-B", "-m", "unittest", "discover",
        "-s", "workbench_v2/tests", "-v",
    )
    checks["harness_policy_tests"] = run(
        sys.executable, "-B", "-m", "unittest", "discover",
        "-s", "harness/tests", "-v",
    )
    checks["backend_map"] = run(sys.executable, "-B", "research/validate_backend_map.py")
    checks["academy_source_contract"] = run(
        sys.executable, "-B", "harness/academy_dayrecord_probe.py",
    )
    live_python = ROOT / ".venv" / "Scripts" / "python.exe"
    checks["academy_live_import"] = (
        run(str(live_python), "-B", "harness/academy_dayrecord_probe.py", "--check-imports")
        if live_python.is_file() else {"status": "unavailable", "path": str(live_python)}
    )
    lockfile = ROOT / "harness" / "requirements-live.lock.txt"
    if live_python.is_file() and lockfile.is_file():
        freeze = subprocess.run(
            (str(live_python), "-m", "pip", "freeze", "--disable-pip-version-check"),
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=30, check=False,
        )
        expected = lockfile.read_text(encoding="utf-8").splitlines()
        actual = freeze.stdout.splitlines()
        checks["live_dependency_lock"] = {
            "status": "pass" if freeze.returncode == 0 and actual == expected else "fail",
            "expected_packages": len(expected),
            "installed_packages": len(actual),
        }
    else:
        checks["live_dependency_lock"] = {"status": "unavailable"}
    checks["spt_checkout"] = verify_spt_checkout()
    spt_handoff_sha256 = validated_current_spt_handoff_sha256(checks["spt_checkout"])
    checks["transition_pack"] = verify_transition_pack(
        checks["backend_map"]["status"] == "pass",
        spt_handoff_sha256,
    )
    checks["academy_auth"] = {
        "status": "configured" if "GANGA_JSESSIONID" in os.environ else "not_configured",
        "detail": "presence only; value never read or printed",
    }
    failed_local = failed_required(checks, args.profile)
    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scope": "local read-only Desktop gate",
        "local_workspace_gate": {
            "profile": args.profile,
            "status": "pass" if not failed_local else "fail",
            "failed_checks": failed_local,
        },
        "app_project_association": "not_checked_by_this_command",
        "live_academy_read": "not_checked_by_this_command",
        "checks": checks,
    }
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 1 if failed_local else 0


if __name__ == "__main__":
    raise SystemExit(main())
