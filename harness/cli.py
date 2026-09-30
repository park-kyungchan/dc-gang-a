#!/usr/bin/env python3
"""Deterministic Dual-Runtime Harness CLI (Python 3.12 stdlib).

Provides instantaneous (<50ms), fail-closed queries for the Daechi Whole-Lens cohort
and 54 canonical LMS backend routes without grepping directories or probing networks.

Invariants:
- Dual-Runtime Parity: 1:1 structural and behavioral parity with harness/cli.ts
- SLA: Strictly <50ms execution (RUB-06)
- Machine Output: --json emits pure, unpolluted JSON (RUB-08)
- Windows UTF-8 Safety: Explicit UTF-8 reconfiguration preventing CP949 errors (RUB-09)
- Cwd Independence: Anchored path resolution independent of working directory (RUB-10)
- Privacy Guard: Zero network requests, zero session discovery (RUB-11)
- Zero-Grep Governance: SSoT query tool for agents (RUB-12)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Windows UTF-8 Safety (RUB-09)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Cwd Independence (RUB-10): anchor import root strictly to repository root
REPO_ROOT: Path = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from workbench_v2.canonical_entities import (  # noqa: E402
    CanonicalLookupError,
    find_group,
    find_student_by_id,
    find_student_by_name,
    get_all_groups,
    get_all_students,
    get_cohort_students,
    get_group,
    get_student_by_id,
    get_students_by_group,
    get_teacher,
)
from harness.routes import (  # noqa: E402
    RouteLookupError,
    UnsafeMutatingOperationError,
    assert_safe_read,
    get_all_routes,
    get_route,
    has_route,
    is_safe_read,
)


def handle_roster(args: argparse.Namespace) -> int:
    """Handle deterministic roster queries."""
    teacher = get_teacher()
    matching_students = []
    matching_groups = []

    if args.id:
        student = find_student_by_id(args.id)
        if not student:
            sys.stderr.write(f"Error: Student not found for ID '{args.id}'\n")
            return 1
        matching_students = [student]
        if student.group_id:
            grp = find_group(student.group_id)
            if grp:
                matching_groups = [grp]
        if not matching_groups:
            matching_groups = get_all_groups()
    elif args.student:
        student = find_student_by_name(args.student)
        if not student:
            sys.stderr.write(f"Error: Student not found for name '{args.student}'\n")
            return 1
        matching_students = [student]
        if student.group_id:
            grp = find_group(student.group_id)
            if grp:
                matching_groups = [grp]
        if not matching_groups:
            matching_groups = get_all_groups()
    elif args.group:
        group = find_group(args.group)
        if not group:
            sys.stderr.write(f"Error: Group not found for ID '{args.group}'\n")
            return 1
        matching_groups = [group]
        matching_students = get_students_by_group(args.group)
    elif args.all or (not args.id and not args.student and not args.group):
        matching_students = get_all_students(include_test=True)
        matching_groups = get_all_groups()

    if args.json:
        payload: dict[str, Any] = {
            "teacher": {
                "teacherPriNo": teacher.teacher_pri_no,
                "teacherId": teacher.teacher_id,
                "name": teacher.name,
                "academy": teacher.academy,
                "branch": teacher.branch,
                "sheetTabGid": teacher.sheet_tab_gid,
            },
            "students": [
                {
                    "studentId": s.student_id,
                    "name": s.name,
                    "loginId": s.login_id,
                    "grade": s.grade,
                    "schoolGrade": s.school_grade,
                    "group": s.group,
                    "groupId": s.group_id,
                    "groupName": s.group_name,
                    "courseSeq": s.course_seq,
                    "cmSeq": s.cm_seq,
                    "primaryBook": s.primary_book,
                    "secondaryBook": s.secondary_book,
                    "isTest": s.is_test,
                }
                for s in matching_students
            ],
            "groups": [
                {
                    "groupId": g.group_id,
                    "id": g.id,
                    "name": g.name,
                    "days": list(g.days),
                    "time": g.time,
                }
                for g in matching_groups
            ],
        }
        sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        return 0

    # Plain text formatted output
    day_map = {1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일"}
    lines = [
        "=== CANONICAL ROSTER ===",
        f"Teacher: {teacher.name} (PriNo: {teacher.teacher_pri_no}, Academy: {teacher.academy}, Branch: {teacher.branch}, Sheet Tab GID: {teacher.sheet_tab_gid})",
        "",
        f"Groups ({len(matching_groups)}):",
    ]
    for g in matching_groups:
        days_str = ", ".join(day_map.get(d, str(d)) for d in g.days)
        lines.append(f"  [Group {g.group_id}] {g.name} (Days: {days_str} | Time: {g.time})")

    lines.append("")
    lines.append(f"Students ({len(matching_students)}):")
    for s in matching_students:
        test_tag = " [TEST ACCOUNT]" if s.is_test else ""
        grp_display = s.group_name or s.group_id or "None"
        grade_display = s.grade or "N/A"
        lines.append(f"  - [{s.student_id}] {s.name} (Group: {grp_display}, Login: {s.login_id}, Grade: {grade_display}{test_tag})")

    sys.stdout.write("\n".join(lines) + "\n")
    return 0


def handle_routes(args: argparse.Namespace) -> int:
    """Handle deterministic route queries."""
    matching_routes = []

    if args.id:
        r_id_lower = args.id.lower()
        matching_routes = [r for r in get_all_routes() if r.id.lower() == r_id_lower]
        if not matching_routes and has_route(args.id):
            matching_routes = [get_route(args.id)]
        if not matching_routes:
            sys.stderr.write(f"Error: Route not found for ID '{args.id}'\n")
            return 1
    elif args.op:
        op_lower = args.op.lower()
        matching_routes = [r for r in get_all_routes() if r.operation.lower() == op_lower]
        if not matching_routes and has_route(args.op):
            matching_routes = [get_route(args.op)]
        if not matching_routes:
            sys.stderr.write(f"Error: Route not found for operation '{args.op}'\n")
            return 1
    else:
        matching_routes = get_all_routes()

    if args.category:
        cat_lower = args.category.lower()
        matching_routes = [r for r in matching_routes if r.category.lower() == cat_lower]
        if not matching_routes:
            sys.stderr.write(f"Error: No routes found for category '{args.category}'\n")
            return 1

    if args.safe_only:
        matching_routes = [r for r in matching_routes if is_safe_read(r.id)]

    if args.json:
        payload = {
            "total": len(matching_routes),
            "routes": [
                {
                    "id": r.id,
                    "routeTemplate": r.route_template,
                    "operation": r.operation,
                    "httpMethod": r.http_method,
                    "semanticEffect": r.semantic_effect,
                    "safeToProbe": r.safe_to_probe,
                    "isSafeRead": is_safe_read(r.id),
                    "category": r.category,
                    "joinKeyNames": list(r.join_key_names),
                    "requiredParams": list(r.join_key_names),
                    "optionalParams": [],
                    "reason": r.reason,
                }
                for r in matching_routes
            ],
        }
        sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        return 0

    # Plain-text formatted output
    lines = [
        "=== LMS ROUTE REGISTRY ===",
        f"Total Routes: {len(matching_routes)}",
        "",
    ]
    for r in matching_routes:
        safe_read = "YES" if is_safe_read(r.id) else "NO"
        safe_probe = "YES" if r.safe_to_probe else "NO"
        lines.append(f"[{r.id}]")
        lines.append(f"  Operation: {r.operation}")
        lines.append(f"  Method: {r.http_method or 'N/A'}")
        lines.append(f"  Effect: {r.semantic_effect} (Safe Read: {safe_read}, Safe to Probe: {safe_probe})")
        lines.append(f"  Category: {r.category}")
        lines.append(f"  Template: {r.route_template}")
        if r.join_key_names:
            lines.append(f"  Join Keys: {', '.join(r.join_key_names)}")
        if r.reason:
            lines.append(f"  Reason: {r.reason}")
        lines.append("")

    sys.stdout.write("\n".join(lines))
    return 0


def handle_verify(args: argparse.Namespace) -> int:
    """Handle comprehensive harness verification."""
    checks = {
        "teacher": False,
        "cohortCount": 0,
        "groupCount": 0,
        "routeCount": 0,
        "failClosedStudent": False,
        "failClosedMutatingGet": False,
    }
    errors: list[str] = []

    # 1. Verify Teacher
    try:
        teacher = get_teacher()
        if teacher.teacher_pri_no == "1292923" and teacher.name == "박경찬":
            checks["teacher"] = True
        else:
            errors.append(f"Invalid teacher: priNo={teacher.teacher_pri_no}, name={teacher.name}")
    except Exception as err:
        errors.append(f"Teacher lookup failed: {err}")

    # 2. Verify Cohort
    try:
        cohort = get_cohort_students()
        checks["cohortCount"] = len(cohort)
        required_ids = {"1293032", "1294174", "1293067", "1293138", "1294575"}
        actual_ids = {s.student_id for s in cohort}
        missing = required_ids - actual_ids
        if missing:
            errors.append(f"Missing required cohort students: {missing}")

        test_student = find_student_by_id("1235920")
        if not test_student or not test_student.is_test:
            errors.append("Test account 1235920 missing or not marked is_test=True")
    except Exception as err:
        errors.append(f"Cohort verification failed: {err}")

    # 3. Verify Groups
    try:
        groups = get_all_groups()
        checks["groupCount"] = len(groups)
        group_ids = sorted(g.group_id for g in groups)
        if group_ids != ["1", "2", "3", "4", "5"]:
            errors.append(f"Expected groups ['1', '2', '3', '4', '5'], got: {group_ids}")
    except Exception as err:
        errors.append(f"Groups verification failed: {err}")

    # 4. Verify Routes
    try:
        routes = get_all_routes()
        checks["routeCount"] = len(routes)
        if len(routes) != 54:
            errors.append(f"Expected 54 routes, got: {len(routes)}")
    except Exception as err:
        errors.append(f"Route count verification failed: {err}")

    # 5. Verify Fail-Closed Guards
    try:
        unknown = find_student_by_id("unknown_student_9999")
        threw_student = False
        try:
            get_student_by_id("unknown_student_9999")
        except CanonicalLookupError:
            threw_student = True

        if unknown is None and threw_student:
            checks["failClosedStudent"] = True
        else:
            errors.append("Fail-closed student lookup invariant failed")

        mutating_get_safe = is_safe_read("day_record_udtprg")
        threw_mutating_get = False
        try:
            assert_safe_read("day_record_udtprg")
        except UnsafeMutatingOperationError:
            threw_mutating_get = True

        if not mutating_get_safe and threw_mutating_get:
            checks["failClosedMutatingGet"] = True
        else:
            errors.append("Fail-closed mutating GET guard invariant failed")
    except Exception as err:
        errors.append(f"Fail-closed guard verification failed: {err}")

    all_passed = len(errors) == 0

    if args.json:
        payload = {
            "verified": all_passed,
            "checks": checks,
            "errors": errors if not all_passed else [],
            "message": (
                "All canonical entities, routes, and safety guards verified successfully."
                if all_passed
                else f"Verification failed with {len(errors)} error(s)."
            ),
        }
        sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        return 0 if all_passed else 1

    # Plain text output
    lines = ["=== HARNESS DETERMINISTIC VERIFICATION ==="]
    lines.append("[PASS] Canonical Teacher: 박경찬 (1292923)" if checks["teacher"] else "[FAIL] Canonical Teacher")
    cohort_ok = checks["cohortCount"] == 5 and not any("cohort" in e for e in errors)
    lines.append("[PASS] Cohort Students: 5 verified (Shin Ji-woo, Lee Ru-han, Park Se-eun, Yoo Ji-yeon, Lee Hyun-seung)" if cohort_ok else f"[FAIL] Cohort Students (Count: {checks['cohortCount']})")
    lines.append("[PASS] Groups: 5 verified (Groups 1, 2, 3, 4, 5)" if checks["groupCount"] == 5 else f"[FAIL] Groups (Count: {checks['groupCount']})")
    lines.append("[PASS] Routes: 54 canonical routes loaded" if checks["routeCount"] == 54 else f"[FAIL] Routes (Count: {checks['routeCount']})")
    lines.append("[PASS] Fail-Closed Guard: Unknown student query rejected" if checks["failClosedStudent"] else "[FAIL] Fail-Closed Guard: Student")
    lines.append("[PASS] Fail-Closed Guard: Mutating GET endpoints blocked from read probing" if checks["failClosedMutatingGet"] else "[FAIL] Fail-Closed Guard: Mutating GET")

    if all_passed:
        lines.append("")
        lines.append("All harness verifications passed (0 errors).")
        sys.stdout.write("\n".join(lines) + "\n")
        return 0
    else:
        lines.append("")
        lines.append(f"Verification FAILED with {len(errors)} error(s):")
        for err in errors:
            lines.append(f"  - {err}")
        sys.stderr.write("\n".join(lines) + "\n")
        return 1


def main(argv: list[str] | None = None) -> int:
    """CLI Entrypoint supporting roster, routes, and verify subcommands."""
    parser = argparse.ArgumentParser(
        prog="harness",
        description="Daechi Whole-Lens Harness CLI (Zero-Grep Deterministic SSoT)",
    )
    subparsers = parser.add_subparsers(dest="subcommand", help="Available subcommands")

    # Subcommand: roster
    roster_parser = subparsers.add_parser("roster", help="Query canonical teacher, cohort students, and groups")
    roster_parser.add_argument("--id", dest="id", help="Query student by ID")
    roster_parser.add_argument("--student", dest="student", help="Query student by name")
    roster_parser.add_argument("--group", dest="group", help="Query class group by ID")
    roster_parser.add_argument("--all", dest="all", action="store_true", help="List teacher, all students, and all groups")
    roster_parser.add_argument("--json", dest="json", action="store_true", help="Output clean, parseable JSON")

    # Subcommand: routes
    routes_parser = subparsers.add_parser("routes", help="Query LMS backend route registry (54 canonical routes)")
    routes_parser.add_argument("--id", dest="id", help="Query route by ID")
    routes_parser.add_argument("--op", dest="op", help="Query route by operation name")
    routes_parser.add_argument("--category", dest="category", help="Filter routes by category")
    routes_parser.add_argument("--safe-only", dest="safe_only", action="store_true", help="Filter only safe read routes")
    routes_parser.add_argument("--all", dest="all", action="store_true", help="List all routes")
    routes_parser.add_argument("--json", dest="json", action="store_true", help="Output clean, parseable JSON")

    # Subcommand: verify
    verify_parser = subparsers.add_parser("verify", help="Run automated health & safety checks")
    verify_parser.add_argument("--json", dest="json", action="store_true", help="Output clean, parseable JSON")

    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 0

    if not args.subcommand:
        parser.print_help()
        return 0

    if args.subcommand == "roster":
        return handle_roster(args)
    elif args.subcommand == "routes":
        return handle_routes(args)
    elif args.subcommand == "verify":
        return handle_verify(args)
    else:
        sys.stderr.write(f"Error: Unknown subcommand '{args.subcommand}'\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
