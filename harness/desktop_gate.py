"""Read-only Windows Desktop gate for the Daechi Main Sheet workspace.

It runs only the synthetic workbench tests and pinned map/transition checks.
It never opens credentials, student data, an academy session, or a remote host.
"""

from __future__ import annotations

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
REQUIRED_LOCAL_CHECKS = (
    "python_3_12", "workspace", "context_links", "retired_session_workflow",
    "synthetic_workbench", "harness_policy_tests", "backend_map", "academy_source_contract",
    "academy_live_import", "live_dependency_lock", "transition_pack",
    "spt_checkout",
)


def failed_required(checks: dict[str, object]) -> list[str]:
    """A drift or unavailable required check is a failed local gate."""
    return [name for name in REQUIRED_LOCAL_CHECKS
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


def main() -> int:
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
    verifier = TRANSITION / "verify_manifest.py"
    checks["transition_pack"] = (
        run(sys.executable, "-B", str(verifier)) if verifier.is_file()
        else {"status": "unavailable", "path": str(verifier)}
    )
    if (SPT / ".git").exists() and (TRANSITION / "manifest.json").is_file():
        pinned = json.loads((TRANSITION / "manifest.json").read_text(encoding="utf-8"))
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
        )
        checks["spt_checkout"] = {
            "status": "pass" if matches else "drift",
            "head_matches_pin": observed["head"].stdout.strip() == pinned["spt_git_head"],
            "branch_matches_pin": observed["branch"].stdout.strip() == pinned["spt_git_branch"],
            "dirty_paths_match_pin": actual_status == expected_status,
            "changed_paths": len(actual_status.splitlines()),
            "dirty_content": "not_verified",
            "mutation": "none",
        }
    else:
        checks["spt_checkout"] = {"status": "unavailable", "path": str(SPT)}
    checks["academy_auth"] = {
        "status": "configured" if "GANGA_JSESSIONID" in os.environ else "not_configured",
        "detail": "presence only; value never read or printed",
    }
    failed_local = failed_required(checks)
    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scope": "local read-only Desktop gate",
        "local_workspace_gate": {
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
