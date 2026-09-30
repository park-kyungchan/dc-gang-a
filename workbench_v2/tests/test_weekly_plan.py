from __future__ import annotations

import unittest
from datetime import date
from fractions import Fraction

from workbench_v2.core import JoinError
from workbench_v2.page_progress import PageState
from workbench_v2.weekly_plan import PaceEvidence, UnitPageAudit, propose_book_quantity


def propose(**changes: object):
    fields = dict(student_id="synthetic-student", book_edition_id="synthetic-edition",
                  start_date=date(2026, 10, 2), next_date=date(2026, 10, 12),
                  calendar_complete=True, calendar_source_ref="synthetic-calendar",
                  unit_source_ref="synthetic-toc", page_audit_complete=True,
                  assignment_source_ref="synthetic-assignments",
                  outstanding_unit_ids=(),
                  weekly_min=3, weekly_max=4,
                  unfinished_units=(), pace=None)
    fields.update(changes)
    return propose_book_quantity(**fields)


def unit(*states: PageState, edition: str = "synthetic-edition") -> UnitPageAudit:
    return UnitPageAudit("unit-1", edition, 68, states, "synthetic-page-audit")


def pace(completed: int = 4, student: str = "synthetic-student") -> PaceEvidence:
    return PaceEvidence(student, "synthetic-edition", date(2026, 9, 25),
                        date(2026, 10, 2), completed, "synthetic-teacher-history")


class WeeklyPlanTests(unittest.TestCase):
    def test_ten_day_baseline_and_missing_individual_pace(self) -> None:
        result = propose()
        self.assertEqual((result.baseline_low, result.baseline_high), (5, 6))
        self.assertIsNone(result.suggested_new_low)
        self.assertEqual(result.review_reason, "individual pace unavailable")
        secondary = propose(weekly_min=2, weekly_max=2)
        self.assertEqual((secondary.baseline_low, secondary.baseline_high), (3, 3))

    def test_unfinished_page_share_reduces_new_work(self) -> None:
        observed = pace()
        empty = propose(pace=observed)
        carrying = propose(pace=observed, outstanding_unit_ids=("unit-1",),
                           unfinished_units=(unit(
                               PageState.NOT_DONE, PageState.TEACHER_VERIFIED),))
        self.assertEqual((empty.suggested_new_low, empty.suggested_new_high), (5, 5))
        self.assertEqual(carrying.unfinished_pages, 1)
        self.assertEqual(carrying.page_share_ceiling, Fraction(1, 2))
        self.assertEqual((carrying.suggested_new_low, carrying.suggested_new_high), (4, 5))
        full = propose(pace=observed, outstanding_unit_ids=("unit-1",),
                       unfinished_units=(unit(
                           PageState.NOT_DONE, PageState.NOT_DONE),))
        self.assertEqual((full.suggested_new_low, full.suggested_new_high), (4, 4))

    def test_uncertain_page_blocks_exact_quantity(self) -> None:
        result = propose(
            pace=pace(),
            outstanding_unit_ids=("unit-1",),
            unfinished_units=(unit(PageState.NOT_DONE, PageState.REPORTED_DONE),))
        self.assertEqual(result.unfinished_pages, 1)
        self.assertIsNone(result.suggested_new_low)
        self.assertEqual(result.review_reason, "page evidence unresolved")

    def test_unverified_scope_and_foreign_edition_fail_closed(self) -> None:
        with self.assertRaisesRegex(JoinError, "calendar coverage"):
            propose(calendar_complete=False)
        with self.assertRaisesRegex(JoinError, "page audit coverage"):
            propose(page_audit_complete=False)
        with self.assertRaisesRegex(JoinError, "edition mismatch"):
            propose(outstanding_unit_ids=("unit-1",),
                    unfinished_units=(unit(PageState.NOT_DONE, edition="other"),))
        with self.assertRaisesRegex(JoinError, "individual pace"):
            propose(pace=pace(student="other-student"))
        with self.assertRaisesRegex(JoinError, "coverage mismatch"):
            propose(outstanding_unit_ids=("unit-1",), pace=pace())


if __name__ == "__main__":
    unittest.main()
