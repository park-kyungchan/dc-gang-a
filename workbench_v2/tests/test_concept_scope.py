from __future__ import annotations

import unittest
from datetime import date

from workbench_v2.concept_scope import (
    CalendarOccurrence, OccurrenceStatus, PriorAssignment, bind_concept_scope,
    contradicting_held_occurrence, previous_held_occurrence,
)
from workbench_v2.core import JoinError, LessonKey


CURRENT = LessonKey(date(2099, 1, 14), "current-lesson", "student-A")
PRIOR = LessonKey(date(2099, 1, 2), "verified-prior-lesson", "student-A")


class ConceptScopeTests(unittest.TestCase):
    def test_later_backend_held_lesson_disproves_teacher_date_hint(self) -> None:
        student = "student-A"
        current = LessonKey(date(2026, 9, 30), "sep-30", student)
        held = LessonKey(date(2026, 9, 23), "sep-23", student)
        observations = [
            CalendarOccurrence(held, OccurrenceStatus.HELD),
            CalendarOccurrence(LessonKey(date(2026, 9, 25), "sep-25", student),
                               OccurrenceStatus.UNKNOWN),
        ]
        self.assertEqual(contradicting_held_occurrence(
            current_key=current, teacher_prior_date=date(2026, 9, 21),
            observed=observations, evidence_verified=True), held)
        self.assertIsNone(contradicting_held_occurrence(
            current_key=current, teacher_prior_date=date(2026, 9, 23),
            observed=observations, evidence_verified=True))
        with self.assertRaisesRegex(JoinError, "evidence is unverified"):
            contradicting_held_occurrence(
                current_key=current, teacher_prior_date=date(2026, 9, 21),
                observed=observations, evidence_verified=False)

    def test_chuseok_cancellations_select_last_held_lesson(self) -> None:
        student = "student-A"
        current = LessonKey(date(2026, 9, 30), "sep-30", student)
        prior = LessonKey(date(2026, 9, 23), "sep-23", student)
        calendar = [
            CalendarOccurrence(prior, OccurrenceStatus.HELD),
            CalendarOccurrence(LessonKey(date(2026, 9, 25), "sep-25", student),
                               OccurrenceStatus.CANCELLED),
            CalendarOccurrence(current, OccurrenceStatus.PLANNED),
        ]
        self.assertEqual(previous_held_occurrence(
            current_key=current, calendar=calendar, coverage_verified=True,
            source_ref="complete-schedule"), prior)
        with self.assertRaisesRegex(JoinError, "coverage is unverified"):
            previous_held_occurrence(
                current_key=current, calendar=calendar, coverage_verified=False,
                source_ref="teacher-date-suggestion")
        unresolved = list(calendar)
        unresolved[1] = CalendarOccurrence(unresolved[1].key, OccurrenceStatus.UNKNOWN)
        with self.assertRaisesRegex(JoinError, "intervening occurrence"):
            previous_held_occurrence(
                current_key=current, calendar=unresolved, coverage_verified=True,
                source_ref="incomplete-status")

    def test_holiday_gap_retains_all_books_from_verified_previous_occurrence(self) -> None:
        items = [
            PriorAssignment("assignment-1", PRIOR, "gauss", "p.68~70", "lms-row-1"),
            PriorAssignment("assignment-2", PRIOR, "davinci", "p.42~49", "lms-row-2"),
        ]
        scope = bind_concept_scope(
            current_key=CURRENT, previous_key=PRIOR,
            link_source_ref="verified-calendar-link", assignments=items)
        self.assertEqual(
            [(item.book_id, item.range_text) for item in scope.assignments],
            [("gauss", "p.68~70"), ("davinci", "p.42~49")],
        )

    def test_foreign_or_missing_assignment_does_not_autoinject(self) -> None:
        foreign = PriorAssignment(
            "assignment-3", LessonKey(date(2099, 1, 2), "other-lesson", "student-A"),
            "gauss", "p.68~70", "lms-row-3")
        with self.assertRaisesRegex(JoinError, "another occurrence"):
            bind_concept_scope(
                current_key=CURRENT, previous_key=PRIOR,
                link_source_ref="verified-calendar-link", assignments=[foreign])
        with self.assertRaisesRegex(JoinError, "no verified homework"):
            bind_concept_scope(
                current_key=CURRENT, previous_key=PRIOR,
                link_source_ref="verified-calendar-link", assignments=[])


if __name__ == "__main__":
    unittest.main()
