from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone

from workbench_v2.core import JoinError, LessonKey
from workbench_v2.page_progress import (
    PageEventKind, PageEventSource, PageProgressEvent, PageState,
    project_page_progress,
)


UTC = timezone.utc
KEY = LessonKey(date(2099, 1, 14), "lesson-A", "student-A")
START = datetime(2099, 1, 14, 6, 0, tzinfo=UTC)


def event(kind: PageEventKind, minute: int, first: int, last: int,
          **fields: object) -> PageProgressEvent:
    when = START + timedelta(minutes=minute)
    return PageProgressEvent(
        event_id=str(fields.pop("event_id", f"event-{minute}")),
        key=fields.pop("key", KEY),
        book_edition_id=str(fields.pop("book_edition_id", "book-edition-A")),
        first_page=first, last_page=last, kind=kind,
        source=fields.pop("source", PageEventSource.TEACHER_CHAT),
        occurred_at=when,
        received_at=fields.pop("received_at", when + timedelta(seconds=10)),
        source_ref=str(fields.pop("source_ref", f"source-{minute}")),
        **fields,
    )


class PageProgressTests(unittest.TestCase):
    def test_assignment_is_not_completion_and_each_page_can_diverge(self) -> None:
        events = [
            event(PageEventKind.ASSIGNED, 0, 68, 70,
                  source=PageEventSource.LMS_DAY_RECORD),
            event(PageEventKind.TEACHER_VERIFIED, 2, 68, 69,
                  correction_checked=True),
            event(PageEventKind.NOT_DONE, 3, 70, 70),
        ]
        pages = project_page_progress(
            key=KEY, book_edition_id="book-edition-A", first_page=68,
            last_page=71, events=events, as_of=START + timedelta(minutes=4))
        self.assertEqual([pages[p].state for p in range(68, 72)], [
            PageState.TEACHER_VERIFIED, PageState.TEACHER_VERIFIED,
            PageState.NOT_DONE, PageState.UNKNOWN])

    def test_problem_subset_never_marks_whole_page_complete(self) -> None:
        events = [event(PageEventKind.TEACHER_VERIFIED, 0, 72, 72,
                        problem_scope="#1~5", correction_checked=True)]
        page = project_page_progress(
            key=KEY, book_edition_id="book-edition-A", first_page=72,
            last_page=72, events=events, as_of=START + timedelta(minutes=1))[72]
        self.assertEqual(page.state, PageState.UNKNOWN)
        self.assertEqual(page.partial_problem_event_ids, ("event-0",))

    def test_correction_preserves_historical_as_of_and_replaces_range(self) -> None:
        original = event(PageEventKind.ASSIGNED, 0, 68, 70, event_id="old")
        replacement = event(
            PageEventKind.ASSIGNED, 1, 68, 69, event_id="new",
            received_at=START + timedelta(minutes=3), supersedes_id="old")
        earlier = project_page_progress(
            key=KEY, book_edition_id="book-edition-A", first_page=68,
            last_page=70, events=[original, replacement],
            as_of=START + timedelta(minutes=2))
        current = project_page_progress(
            key=KEY, book_edition_id="book-edition-A", first_page=68,
            last_page=70, events=[original, replacement],
            as_of=START + timedelta(minutes=4))
        self.assertEqual(earlier[70].state, PageState.ASSIGNED)
        self.assertEqual(current[70].state, PageState.UNKNOWN)

    def test_foreign_book_and_lms_completion_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "checked wrong-answer correction"):
            event(PageEventKind.TEACHER_VERIFIED, 0, 68, 68)
        with self.assertRaisesRegex(ValueError, "assignment only"):
            event(PageEventKind.TEACHER_VERIFIED, 0, 68, 68,
                  source=PageEventSource.LMS_DAY_RECORD)
        with self.assertRaisesRegex(JoinError, "another lesson, student, or book"):
            project_page_progress(
                key=KEY, book_edition_id="book-edition-A", first_page=68,
                last_page=68,
                events=[event(PageEventKind.ASSIGNED, 0, 68, 68,
                              book_edition_id="book-edition-B")],
                as_of=START + timedelta(minutes=1))


if __name__ == "__main__":
    unittest.main()
