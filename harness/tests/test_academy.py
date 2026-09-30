"""Synthetic contract tests for the bounded academy fact gateway."""

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from harness import academy


STUDENT = SimpleNamespace(
    student_id="student-A", group_id="4", group_name="수금2부",
    course_seq="course-A", cm_seq="cm-A")
ROW = SimpleNamespace(
    stu_pri_no="student-A", course_seq="course-A", record_seq="record-A",
    cm_seq="cm-A", attendance="Y", daily_test=None, homework_rate=None,
    progress_text="lesson text", homework_text="Gauss p.68~p.70; Davinci p.42~49",
    memo_text="private memo", student_memo="")
PAGE = SimpleNamespace(
    date="2099-01-14", grp_seq="4",
    teacher_pri_no=academy.get_teacher().teacher_pri_no,
    groups=[SimpleNamespace(value="4", label="수금2부")], records=[ROW])


class AcademyFactTests(unittest.TestCase):
    def test_exact_row_returns_page_candidates_without_raw_student_text(self) -> None:
        result = academy.summarize_day_record(
            student=STUDENT, lesson_date="2099-01-14", page=PAGE,
            requested_fields=("homework", "memo"), record_seq="record-A",
            read_at="2099-01-14T06:00:00+00:00",
            observed_scope=("20990114", "4"))
        self.assertEqual(result["scope"]["recordSeq"], "record-A")
        self.assertEqual(result["status"], "observed_row")
        self.assertEqual(result["source"]["occurrenceBinding"], "unverified")
        self.assertEqual(result["fields"]["homework"]["pageRangeCandidates"],
                         [{"first": 42, "last": 49}, {"first": 68, "last": 70}])
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("Gauss", serialized)
        self.assertNotIn("private memo", serialized)
        self.assertEqual(result["fields"]["homework"]["bookBinding"], "unverified")

    def test_wrong_group_or_duplicate_occurrence_fails_closed(self) -> None:
        with self.assertRaisesRegex(academy.ReadBlocked, "response_scope_mismatch"):
            academy.summarize_day_record(
                student=STUDENT, lesson_date="2099-01-14", page=PAGE,
                requested_fields=("homework",), record_seq=None, read_at="t",
                observed_scope=("20990114", "3"))
        duplicate = SimpleNamespace(**{**PAGE.__dict__, "records": [ROW, ROW]})
        with self.assertRaisesRegex(academy.ReadBlocked, "ambiguous_occurrence"):
            academy.summarize_day_record(
                student=STUDENT, lesson_date="2099-01-14", page=duplicate,
                requested_fields=("homework",), record_seq=None, read_at="t",
                observed_scope=("20990114", "4"))

    def test_response_date_and_selected_group_are_required(self) -> None:
        html = ('<input type="hidden" id="std_ymd" value="20990114">'
                '<select id="grp_seq"><option value="3">other</option>'
                '<option value="4" selected>target</option></select>')
        self.assertEqual(academy.response_scope(html), ("20990114", "4"))
        self.assertEqual(academy.response_scope(html.replace("20990114", "20990113")),
                         ("20990113", "4"))
        self.assertEqual(academy.response_scope(html.replace('value="4" selected',
                                                            'value="3" selected')),
                         ("20990114", "3"))
        with self.assertRaisesRegex(academy.ReadBlocked, "response_scope_unproven"):
            academy.response_scope(html.replace(" selected", ""))
        with self.assertRaisesRegex(academy.ReadBlocked, "response_scope_unproven"):
            academy.response_scope(html.replace('<input type="hidden" id="std_ymd" value="20990114">', ""))

    def test_missing_teacher_and_stale_occurrence_cannot_be_verified(self) -> None:
        no_teacher = SimpleNamespace(**{**PAGE.__dict__, "teacher_pri_no": ""})
        with self.assertRaisesRegex(academy.ReadBlocked, "teacher_scope_mismatch"):
            academy.summarize_day_record(
                student=STUDENT, lesson_date="2099-01-14", page=no_teacher,
                requested_fields=("homework",), record_seq=None, read_at="t",
                observed_scope=("20990114", "4"))
        stale_row = SimpleNamespace(**{**ROW.__dict__, "record_seq": "other-date-row"})
        stale_page = SimpleNamespace(**{**PAGE.__dict__, "records": [stale_row]})
        result = academy.summarize_day_record(
            student=STUDENT, lesson_date="2099-01-14", page=stale_page,
            requested_fields=("homework",), record_seq=None, read_at="t",
            observed_scope=("20990114", "4"))
        self.assertEqual(result["status"], "observed_row")
        self.assertEqual(result["source"]["occurrenceBinding"], "unverified")

    def test_historical_group_override_stays_unverified(self) -> None:
        group = academy.get_group("2")
        page = SimpleNamespace(**{**PAGE.__dict__,
                                  "groups": [SimpleNamespace(value="2", label=group.name)]})
        result = academy.summarize_day_record(
            student=STUDENT, lesson_date="2099-01-14", page=page,
            requested_fields=("homework",), record_seq=None, read_at="t",
            observed_scope=("20990114", "2"), group=group)
        self.assertEqual(result["scope"]["groupId"], "2")
        self.assertEqual(result["source"]["historicalGroupBinding"], "unverified")

    def test_mutating_route_cannot_be_used_by_exact_reader(self) -> None:
        bad = SimpleNamespace(
            semantic_effect="write", http_method="GET", operation="udtHw",
            servlet_path="/servlet/controller.cct.tutor.DayRecordServlet")
        with patch.object(academy, "get_route", return_value=bad):
            with self.assertRaisesRegex(academy.ReadBlocked, "unsafe_or_drifted_route"):
                academy._checked_day_record_route()

    def test_plan_for_pdf_reports_student_assignment_gap_without_network(self) -> None:
        result = academy.plan("textbook_samples", STUDENT, "2099-01-14")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["readState"], "blocked_student_book_assignment_unverified")
        self.assertEqual(result["routeIds"],
                         ["textbook_main", "textbook_answer_catalog", "textbook_sample_pdf"])
        self.assertIsNone(result["nextCommand"])

    def test_weekly_plan_routes_to_composite_contract_gap(self) -> None:
        result = academy.plan("weekly_plan", STUDENT, "2099-01-14")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["readState"],
                         "blocked_calendar_edition_page_audit_personal_pace_joins_unverified")
        self.assertIsNone(result["nextCommand"])

    def test_all_fact_routes_exist_and_only_day_record_is_ready(self) -> None:
        for fact, recipe in academy.FACTS.items():
            for route_id in recipe["route_ids"]:
                self.assertEqual(academy.get_route(route_id).id, route_id)
            if fact != "day_record":
                result = academy.plan(fact, STUDENT, "2099-01-14")
                self.assertEqual(result["status"], "blocked")
                self.assertIsNone(result["nextCommand"])

    def test_invalid_field_is_rejected_before_auth_or_network(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            code = academy.main([
                "read", "--fact", "day_record", "--student-id", "1294174",
                "--date", "2099-01-14", "--fields", "raw_html",
                "--session-env"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue())["reason"], "invalid_field_selection")

    def test_book_volume_numbers_are_not_mistaken_for_pages(self) -> None:
        self.assertEqual(
            academy.page_range_candidates("Gauss 5-2 vol.2 p.112~p.121"),
            [{"first": 112, "last": 121}],
        )
        self.assertEqual(academy.page_range_candidates("pp. 3-5, pp. 11-12"),
                         [{"first": 3, "last": 5}, {"first": 11, "last": 12}])

    def test_homework_lines_keep_book_mentions_unbound(self) -> None:
        result = academy.homework_line_candidates(
            "Gauss p.119-134\nDavinci review\nother note")
        self.assertEqual(result, [
            {"line": 1, "bookSeriesMentions": ["primary"],
             "pageRangeCandidates": [{"first": 119, "last": 134}]},
            {"line": 2, "bookSeriesMentions": ["secondary"],
             "pageRangeCandidates": []},
        ])

    def test_prior_claim_detects_later_attendance_without_guessing_holiday(self) -> None:
        student = academy.resolve_student("1294174")
        group = academy.resolve_group(None, student)
        self.assertEqual(academy.scheduled_dates_after_claim(
            claimed_date="2026-09-21", current_date="2026-09-30", group=group),
            ["2026-09-25", "2026-09-23"])
        def observed(*, lesson_date: str, **_kwargs: object) -> dict:
            return {"fields": {"attendance": {"value": "Y" if lesson_date == "2026-09-23" else None}}}
        with patch.object(academy, "read_day_record_exact", side_effect=observed):
            result = academy.check_prior_claim(
                student=student, group=group, current_date="2026-09-30",
                claimed_date="2026-09-21", cookie="synthetic")
        self.assertEqual(result["status"], "conflict_observed")
        self.assertEqual(result["laterAttendedDate"], "2026-09-23")
        self.assertEqual(result["newerUnknownDates"], ["2026-09-25"])
        self.assertEqual(result["exactPreviousOccurrence"], "unverified")

    def test_prior_claim_negative_is_unresolved(self) -> None:
        student = academy.resolve_student("1294174")
        group = academy.resolve_group(None, student)
        with patch.object(academy, "read_day_record_exact", side_effect=academy.ReadBlocked("target_row_not_found")):
            result = academy.check_prior_claim(
                student=student, group=group, current_date="2026-09-30",
                claimed_date="2026-09-21", cookie="synthetic")
        self.assertEqual(result["status"], "unresolved")
        self.assertEqual(result["newerUnknownDates"], ["2026-09-25", "2026-09-23"])
        with self.assertRaisesRegex(academy.ReadBlocked, "invalid_prior_date_order"):
            academy.scheduled_dates_after_claim(
                claimed_date="2026-09-30", current_date="2026-09-30", group=group)

    def test_manifest_failure_is_compact_json(self) -> None:
        output = io.StringIO()
        with patch.object(academy, "_source_verified", side_effect=OSError("private path")), \
                redirect_stdout(output):
            code = academy.main(["plan", "--fact", "day_record",
                                 "--student-id", "1294174", "--date", "2099-01-14"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue()),
                         {"status": "blocked", "reason": "internal_error"})

    def test_invalid_arguments_are_compact_json(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            code = academy.main(["read", "--fact", "day_record"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue()),
                         {"status": "blocked", "reason": "invalid_arguments"})


if __name__ == "__main__":
    unittest.main()
