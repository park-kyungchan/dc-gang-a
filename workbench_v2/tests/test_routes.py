"""Unit tests for Python LMS Route Engine (SSoT parity with TS lmsRouteRegistry).

Validates:
- RUB-02: Exactly 54 operations loaded and validated against schema.
- RUB-03: assert_safe_read strictly blocks mutating GET endpoints (udtPrg, udtHw, udtMemo, udtAttn, similar_paper_create).
- RUB-07: Dual runtime parity between TS and Python route engines.
- RUB-10: Cwd-independent path resolution.
"""

from __future__ import annotations

import unittest
from pathlib import Path

from harness.routes import (
    ROUTE_REGISTRY_PATH,
    LmsRouteDefinition,
    LmsRouteRegistry,
    RouteLookupError,
    UnsafeMutatingOperationError,
    assert_safe_read,
    get_all_routes,
    get_route,
    has_route,
    is_safe_read,
)


class TestLmsRoutes(unittest.TestCase):
    """Test suite for the 54 LMS reverse-engineered routes in Python."""

    def test_rub10_cwd_independent_path_resolution(self) -> None:
        """ROUTE_REGISTRY_PATH must resolve to an existing physical file regardless of cwd."""
        self.assertTrue(ROUTE_REGISTRY_PATH.is_file(), f"Path not found: {ROUTE_REGISTRY_PATH}")
        self.assertIn("research", str(ROUTE_REGISTRY_PATH))
        self.assertIn("route-registry.json", str(ROUTE_REGISTRY_PATH))

    def test_rub02_exactly_54_operations_loaded_and_validated(self) -> None:
        """Registry must contain exactly 54 valid operations conforming to schema."""
        routes = get_all_routes()
        self.assertEqual(len(routes), 54, "Must load exactly 54 routes")

        ids: set[str] = set()
        for r in routes:
            self.assertIsInstance(r, LmsRouteDefinition)
            self.assertTrue(r.id, "Route id must not be empty")
            self.assertNotIn(r.id, ids, f"Duplicate route id found: {r.id}")
            ids.add(r.id)

            self.assertTrue(r.route_template, "Route template must not be empty")
            self.assertTrue(r.operation, "Operation name must not be empty")
            self.assertIn(
                r.semantic_effect,
                {"read", "write", "send", "open_send_screen", "unknown"},
                f"Invalid semantic_effect: {r.semantic_effect}",
            )
            self.assertIsInstance(r.safe_to_probe, bool)
            self.assertIsInstance(r.join_key_names, tuple)
            self.assertIsInstance(r.source_refs, tuple)
            self.assertIsInstance(r.reason, str)

            # Property parity (camelCase)
            self.assertEqual(r.routeId, r.id)
            self.assertEqual(r.routeTemplate, r.route_template)
            self.assertEqual(r.httpMethod, r.http_method)
            self.assertEqual(r.semanticEffect, r.semantic_effect)
            self.assertEqual(r.safeToProbe, r.safe_to_probe)
            self.assertEqual(r.joinKeyNames, r.join_key_names)
            self.assertEqual(r.sourceRefs, r.source_refs)
            self.assertEqual(r.evidenceGrade, r.evidence_grade)
            self.assertEqual(r.evidenceDate, r.evidence_date)

        self.assertEqual(len(ids), 54)

    def test_rub03_assert_safe_read_strictly_blocks_mutating_get_endpoints(self) -> None:
        """assert_safe_read must strictly block mutating GET endpoints with UnsafeMutatingOperationError."""
        mutating_cases = [
            ("day_record_udtprg", "udtPrg"),
            ("day_record_udthw", "udtHw"),
            ("day_record_udtmemo", "udtMemo"),
            ("day_record_udtattn", "udtAttn"),
            ("similar_paper_create", "incorrect.create"),
        ]

        for route_id, op_name in mutating_cases:
            # By ID
            self.assertFalse(is_safe_read(route_id), f"{route_id} should not be safe read")
            with self.assertRaises(UnsafeMutatingOperationError, msg=f"{route_id} must raise"):
                assert_safe_read(route_id)

            # By Operation name
            self.assertFalse(is_safe_read(op_name), f"{op_name} should not be safe read")
            with self.assertRaises(UnsafeMutatingOperationError, msg=f"{op_name} must raise"):
                assert_safe_read(op_name)

    def test_rub03_assert_safe_read_blocks_get_endpoints_with_safe_to_probe_false(self) -> None:
        """assert_safe_read must block GET endpoints that have safe_to_probe=False even if semantic_effect=read."""
        unsafe_get_reads = ["daily_report_preview", "dtzt_list"]
        for route_id in unsafe_get_reads:
            self.assertFalse(is_safe_read(route_id))
            with self.assertRaises(UnsafeMutatingOperationError):
                assert_safe_read(route_id)

    def test_textbook_answer_catalog_has_bounded_live_structure_classification(self) -> None:
        route = get_route("textbook_answer_catalog")
        self.assertEqual(route.route_template, "/servlet/controller.coursemanage.CourseManageServlet?reqCmd=GaStudyAnswer")
        self.assertEqual(route.http_method, "GET")
        self.assertEqual(route.semantic_effect, "read")
        self.assertEqual(route.evidence_grade, "live-structure")
        self.assertEqual(route.evidence_date, "2026-09-29")
        self.assertIn("student book assignment remain unverified", route.reason)
        self.assertTrue(route.safe_to_probe)
        self.assertEqual(route.join_key_names, ())
        self.assertTrue(is_safe_read("textbook_answer_catalog"))
        assert_safe_read("textbook_answer_catalog")

    def test_prestudy_default_lists_have_rows_without_canonical_join(self) -> None:
        for route_id in ("prestudy_waiting", "prestudy_completed"):
            route = get_route(route_id)
            self.assertEqual(route.evidence_grade, "live-structure")
            self.assertEqual(route.evidence_date, "2026-09-29")
            self.assertIn("table with rows", route.reason)
            self.assertIn("Canonical student ID", route.reason)
            self.assertIn("lesson occurrence", route.reason)
            self.assertTrue(route.safe_to_probe)

    def test_rub03_allows_pure_read_endpoints_with_safe_to_probe_true(self) -> None:
        """assert_safe_read must succeed for genuinely safe read endpoints."""
        safe_routes = [
            "course_menu",
            "course_schedule",
            "course_group",
            "attendance_history",
            "alimtalk_history",
            "study_menu",
            "prestudy_waiting",
            "prestudy_completed",
            "prestudy_summary",
            "dtzt_result",
            "study_schedule",
            "study_progress",
            "study_overview",
            "study_course",
            "smartbook_menu",
            "workbook_catalog",
            "smartbook_result",
            "textbook_main",
        ]
        for route_id in safe_routes:
            self.assertTrue(is_safe_read(route_id), f"{route_id} should be safe read")
            # Should not raise
            assert_safe_read(route_id)

    def test_route_lookups_and_error_handling(self) -> None:
        """Route engine must look up by canonical ID or unique operation name, and raise RouteLookupError on unknown."""
        r1 = get_route("course_menu")
        self.assertEqual(r1.id, "course_menu")
        self.assertEqual(r1.operation, "CourseManageIndex")
        self.assertEqual(r1.http_method, "GET")

        r2 = get_route("udtPrg")
        self.assertEqual(r2.id, "day_record_udtprg")
        self.assertEqual(r2.operation, "udtPrg")

        self.assertTrue(has_route("course_menu"))
        self.assertTrue(has_route("udtPrg"))
        self.assertFalse(has_route("non_existent_route_xyz"))

        with self.assertRaises(RouteLookupError):
            get_route("non_existent_route_xyz")
        self.assertFalse(is_safe_read("non_existent_route_xyz"))

    def test_rub07_dual_runtime_parity_and_class_wrapper(self) -> None:
        """LmsRouteRegistry class wrapper must provide both snake_case and camelCase methods."""
        # Class methods
        self.assertEqual(len(LmsRouteRegistry.get_all_routes()), 54)
        self.assertEqual(len(LmsRouteRegistry.getAllRoutes()), 54)

        self.assertEqual(LmsRouteRegistry.get_route("course_menu").id, "course_menu")
        self.assertEqual(LmsRouteRegistry.getRoute("course_menu").id, "course_menu")

        self.assertTrue(LmsRouteRegistry.has_route("course_menu"))
        self.assertTrue(LmsRouteRegistry.hasRoute("course_menu"))

        self.assertTrue(LmsRouteRegistry.is_safe_read("course_menu"))
        self.assertTrue(LmsRouteRegistry.isSafeRead("course_menu"))

        # Safe read assertion
        LmsRouteRegistry.assert_safe_read("course_menu")
        LmsRouteRegistry.assertSafeRead("course_menu")

        with self.assertRaises(UnsafeMutatingOperationError):
            LmsRouteRegistry.assert_safe_read("day_record_udtprg")
        with self.assertRaises(UnsafeMutatingOperationError):
            LmsRouteRegistry.assertSafeRead("day_record_udtprg")


if __name__ == "__main__":
    unittest.main()
