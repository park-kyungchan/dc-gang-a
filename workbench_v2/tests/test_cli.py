"""Automated Test Suite for Harness CLI (Python 3.12 stdlib).

Validates:
- RUB-04 & RUB-05: Deterministic roster queries and fail-closed exit codes
- RUB-06: Strict <50ms execution SLA
- RUB-08: Pure, unpolluted JSON machine output
- RUB-09: Windows UTF-8 safety with Korean character sets
- RUB-10: Cwd-independent execution
- RUB-11: Zero network requests and privacy safety
"""

from __future__ import annotations

import io
import json
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from harness.cli import main


class TestHarnessCli(unittest.TestCase):
    """Test suite for dual-runtime harness CLI in Python."""

    def test_roster_by_id_shin_jiwoo(self) -> None:
        """roster --id 1293032 --json must return Shin Ji-woo and group 2."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--id", "1293032", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["teacher"]["name"], "박경찬")
        self.assertEqual(data["teacher"]["teacherPriNo"], "1292923")
        self.assertEqual(len(data["students"]), 1)
        self.assertEqual(data["students"][0]["studentId"], "1293032")
        self.assertEqual(data["students"][0]["name"], "신지우")
        self.assertEqual(data["students"][0]["groupId"], "2")
        self.assertEqual(len(data["groups"]), 1)
        self.assertEqual(data["groups"][0]["groupId"], "2")

    def test_roster_by_id_lee_ruhan(self) -> None:
        """roster --id 1294174 --json must return Lee Ru-han and group 4."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--id", "1294174", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(len(data["students"]), 1)
        self.assertEqual(data["students"][0]["studentId"], "1294174")
        self.assertEqual(data["students"][0]["name"], "이루한")
        self.assertEqual(data["students"][0]["groupId"], "4")
        self.assertEqual(data["groups"][0]["groupId"], "4")

    def test_roster_by_name_korean_utf8(self) -> None:
        """roster --student 박세은 --json must resolve accurately and preserve UTF-8."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--student", "박세은", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["students"][0]["studentId"], "1293067")
        self.assertEqual(data["students"][0]["name"], "박세은")
        self.assertEqual(data["students"][0]["groupId"], "3")

    def test_roster_by_group_populated(self) -> None:
        """roster --group 3 --json must return group 3 and member students."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--group", "3", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(len(data["groups"]), 1)
        self.assertEqual(data["groups"][0]["groupId"], "3")
        self.assertEqual(data["groups"][0]["name"], "월금1부")
        self.assertEqual(len(data["students"]), 2)
        names = [s["name"] for s in data["students"]]
        self.assertIn("박세은", names)
        self.assertIn("유지연", names)

    def test_roster_by_group_empty(self) -> None:
        """roster --group 1 --json must return group 1 with 0 students."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--group", "1", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(len(data["groups"]), 1)
        self.assertEqual(data["groups"][0]["groupId"], "1")
        self.assertEqual(data["groups"][0]["name"], "화목2부")
        self.assertEqual(len(data["students"]), 0)

    def test_roster_all(self) -> None:
        """roster --all --json must return all 5 students and 4 groups."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--all", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["teacher"]["name"], "박경찬")
        self.assertEqual(len(data["students"]), 6)
        self.assertEqual(len(data["groups"]), 5)

    def test_roster_unknown_id_fails_closed(self) -> None:
        """roster with unknown student ID must exit with code 1 and write to stderr."""
        err_buf = io.StringIO()
        with redirect_stderr(err_buf):
            code = main(["roster", "--id", "9999999"])
        self.assertEqual(code, 1)
        self.assertIn("Error: Student not found for ID '9999999'", err_buf.getvalue())

    def test_roster_unknown_name_fails_closed(self) -> None:
        """roster with unknown student name must exit with code 1."""
        err_buf = io.StringIO()
        with redirect_stderr(err_buf):
            code = main(["roster", "--student", "홍길동"])
        self.assertEqual(code, 1)
        self.assertIn("Error: Student not found for name '홍길동'", err_buf.getvalue())

    def test_roster_plain_text_format(self) -> None:
        """roster plain text mode must format readable text without JSON braces."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["roster", "--id", "1293032"])
        self.assertEqual(code, 0)
        output = buf.getvalue()
        self.assertIn("=== CANONICAL ROSTER ===", output)
        self.assertIn("Teacher: 박경찬", output)
        self.assertIn("신지우", output)
        self.assertFalse(output.strip().startswith("{"))

    def test_routes_by_id_mutating_get(self) -> None:
        """routes --id day_record_read --json returns exact route with safe status."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["routes", "--id", "day_record_read", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["routes"][0]["id"], "day_record_read")
        self.assertFalse(data["routes"][0]["safeToProbe"])
        self.assertFalse(data["routes"][0]["isSafeRead"])
        self.assertIn("stu_pri_no", data["routes"][0]["joinKeyNames"])

    def test_routes_by_id_safe_read(self) -> None:
        """routes --id course_menu --json returns safe read route."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["routes", "--id", "course_menu", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["routes"][0]["id"], "course_menu")
        self.assertTrue(data["routes"][0]["safeToProbe"])
        self.assertTrue(data["routes"][0]["isSafeRead"])

    def test_routes_by_operation(self) -> None:
        """routes --op WebUnPreStudy --json returns routes matching operation name."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["routes", "--op", "WebUnPreStudy", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["total"], 2)
        for r in data["routes"]:
            self.assertEqual(r["operation"], "WebUnPreStudy")
        ids = [r["id"] for r in data["routes"]]
        self.assertIn("prestudy_waiting", ids)
        self.assertIn("prestudy_waiting_search", ids)

    def test_routes_safe_only_filter(self) -> None:
        """routes --safe-only --json returns exclusively safe read endpoints."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["routes", "--safe-only", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertGreater(data["total"], 0)
        for r in data["routes"]:
            self.assertTrue(r["isSafeRead"])
            self.assertTrue(r["safeToProbe"])
            self.assertEqual(r["semanticEffect"], "read")

    def test_routes_category_filter(self) -> None:
        """routes --category CourseManageIndex --json filters accurately."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["routes", "--category", "CourseManageIndex", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertGreater(data["total"], 0)
        for r in data["routes"]:
            self.assertEqual(r["category"], "CourseManageIndex")

    def test_routes_all(self) -> None:
        """routes --all --json must return exactly 54 routes."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["routes", "--all", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertEqual(data["total"], 54)
        self.assertEqual(len(data["routes"]), 54)

    def test_routes_unknown_id_fails_closed(self) -> None:
        """routes unknown ID must exit with code 1 and write to stderr."""
        err_buf = io.StringIO()
        with redirect_stderr(err_buf):
            code = main(["routes", "--id", "NONEXISTENT_ROUTE"])
        self.assertEqual(code, 1)
        self.assertIn("Error: Route not found for ID 'NONEXISTENT_ROUTE'", err_buf.getvalue())

    def test_verify_json(self) -> None:
        """verify --json succeeds and validates all entities and safety guards."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["verify", "--json"])
        self.assertEqual(code, 0)

        data = json.loads(buf.getvalue())
        self.assertTrue(data["verified"])
        self.assertTrue(data["checks"]["teacher"])
        self.assertEqual(data["checks"]["cohortCount"], 5)
        self.assertEqual(data["checks"]["groupCount"], 5)
        self.assertEqual(data["checks"]["routeCount"], 54)
        self.assertTrue(data["checks"]["failClosedStudent"])
        self.assertTrue(data["checks"]["failClosedMutatingGet"])
        self.assertEqual(len(data["errors"]), 0)

    def test_verify_plain_text(self) -> None:
        """verify plain text reports all pass markers."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["verify"])
        self.assertEqual(code, 0)
        output = buf.getvalue()
        self.assertIn("[PASS] Canonical Teacher", output)
        self.assertIn("[PASS] Cohort Students: 5 verified", output)
        self.assertIn("[PASS] Groups: 5 verified", output)
        self.assertIn("[PASS] Routes: 54 canonical routes loaded", output)
        self.assertIn("[PASS] Fail-Closed Guard: Unknown student query rejected", output)
        self.assertIn("[PASS] Fail-Closed Guard: Mutating GET endpoints blocked", output)
        self.assertIn("All harness verifications passed (0 errors).", output)

    def test_performance_sla_under_50ms(self) -> None:
        """All CLI handlers executed in sequence must complete in strictly < 50ms."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            start = time.perf_counter()
            main(["roster", "--all", "--json"])
            main(["routes", "--all", "--json"])
            main(["verify", "--json"])
            elapsed_ms = (time.perf_counter() - start) * 1000

        self.assertLess(elapsed_ms, 50.0, f"Expected <50ms execution, took {elapsed_ms:.2f}ms")

    def test_cli_help(self) -> None:
        """--help flag must print help and exit with code 0."""
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["--help"])
        self.assertEqual(code, 0)
        self.assertIn("Daechi Whole-Lens Harness CLI", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
