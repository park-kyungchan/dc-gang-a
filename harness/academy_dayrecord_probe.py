"""One bounded, direct LMS read for the 2026-09-21 DayRecord structure.

Default mode is a no-network contract check. Live mode requires --live and
either an authorized GANGA_JSESSIONID in this process environment or the
explicit --prompt-auth option. It never discovers browser cookies, saves a
session value, or prints source records.
"""

from __future__ import annotations

import argparse
import contextlib
import getpass
import hashlib
import io
import json
import logging
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOCK = ROOT / "academy_source_lock.json"
EXPECTED_COMPANION = Path.home() / "Desktop" / "강의하는아이들_대치점_자동화"
ALLOWED_SOURCE_FILES = frozenset({
    "ganga/lms/session.py", "ganga/lms/reader.py", "ganga/lms/endpoints.py",
})
LESSON_DATE = "2026-09-21"
EXPECTED_TEACHER = ("1680", "1292923", "박경찬")


def source_status() -> tuple[Path, list[str]]:
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    companion = Path(lock["companion_repo"])
    if (companion.resolve() != EXPECTED_COMPANION.resolve()
            or frozenset(lock["files"]) != ALLOWED_SOURCE_FILES):
        return EXPECTED_COMPANION, ["source_lock_scope"]
    drift = []
    for name, expected in lock["files"].items():
        target = companion / name
        if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest().upper() != expected:
            drift.append(name)
    return companion, drift


def emit(**fields: object) -> None:
    print(json.dumps(fields, ensure_ascii=True, sort_keys=True))


def load_contract(companion: Path):
    sys.path.insert(0, str(companion))
    from ganga.lms.reader import read_day_record
    from ganga.lms.session import LmsSession
    return LmsSession, read_day_record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="perform one authorized LMS read")
    parser.add_argument("--prompt-auth", action="store_true",
                        help="read one session value from a hidden terminal prompt, never save it")
    parser.add_argument("--check-imports", action="store_true",
                        help="verify companion reader imports without authentication or network")
    args = parser.parse_args()
    if args.prompt_auth and not args.live:
        parser.error("--prompt-auth requires --live")
    if args.check_imports and args.live:
        parser.error("--check-imports and --live are separate modes")
    companion, drift = source_status()
    if drift:
        emit(status="blocked", reason="companion_source_drift", paths=drift)
        return 2
    if args.check_imports:
        logging.disable(logging.CRITICAL)
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                load_contract(companion)
        except Exception as exc:
            emit(status="blocked", reason=type(exc).__name__)
            return 2
        emit(status="import_verified", network_effect="none", auth_access="none")
        return 0
    if not args.live:
        emit(status="contract_verified_offline", operation="POST DayRecordServlet p_process=Main",
             lesson_date=LESSON_DATE, group="0", network_effect="none")
        return 0
    if not args.prompt_auth and not os.environ.get("GANGA_JSESSIONID"):
        emit(status="blocked", reason="ephemeral_auth_unavailable")
        return 2
    one_time_cookie = getpass.getpass("Academy session for this one read: ") if args.prompt_auth else None
    if args.prompt_auth and not one_time_cookie:
        emit(status="blocked", reason="empty_ephemeral_auth")
        return 2
    logging.disable(logging.CRITICAL)
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            LmsSession, read_day_record = load_contract(companion)

            with LmsSession(cookie=one_time_cookie,
                            order=() if args.prompt_auth else ("env",),
                            timeout=20, retries=0) as lms:
                teacher = lms.teacher
                if (teacher.fran_no, teacher.pri_no, teacher.name) != EXPECTED_TEACHER:
                    raise RuntimeError("teacher_identity_mismatch")
                page = read_day_record(lms, LESSON_DATE, grp_seq="0")
                if page.date != LESSON_DATE or page.grp_seq != "0":
                    raise RuntimeError("read_target_mismatch")
                if len(page.groups) > 10 or len(page.records) > 20:
                    raise RuntimeError("read_scope_exceeded")
                keys_complete = all(
                    row.course_seq and row.stu_pri_no and row.record_seq and row.cm_seq
                    for row in page.records
                )
                result = (len(page.groups), len(page.records), keys_complete)
    except Exception as exc:
        emit(status="blocked", reason=type(exc).__name__)
        return 2
    emit(status="verified_read", operation="POST DayRecordServlet p_process=Main",
         lesson_date=LESSON_DATE, group="0", teacher_scope="verified",
         group_choices=result[0], row_count=result[1], row_keys_complete=result[2],
         student_values_emitted=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
