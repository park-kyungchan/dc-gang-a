"""Bounded pre-push path and credential-pattern scan; never print match values.

This is a guard for common mistakes, not proof that prose contains no private
information. Review the exact staged paths and diff before publication.
"""

from __future__ import annotations

import pathlib
import re
import subprocess


ROOT = pathlib.Path(__file__).resolve().parents[2]
FORBIDDEN_PREFIXES = (
    "config/", "data/", ".codex/", "work/", "lms-automation/config/",
    "lms-automation/data/", "lms-automation/.git.backup/",
)
FORBIDDEN_EXACT = {"docs/decision_ledger.json", "spt/.openai/hosting.json"}
PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github_token": re.compile(rb"gh[pousr]_[A-Za-z0-9]{20,}"),
    "openai_key": re.compile(rb"sk-(?:proj-)?[A-Za-z0-9_-]{20,}"),
    "google_api_key": re.compile(rb"AIza[0-9A-Za-z_-]{30,}"),
    "aws_access_key": re.compile(rb"AKIA[A-Z0-9]{16}"),
    "literal_session": re.compile(rb"JSESSIONID\s*[=:]\s*[A-Za-z0-9._%-]{16,}"),
    "phone_number": re.compile(rb"(?<!\d)010[- ]?\d{4}[- ]?\d{4}(?!\d)"),
}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main() -> int:
    names = {entry.decode("utf-8") for args in
             (("ls-files", "-z"), ("ls-files", "-o", "--exclude-standard", "-z"))
             for entry in git(*args).split(b"\0") if entry}
    findings: list[str] = []
    total = 0
    for name in sorted(names):
        if name.startswith(FORBIDDEN_PREFIXES) or name in FORBIDDEN_EXACT:
            findings.append(f"forbidden_path:{name}")
            continue
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            findings.append(f"missing_or_symlink:{name}")
            continue
        if path.stat().st_size > 50_000_000:
            findings.append(f"oversize:{name}")
            continue
        payload = path.read_bytes()
        total += len(payload)
        findings.extend(f"{rule}:{name}" for rule, pattern in PATTERNS.items()
                        if pattern.search(payload))
    print(f"candidate_files={len(names)} candidate_bytes={total} findings={len(findings)}")
    for finding in findings:
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
