from __future__ import annotations

import unittest
from datetime import date, datetime, timezone, timedelta

from workbench_v2.core import JoinError, LessonKey
from workbench_v2.raw_inbox import (
    RawObservation, RawSource, ReviewDecision, ReviewDisposition,
    project_end_of_day,
)


KST = timezone(timedelta(hours=9))
DAY = date(2099, 1, 14)
KEY_A = LessonKey(DAY, "lesson-A", "student-A")
KEY_B = LessonKey(DAY, "lesson-B", "student-B")
OBSERVED = datetime(2099, 1, 14, 17, 0, tzinfo=KST)


def raw(input_id: str, key: LessonKey) -> RawObservation:
    return RawObservation(input_id, key, "synthetic teacher observation",
                          RawSource.TEACHER_CHAT, OBSERVED, "synthetic-chat")


def project(observations=(), decisions=(), hour=21, minute=40):
    return project_end_of_day(
        lesson_date=DAY, student_ids=("student-A", "student-B"),
        observations=observations, decisions=decisions,
        as_of=datetime(2099, 1, 14, hour, minute, tzinfo=KST),
    )


class RawInboxTests(unittest.TestCase):
    def test_anytime_queue_and_evening_reminder_include_all_students(self) -> None:
        items = (raw("raw-A", KEY_A), raw("raw-B", KEY_B))
        daytime = project(items, hour=18)
        evening = project(items)
        self.assertEqual(daytime.total_pending, 2)
        self.assertFalse(daytime.reminder_window_active)
        self.assertEqual(evening.pending_ids_by_student["student-B"], ("raw-B",))
        self.assertTrue(evening.reminder_window_active)

    def test_teacher_review_closes_only_exact_raw_input(self) -> None:
        items = (raw("raw-A", KEY_A), raw("raw-B", KEY_B))
        decision = ReviewDecision(
            "review-A", "raw-A", KEY_A, ReviewDisposition.CARRY_FORWARD,
            datetime(2099, 1, 14, 21, 35, tzinfo=KST), "teacher-A",
            ("followup-A",))
        queue = project(items, (decision,))
        self.assertEqual(queue.pending_ids_by_student["student-A"], ())
        self.assertEqual(queue.pending_ids_by_student["student-B"], ("raw-B",))
        with self.assertRaisesRegex(JoinError, "binding mismatch"):
            project(items, (ReviewDecision(
                "bad", "raw-A", KEY_B, ReviewDisposition.RESOLVED,
                decision.reviewed_at, "teacher-A", ("event-X",)),))


if __name__ == "__main__":
    unittest.main()
