#!/usr/bin/env python3
"""Named, bounded academy reads for a low-context agent.

`plan` needs no network or credential. `read` currently supports only an exact
DayRecord row and accepts a session through stdin or an explicitly selected
environment variable. It never discovers browser cookies or prints raw rows.
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
import re
import sys
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from harness.routes import get_route  # noqa: E402
from workbench_v2.canonical_entities import get_all_students, get_group, get_teacher  # noqa: E402


FACTS = {
    "class_schedule": {
        "route_ids": ["course_schedule"],
        "read_state": "blocked_schedule_row_date_status_join_unverified",
    },
    "day_record": {
        "route_ids": ["day_record_read"],
        "read_state": "implemented_observed_row",
    },
    "previous_homework": {
        "route_ids": ["course_schedule", "day_record_read"],
        "read_state": "blocked_previous_occurrence_join_unverified",
    },
    "prestudy_upload": {
        "route_ids": ["prestudy_waiting_search", "prestudy_completed_search"],
        "read_state": "blocked_student_submission_join_and_read_effect_unverified",
    },
    "problem_attempts": {
        "route_ids": ["smartbook_result_search"],
        "read_state": "blocked_app_attempt_join_and_read_effect_unverified",
    },
    "automatic_grading": {
        "route_ids": ["smartbook_result_search"],
        "read_state": "blocked_attempt_grading_join_unverified",
    },
    "wrong_answer_video": {
        "route_ids": ["video_lookup"],
        "read_state": "blocked_video_lookup_effect_and_correction_join_unverified",
    },
    "textbook_samples": {
        "route_ids": ["textbook_main", "textbook_answer_catalog", "textbook_sample_pdf"],
        "read_state": "blocked_student_book_assignment_unverified",
    },
    "page_progress": {
        "route_ids": ["day_record_read"],
        "read_state": "blocked_teacher_page_events_required",
    },
    "weekly_plan": {
        "route_ids": ["course_schedule", "day_record_read", "textbook_main",
                      "smartbook_result_search"],
        "read_state": "blocked_calendar_edition_page_audit_personal_pace_joins_unverified",
    },
    "report_preview": {
        "route_ids": ["daily_report_preview"],
        "read_state": "blocked_report_occurrence_join_unverified",
    },
}
TEXT_FIELDS = {"progress": "progress_text", "homework": "homework_text",
               "memo": "memo_text", "student_memo": "student_memo"}
SCALAR_FIELDS = {"attendance": "attendance", "daily_test": "daily_test",
                 "homework_rate": "homework_rate"}
ALLOWED_FIELDS = frozenset((*TEXT_FIELDS, *SCALAR_FIELDS))
SOURCE_FILES = ("ganga/lms/session.py", "ganga/lms/reader.py",
                "ganga/lms/endpoints.py")
PAGE_RANGE = re.compile(
    r"(?<!\w)(?:p|pp|page|pages)\.?\s*(\d{1,3})\s*(?:~|-|–|—|부터)\s*"
    r"(?:(?:p|pp|page|pages)\.?\s*)?(\d{1,3})(?!\d)", re.I)
SINGLE_PAGE = re.compile(r"(?<!\w)p(?:age)?\.?\s*(\d{1,3})(?!\d|\s*(?:~|–|-))", re.I)


class ReadBlocked(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ReadBlocked("invalid_arguments")


class _DayRecordScopeParser(HTMLParser):
    """Read only response-derived date and explicitly selected group."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.dates: list[str] = []
        self.selected_groups: list[str] = []
        self.in_group_select = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "input" and (attributes.get("id") == "std_ymd"
                               or attributes.get("name") == "std_ymd"):
            self.dates.append(attributes.get("value") or "")
        if tag == "select" and (attributes.get("id") in ("grp_seq", "sel_grp_seq")
                                or attributes.get("name") in ("grp_seq", "sel_grp_seq")):
            self.in_group_select = True
        if tag == "option" and self.in_group_select and "selected" in attributes:
            self.selected_groups.append(attributes.get("value") or "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "select":
            self.in_group_select = False


def response_scope(html: str) -> tuple[str, str]:
    parser = _DayRecordScopeParser()
    parser.feed(html)
    if len(parser.dates) != 1 or len(parser.selected_groups) != 1:
        raise ReadBlocked("response_scope_unproven")
    return parser.dates[0], parser.selected_groups[0]


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")


def resolve_student(student_id: str):
    matches = [student for student in get_all_students(include_test=False)
               if student.student_id == student_id]
    if len(matches) != 1:
        raise ReadBlocked("unknown_student")
    student = matches[0]
    if not student.group_id or not student.course_seq or not student.cm_seq:
        raise ReadBlocked("student_scope_incomplete")
    return student


def resolve_group(group_id: str | None, student: Any):
    selected_id = group_id or student.group_id
    try:
        return get_group(selected_id)
    except Exception as exc:
        raise ReadBlocked("unknown_group") from exc


def parse_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ReadBlocked("invalid_date") from exc
    if parsed.isoformat() != value:
        raise ReadBlocked("invalid_date")
    return value


def scheduled_dates_after_claim(*, claimed_date: str, current_date: str,
                                group: Any) -> list[str]:
    claimed = date.fromisoformat(parse_date(claimed_date))
    current = date.fromisoformat(parse_date(current_date))
    if claimed >= current:
        raise ReadBlocked("invalid_prior_date_order")
    if (current - claimed).days > 45:
        raise ReadBlocked("prior_date_window_exceeded")
    dates: list[str] = []
    cursor = current - timedelta(days=1)
    while cursor > claimed:
        if cursor.isoweekday() in group.days:
            dates.append(cursor.isoformat())
        cursor -= timedelta(days=1)
    if len(dates) > 12:
        raise ReadBlocked("prior_date_scope_exceeded")
    return dates


def page_range_candidates(text: str) -> list[dict[str, int]]:
    """Extract candidate page intervals without claiming a textbook binding."""
    found: set[tuple[int, int]] = set()
    for match in PAGE_RANGE.finditer(text):
        first, last = int(match[1]), int(match[2])
        if 1 <= first <= last and last - first <= 499:
            found.add((first, last))
    for match in SINGLE_PAGE.finditer(text):
        page = int(match[1])
        if page >= 1 and not any(first <= page <= last for first, last in found):
            found.add((page, page))
    if len(found) > 20:
        raise ReadBlocked("page_range_scope_exceeded")
    return [{"first": first, "last": last} for first, last in sorted(found)]


def homework_line_candidates(text: str) -> list[dict[str, Any]]:
    """Expose only line numbers, explicit series tokens, and page candidates."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) > 20:
        raise ReadBlocked("homework_line_scope_exceeded")
    tokens = {"primary": ("가우스", "gauss"),
              "secondary": ("다빈치", "davinci")}
    result: list[dict[str, Any]] = []
    for index, line in enumerate(lines, start=1):
        lower = line.casefold()
        mentions = [book for book, variants in tokens.items()
                    if any(token in lower for token in variants)]
        ranges = page_range_candidates(line)
        if mentions or ranges:
            result.append({"line": index, "bookSeriesMentions": mentions,
                           "pageRangeCandidates": ranges})
    return result


def _source_verified() -> None:
    try:
        manifest = json.loads((ROOT / "docs/source-import-manifest.json").read_text(encoding="utf-8"))
        component = next((item for item in manifest["components"]
                          if item["name"] == "lms-automation"), None)
        if component is None:
            raise ReadBlocked("reader_source_unpinned")
        for relative in SOURCE_FILES:
            expected = component["files"].get(relative)
            source = ROOT / "lms-automation" / relative
            if not isinstance(expected, str) or not source.is_file():
                raise ReadBlocked("reader_source_unpinned")
            if hashlib.sha256(source.read_bytes()).hexdigest().lower() != expected.lower():
                raise ReadBlocked("reader_source_drift")
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
        raise ReadBlocked("reader_source_manifest_invalid") from exc


def _checked_day_record_route() -> None:
    route = get_route("day_record_read")
    if (route.semantic_effect != "read" or route.http_method != "POST"
            or route.operation != "Main"
            or route.servlet_path != "/servlet/controller.cct.tutor.DayRecordServlet"):
        raise ReadBlocked("unsafe_or_drifted_route")


def summarize_day_record(*, student: Any, lesson_date: str,
                         page: Any, requested_fields: tuple[str, ...],
                         record_seq: str | None, read_at: str,
                         observed_scope: tuple[str, str], group: Any = None) -> dict[str, Any]:
    group = group or resolve_group(None, student)
    if observed_scope != (lesson_date.replace("-", ""), group.group_id):
        raise ReadBlocked("response_scope_mismatch")
    groups = [option for option in page.groups if option.value == group.group_id]
    if len(groups) != 1 or groups[0].label.strip() != group.name.strip():
        raise ReadBlocked("group_join_unverified")
    teacher = get_teacher()
    if not page.teacher_pri_no or page.teacher_pri_no != teacher.teacher_pri_no:
        raise ReadBlocked("teacher_scope_mismatch")
    if len(page.records) > 25:
        raise ReadBlocked("response_scope_exceeded")
    matches = [row for row in page.records if row.stu_pri_no == student.student_id]
    if record_seq is not None:
        matches = [row for row in matches if row.record_seq == record_seq]
    if len(matches) == 0:
        raise ReadBlocked("target_row_not_found")
    if len(matches) != 1:
        raise ReadBlocked("ambiguous_occurrence")
    row = matches[0]
    if not all((row.course_seq, row.stu_pri_no, row.record_seq, row.cm_seq)):
        raise ReadBlocked("row_keys_incomplete")
    if row.course_seq != student.course_seq or row.cm_seq != student.cm_seq:
        raise ReadBlocked("canonical_course_join_mismatch")
    fields: dict[str, Any] = {}
    for field in requested_fields:
        if field in TEXT_FIELDS:
            value = str(getattr(row, TEXT_FIELDS[field]) or "")
            fields[field] = {
                "state": "present" if value else "empty",
            }
            if field == "homework":
                fields[field]["pageRangeCandidates"] = page_range_candidates(value)
                fields[field]["lineCandidates"] = homework_line_candidates(value)
                fields[field]["bookBinding"] = "unverified"
        else:
            value = getattr(row, SCALAR_FIELDS[field])
            fields[field] = {"state": "present" if value not in (None, "") else "empty",
                             "value": value if value not in (None, "") else None}
    return {
        "status": "observed_row",
        "fact": "day_record",
        "scope": {"studentId": student.student_id, "lessonDate": lesson_date,
                  "groupId": group.group_id, "courseSeq": row.course_seq,
                  "recordSeq": row.record_seq, "cmSeq": row.cm_seq},
        "source": {"routeId": "day_record_read", "readAt": read_at,
                   "rowCountInGroup": len(page.records),
                   "coverage": "selected_page_only",
                   "occurrenceBinding": "unverified",
                   "historicalGroupBinding": ("unverified" if group.group_id != student.group_id
                                              else "current_roster_only")},
        "fields": fields,
        "rawStudentTextEmitted": False,
    }


def plan(fact: str, student: Any, lesson_date: str, group: Any = None) -> dict[str, Any]:
    group = group or resolve_group(None, student)
    recipe = FACTS[fact]
    read_state = recipe["read_state"]
    if fact == "day_record":
        try:
            _checked_day_record_route()
            _source_verified()
            import importlib.util
            if importlib.util.find_spec("scrapling") is None:
                read_state = "reader_environment_missing"
        except ReadBlocked as exc:
            read_state = exc.code
    return {
        "status": "ready" if read_state == "implemented_observed_row" else "blocked",
        "fact": fact,
        "scope": {"studentId": student.student_id, "lessonDate": lesson_date,
                  "groupId": group.group_id},
        "routeIds": recipe["route_ids"],
        "readState": read_state,
        "nextCommand": (f'"{sys.executable}" -B harness/academy.py read --fact day_record --student-id '
                        f"{student.student_id} --date {lesson_date} --group-id {group.group_id} "
                        "--session-stdin")
                       if fact == "day_record" and read_state == "implemented_observed_row" else None,
    }


def read_day_record_exact(*, student: Any, lesson_date: str,
                          requested_fields: tuple[str, ...],
                          record_seq: str | None, cookie: str,
                          group: Any = None) -> dict[str, Any]:
    group = group or resolve_group(None, student)
    _checked_day_record_route()
    _source_verified()
    sys.path.insert(0, str(ROOT / "lms-automation"))
    try:
        from ganga.lms.endpoints import BASE_URL, DAY_RECORD_READ
        from ganga.lms.reader import parse_day_record
        from ganga.lms.session import LmsSession
    except (ImportError, ModuleNotFoundError) as exc:
        raise ReadBlocked("reader_environment_missing") from exc
    previous_logging_disable = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with LmsSession(cookie=cookie, order=(), timeout=20, retries=0) as lms:
                teacher = lms.teacher
                expected = get_teacher()
                if (not teacher.fran_no or teacher.pri_no != expected.teacher_pri_no
                        or teacher.name != expected.name):
                    raise ReadBlocked("teacher_identity_mismatch")
                response = lms.post(
                    f"{BASE_URL}/servlet/{DAY_RECORD_READ['servlet']}",
                    data={"p_process": "Main", "std_ymd": lesson_date.replace("-", ""),
                          "grp_seq": group.group_id, "visit": "1",
                          "teacher_pri_no": "", "course_seq": ""},
                )
                observed_scope = response_scope(response.html_content)
                page = parse_day_record(response.html_content, date=lesson_date,
                                        grp_seq=group.group_id)
    except ReadBlocked:
        raise
    except Exception as exc:
        raise ReadBlocked("academy_read_failed") from exc
    finally:
        logging.disable(previous_logging_disable)
    return summarize_day_record(
        student=student, lesson_date=lesson_date, page=page,
        requested_fields=requested_fields, record_seq=record_seq,
        read_at=datetime.now(timezone.utc).isoformat(), observed_scope=observed_scope,
        group=group,
    )


def check_prior_claim(*, student: Any, group: Any, current_date: str,
                      claimed_date: str, cookie: str) -> dict[str, Any]:
    """One-sided LMS contradiction check over this group's regular weekdays."""
    if group.group_id != student.group_id:
        raise ReadBlocked("historical_group_schedule_unverified")
    candidates = scheduled_dates_after_claim(
        claimed_date=claimed_date, current_date=current_date, group=group)
    unknown_dates: list[str] = []
    for candidate in candidates:
        try:
            row = read_day_record_exact(
                student=student, group=group, lesson_date=candidate,
                requested_fields=("attendance",), record_seq=None, cookie=cookie)
        except ReadBlocked as exc:
            if exc.code == "target_row_not_found":
                unknown_dates.append(candidate)
                continue
            raise
        attendance = row["fields"]["attendance"]["value"]
        if attendance in ("Y", "L"):
            return {
                "status": "conflict_observed", "fact": "previous_lesson_claim",
                "scope": {"studentId": student.student_id, "groupId": group.group_id,
                          "currentDate": current_date, "claimedPreviousDate": claimed_date},
                "laterAttendedDate": candidate,
                "newerUnknownDates": unknown_dates,
                "evidence": "LMS_DayRecord_attendance_observed_row",
                "exactPreviousOccurrence": "unverified",
            }
        unknown_dates.append(candidate)
    return {
        "status": "unresolved", "fact": "previous_lesson_claim",
        "scope": {"studentId": student.student_id, "groupId": group.group_id,
                  "currentDate": current_date, "claimedPreviousDate": claimed_date},
        "checkedRegularDates": candidates,
        "newerUnknownDates": unknown_dates,
        "exactPreviousOccurrence": "unverified",
    }


def ephemeral_session(args: Any) -> str:
    if args.session_stdin:
        cookie = (getpass.getpass("Academy session for this read: ")
                  if sys.stdin.isatty() else sys.stdin.readline().strip())
    else:
        cookie = os.environ.get("GANGA_JSESSIONID", "")
    if not cookie:
        raise ReadBlocked("ephemeral_auth_unavailable")
    return cookie


def main(argv: list[str] | None = None) -> int:
    parser = JsonArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True,
                                parser_class=JsonArgumentParser)
    for command in ("plan", "read"):
        item = sub.add_parser(command)
        item.add_argument("--fact", required=True, choices=tuple(FACTS))
        item.add_argument("--student-id", required=True)
        item.add_argument("--date", required=True)
        item.add_argument("--group-id")
        if command == "read":
            item.add_argument("--fields", default="attendance,progress,homework")
            item.add_argument("--record-seq")
            auth = item.add_mutually_exclusive_group(required=True)
            auth.add_argument("--session-stdin", action="store_true")
            auth.add_argument("--session-env", action="store_true")
    prior = sub.add_parser("check-prior")
    prior.add_argument("--student-id", required=True)
    prior.add_argument("--date", required=True, help="Current lesson date")
    prior.add_argument("--claimed-date", required=True)
    prior.add_argument("--group-id")
    prior_auth = prior.add_mutually_exclusive_group(required=True)
    prior_auth.add_argument("--session-stdin", action="store_true")
    prior_auth.add_argument("--session-env", action="store_true")
    try:
        args = parser.parse_args(argv)
        student = resolve_student(args.student_id)
        lesson_date = parse_date(args.date)
        group = resolve_group(args.group_id, student)
        if args.command == "plan":
            emit(plan(args.fact, student, lesson_date, group=group))
            return 0
        if args.command == "check-prior":
            claimed_date = parse_date(args.claimed_date)
            scheduled_dates_after_claim(
                claimed_date=claimed_date, current_date=lesson_date, group=group)
            _checked_day_record_route()
            _source_verified()
            emit(check_prior_claim(
                student=student, group=group, current_date=lesson_date,
                claimed_date=claimed_date, cookie=ephemeral_session(args)))
            return 0
        if args.fact != "day_record":
            raise ReadBlocked(FACTS[args.fact]["read_state"])
        fields = tuple(field.strip() for field in args.fields.split(","))
        if not fields or any(field not in ALLOWED_FIELDS for field in fields) or len(set(fields)) != len(fields):
            raise ReadBlocked("invalid_field_selection")
        _checked_day_record_route()
        _source_verified()
        try:
            import importlib.util
            if importlib.util.find_spec("scrapling") is None:
                raise ReadBlocked("reader_environment_missing")
        except ReadBlocked:
            raise
        emit(read_day_record_exact(
            student=student, lesson_date=lesson_date, requested_fields=fields,
            record_seq=args.record_seq, cookie=ephemeral_session(args), group=group))
        return 0
    except ReadBlocked as exc:
        emit({"status": "blocked", "reason": exc.code})
        return 2
    except Exception:
        emit({"status": "blocked", "reason": "internal_error"})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
