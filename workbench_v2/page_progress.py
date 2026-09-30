"""Append-only, page-level textbook progress for a single student and book.

An LMS homework range proves assignment only. Whole-page completion requires
teacher evidence; a subset of problems on one page remains partial evidence.
The caller resolves the textbook edition and lesson occurrence before use.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Sequence

from .core import JoinError, LessonKey, _aware, _id


class PageEventKind(str, Enum):
    ASSIGNED = "assigned"
    STUDENT_REPORTED_DONE = "student_reported_done"
    TEACHER_VERIFIED = "teacher_verified"
    NOT_DONE = "not_done"
    REOPENED = "reopened"


class PageEventSource(str, Enum):
    LMS_DAY_RECORD = "lms_day_record"
    TEACHER_CHAT = "teacher_chat"
    TEACHER_SHEET = "teacher_sheet"


class PageState(str, Enum):
    UNKNOWN = "unknown"
    ASSIGNED = "assigned"
    REPORTED_DONE = "reported_done"
    TEACHER_VERIFIED = "teacher_verified"
    NOT_DONE = "not_done"
    REOPENED = "reopened"


_STATE_FOR_KIND = {
    PageEventKind.ASSIGNED: PageState.ASSIGNED,
    PageEventKind.STUDENT_REPORTED_DONE: PageState.REPORTED_DONE,
    PageEventKind.TEACHER_VERIFIED: PageState.TEACHER_VERIFIED,
    PageEventKind.NOT_DONE: PageState.NOT_DONE,
    PageEventKind.REOPENED: PageState.REOPENED,
}


@dataclass(frozen=True)
class PageProgressEvent:
    event_id: str
    key: LessonKey
    book_edition_id: str
    first_page: int
    last_page: int
    kind: PageEventKind
    source: PageEventSource
    occurred_at: datetime
    received_at: datetime
    source_ref: str
    problem_scope: str | None = None
    supersedes_id: str | None = None
    correction_checked: bool = False

    def __post_init__(self) -> None:
        _id(self.event_id, "event_id")
        _id(self.book_edition_id, "book_edition_id")
        _id(self.source_ref, "source_ref")
        _aware(self.occurred_at, "occurred_at")
        _aware(self.received_at, "received_at")
        if self.received_at < self.occurred_at:
            raise ValueError("received_at cannot precede occurred_at")
        if self.first_page < 1 or self.last_page < self.first_page:
            raise ValueError("invalid page interval")
        if self.last_page - self.first_page > 499:
            raise ValueError("page interval is not bounded")
        if self.source is PageEventSource.LMS_DAY_RECORD and self.kind is not PageEventKind.ASSIGNED:
            raise ValueError("LMS homework text proves assignment only")
        if self.kind is PageEventKind.TEACHER_VERIFIED and not self.correction_checked:
            raise ValueError("teacher verification requires checked wrong-answer correction")
        if self.correction_checked and self.kind is not PageEventKind.TEACHER_VERIFIED:
            raise ValueError("correction check belongs to teacher verification")
        if self.correction_checked and self.source is PageEventSource.LMS_DAY_RECORD:
            raise ValueError("LMS DayRecord does not prove teacher correction check")
        if self.problem_scope is not None and not self.problem_scope.strip():
            raise ValueError("problem scope cannot be blank")
        if self.supersedes_id is not None:
            _id(self.supersedes_id, "supersedes_id")
            if self.supersedes_id == self.event_id:
                raise ValueError("event cannot supersede itself")


@dataclass(frozen=True)
class PageProgress:
    page: int
    state: PageState
    last_whole_page_event_id: str | None
    partial_problem_event_ids: tuple[str, ...]


def project_page_progress(
    *, key: LessonKey, book_edition_id: str, first_page: int,
    last_page: int, events: Sequence[PageProgressEvent], as_of: datetime,
) -> Mapping[int, PageProgress]:
    """Show every requested page, including unknown pages, as of one time."""
    _aware(as_of, "as_of")
    _id(book_edition_id, "book_edition_id")
    if first_page < 1 or last_page < first_page or last_page - first_page > 499:
        raise ValueError("invalid requested page interval")
    by_id: dict[str, PageProgressEvent] = {}
    visible: list[PageProgressEvent] = []
    for item in events:
        if item.key != key or item.book_edition_id != book_edition_id:
            raise JoinError("page event belongs to another lesson, student, or book")
        if item.event_id in by_id:
            raise JoinError("duplicate page event ID")
        if item.received_at <= as_of:
            by_id[item.event_id] = item
            if item.occurred_at <= as_of:
                visible.append(item)
    superseded: set[str] = set()
    for item in visible:
        if item.supersedes_id is None:
            continue
        prior = by_id.get(item.supersedes_id)
        if prior is None or prior.kind is not item.kind:
            raise JoinError("page correction needs an earlier same-kind event")
        if prior.received_at >= item.received_at:
            raise JoinError("page correction must arrive after its predecessor")
        if item.supersedes_id in superseded:
            raise JoinError("page event has multiple corrections")
        superseded.add(item.supersedes_id)
    state: dict[int, PageProgress] = {
        page: PageProgress(page, PageState.UNKNOWN, None, ())
        for page in range(first_page, last_page + 1)
    }
    for item in sorted(
        (event for event in visible if event.event_id not in superseded),
        key=lambda event: (event.occurred_at, event.received_at, event.event_id),
    ):
        for page in range(max(first_page, item.first_page), min(last_page, item.last_page) + 1):
            previous = state[page]
            if item.problem_scope is not None:
                state[page] = PageProgress(
                    page, previous.state, previous.last_whole_page_event_id,
                    (*previous.partial_problem_event_ids, item.event_id))
            else:
                state[page] = PageProgress(
                    page, _STATE_FOR_KIND[item.kind], item.event_id,
                    previous.partial_problem_event_ids)
    return MappingProxyType(state)
