from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone

from workbench_v2.classroom_events import (
    BookCustody, ClassroomEvent, EventKind, EventSource, InspectionStatus,
    commit_classroom_event,
    project_student_classroom,
)
from workbench_v2.core import JoinError, LessonKey


KST = timezone(timedelta(hours=9))
DAY = date(2099, 1, 14)
KEY = LessonKey(DAY, "lesson-A", "student-A")
START = datetime(2099, 1, 14, 15, 0, tzinfo=KST)


def event(kind: EventKind, minute: int, **fields: object) -> ClassroomEvent:
    occurred = START + timedelta(minutes=minute)
    return ClassroomEvent(
        event_id=str(fields.pop("event_id", f"event-{minute}-{kind.value}")),
        key=fields.pop("key", KEY),
        kind=kind,
        source=fields.pop("source", EventSource.TEACHER_CHAT),
        occurred_at=occurred,
        received_at=fields.pop("received_at", occurred + timedelta(seconds=10)),
        **fields,
    )


class ClassroomEventProjectionTests(unittest.TestCase):
    def test_live_task_waiting_and_two_books_remain_distinct(self) -> None:
        events = [
            event(EventKind.WAIT_STARTED, 0),
            event(EventKind.HOMEWORK_CHECKED, 2, book_id="book-plus"),
            event(EventKind.TASK_STARTED, 5, activity_id="test-1",
                  description="대단원 평가"),
            event(EventKind.NEXT_TASK_SET, 6, activity_id="correction-1",
                  description="앱 채점 후 오답"),
            event(EventKind.HOMEWORK_ASSIGNED, 7, book_id="book-gauss",
                  description="다음 숙제", range_text="p.68~70", due_date=DAY),
        ]
        state = project_student_classroom(
            key=KEY, events=events, as_of=START + timedelta(minutes=25))
        self.assertEqual(state.current_task.elapsed, timedelta(minutes=20))
        self.assertEqual(state.waiting_since, START)
        self.assertEqual(state.next_task.description, "앱 채점 후 오답")
        self.assertEqual(set(state.checked_books), {"book-plus"})
        self.assertEqual(state.assigned_homework["book-gauss"][0].range_text, "p.68~70")

    def test_two_assignments_for_same_book_keep_distinct_event_ids(self) -> None:
        assignments = [
            event(EventKind.HOMEWORK_ASSIGNED, 0, event_id="assign-1",
                  book_id="book-gauss", description="first range",
                  range_text="p.68~70", due_date=DAY),
            event(EventKind.HOMEWORK_ASSIGNED, 1, event_id="assign-2",
                  book_id="book-gauss", description="second range",
                  range_text="p.72 #1~5", due_date=DAY),
        ]
        state = project_student_classroom(
            key=KEY, events=assignments, as_of=START + timedelta(minutes=2))
        self.assertEqual(
            [(item.event_id, item.range_text) for item in state.assigned_homework["book-gauss"]],
            [("assign-1", "p.68~70"), ("assign-2", "p.72 #1~5")],
        )

    def test_books_keep_independent_custody_and_inspection_state(self) -> None:
        events = [
            event(EventKind.BOOK_CUSTODY_SET, 0, book_id="gauss",
                  custody=BookCustody.TEACHER),
            event(EventKind.HOMEWORK_INSPECTION_STARTED, 1, book_id="gauss"),
            event(EventKind.BOOK_CUSTODY_SET, 2, book_id="davinci",
                  custody=BookCustody.STUDENT),
            event(EventKind.HOMEWORK_CHECKED, 3, book_id="davinci"),
        ]
        state = project_student_classroom(
            key=KEY, events=events, as_of=START + timedelta(minutes=4))
        self.assertEqual(state.book_states["gauss"].inspection,
                         InspectionStatus.IN_PROGRESS)
        self.assertEqual(state.book_states["davinci"].inspection,
                         InspectionStatus.COMPLETE)
        self.assertEqual(state.book_states["davinci"].custody,
                         BookCustody.STUDENT)
        self.assertNotIn("gauss", state.checked_books)

    def test_one_action_buffer_task_ends_wait_and_starts_work(self) -> None:
        events = [
            event(EventKind.WAIT_STARTED, 0),
            event(EventKind.BUFFER_TASK_STARTED, 2, activity_id="buffer-1",
                  description="independent workbook practice"),
        ]
        state = project_student_classroom(
            key=KEY, events=events, as_of=START + timedelta(minutes=5))
        self.assertIsNone(state.waiting_since)
        self.assertEqual(state.current_task.activity_id, "buffer-1")
        with self.assertRaisesRegex(JoinError, "needs a waiting student"):
            project_student_classroom(
                key=KEY, events=events[1:], as_of=START + timedelta(minutes=5))

    def test_unclosed_task_cannot_be_silently_replaced(self) -> None:
        events = [
            event(EventKind.TASK_STARTED, 0, activity_id="work-1", description="첫 과제"),
            event(EventKind.TASK_STARTED, 2, activity_id="work-2", description="다음 과제"),
        ]
        with self.assertRaisesRegex(JoinError, "prior task ended"):
            project_student_classroom(
                key=KEY, events=events, as_of=START + timedelta(minutes=3))

    def test_append_only_timestamp_correction_reprojects_elapsed_time(self) -> None:
        first = event(EventKind.TASK_STARTED, 0, event_id="start-original",
                      activity_id="work-1", description="풀이")
        corrected = event(
            EventKind.TASK_STARTED, 5, event_id="start-corrected",
            activity_id="work-1", description="풀이",
            received_at=START + timedelta(minutes=10),
            supersedes_id="start-original",
        )
        state = project_student_classroom(
            key=KEY, events=[first, corrected], as_of=START + timedelta(minutes=25))
        self.assertEqual(state.current_task.elapsed, timedelta(minutes=20))
        self.assertEqual(state.effective_event_count, 1)
        before_correction = project_student_classroom(
            key=KEY, events=[first, corrected], as_of=START + timedelta(minutes=8))
        self.assertEqual(before_correction.current_task.elapsed, timedelta(minutes=8))

    def test_app_grade_requires_exact_attempt_and_verified_source(self) -> None:
        submitted = event(EventKind.TEST_SUBMITTED, 0, paper_no="paper-1",
                          attempt_id="attempt-1")
        wrong_attempt = event(
            EventKind.TEST_GRADED, 1, paper_no="paper-1", attempt_id="attempt-2",
            source=EventSource.VERIFIED_APP, source_ref="verified-result-2")
        with self.assertRaisesRegex(JoinError, "known submission"):
            project_student_classroom(
                key=KEY, events=[submitted, wrong_attempt],
                as_of=START + timedelta(minutes=2))
        with self.assertRaisesRegex(ValueError, "verified app source"):
            event(EventKind.TEST_GRADED, 1, paper_no="paper-1",
                  attempt_id="attempt-1")

    def test_teacher_correction_check_needs_app_grade_and_correction(self) -> None:
        submitted = event(EventKind.TEST_SUBMITTED, 0, paper_no="paper-1",
                          attempt_id="attempt-1")
        graded = event(EventKind.TEST_GRADED, 1, paper_no="paper-1",
                       attempt_id="attempt-1", source=EventSource.VERIFIED_APP,
                       source_ref="verified-result-1")
        checked = event(EventKind.TEACHER_VERIFIED, 2, paper_no="paper-1",
                        attempt_id="attempt-1")
        with self.assertRaisesRegex(JoinError, "correction event"):
            project_student_classroom(
                key=KEY, events=[submitted, graded, checked],
                as_of=START + timedelta(minutes=3))
        corrected = event(EventKind.CORRECTION_DONE, 2, paper_no="paper-1",
                          attempt_id="attempt-1")
        checked = event(EventKind.TEACHER_VERIFIED, 3, paper_no="paper-1",
                        attempt_id="attempt-1")
        state = project_student_classroom(
            key=KEY, events=[submitted, graded, corrected, checked],
            as_of=START + timedelta(minutes=4))
        self.assertTrue(state.assessments[("paper-1", "attempt-1")].teacher_verified)

    def test_foreign_student_event_is_rejected(self) -> None:
        foreign = event(EventKind.WAIT_STARTED, 0,
                        key=LessonKey(DAY, "lesson-A", "student-B"))
        with self.assertRaisesRegex(JoinError, "another lesson or student"):
            project_student_classroom(
                key=KEY, events=[foreign], as_of=START + timedelta(minutes=1))

    def test_explicit_commit_is_idempotent_and_rejects_conflicting_retry(self) -> None:
        first = event(EventKind.HOMEWORK_ASSIGNED, 0, event_id="teacher-request-1",
                      book_id="book-gauss", description="next homework",
                      range_text="p.68~70")
        committed = commit_classroom_event(
            key=KEY, existing=[], event=first, as_of=START + timedelta(minutes=1))
        retried = commit_classroom_event(
            key=KEY, existing=committed, event=first,
            as_of=START + timedelta(minutes=1))
        self.assertEqual(retried, committed)
        changed = event(EventKind.HOMEWORK_ASSIGNED, 0, event_id="teacher-request-1",
                        book_id="book-gauss", description="next homework",
                        range_text="p.72~73")
        with self.assertRaisesRegex(JoinError, "different content"):
            commit_classroom_event(
                key=KEY, existing=committed, event=changed,
                as_of=START + timedelta(minutes=1))

    def test_explicit_commit_rejects_wrong_student_and_invalid_transition(self) -> None:
        foreign = event(EventKind.WAIT_STARTED, 0,
                        key=LessonKey(DAY, "lesson-A", "student-B"))
        with self.assertRaisesRegex(JoinError, "another lesson or student"):
            commit_classroom_event(
                key=KEY, existing=[], event=foreign,
                as_of=START + timedelta(minutes=1))
        ended_without_start = event(EventKind.TASK_FINISHED, 0,
                                    activity_id="work-1")
        with self.assertRaisesRegex(JoinError, "does not match"):
            commit_classroom_event(
                key=KEY, existing=[], event=ended_without_start,
                as_of=START + timedelta(minutes=1))


if __name__ == "__main__":
    unittest.main()
