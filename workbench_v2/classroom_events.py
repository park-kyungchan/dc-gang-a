"""Pure classroom event projection for the teacher's Main Sheet.

This module does no parsing of chat text and no network or Sheet I/O. An input
adapter must resolve the exact lesson, student, textbook, and paper identities
before constructing an event. Corrections append a replacement event and point
to the superseded event; they never erase the original.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Sequence

from .core import JoinError, LessonKey, _aware, _id


class EventSource(str, Enum):
    TEACHER_CHAT = "teacher_chat"
    TEACHER_SHEET = "teacher_sheet"
    VERIFIED_APP = "verified_app"


class EventKind(str, Enum):
    TASK_STARTED = "task_started"
    BUFFER_TASK_STARTED = "buffer_task_started"
    TASK_FINISHED = "task_finished"
    TASK_CANCELLED = "task_cancelled"
    WAIT_STARTED = "wait_started"
    WAIT_ENDED = "wait_ended"
    NEXT_TASK_SET = "next_task_set"
    NEXT_TASK_CLEARED = "next_task_cleared"
    HOMEWORK_CHECKED = "homework_checked"
    HOMEWORK_INSPECTION_STARTED = "homework_inspection_started"
    HOMEWORK_INSPECTION_CANCELLED = "homework_inspection_cancelled"
    BOOK_CUSTODY_SET = "book_custody_set"
    HOMEWORK_ASSIGNED = "homework_assigned"
    TEST_SUBMITTED = "test_submitted"
    TEST_GRADED = "test_graded"
    CORRECTION_DONE = "correction_done"
    TEACHER_VERIFIED = "teacher_verified"


_ACTIVITY_KINDS = {
    EventKind.TASK_STARTED, EventKind.BUFFER_TASK_STARTED,
    EventKind.TASK_FINISHED, EventKind.TASK_CANCELLED,
    EventKind.NEXT_TASK_SET,
}
_BOOK_KINDS = {
    EventKind.HOMEWORK_CHECKED, EventKind.HOMEWORK_ASSIGNED,
    EventKind.HOMEWORK_INSPECTION_STARTED,
    EventKind.HOMEWORK_INSPECTION_CANCELLED, EventKind.BOOK_CUSTODY_SET,
}
_PAPER_KINDS = {
    EventKind.TEST_SUBMITTED, EventKind.TEST_GRADED,
    EventKind.CORRECTION_DONE, EventKind.TEACHER_VERIFIED,
}
_DESCRIPTION_KINDS = {
    EventKind.TASK_STARTED, EventKind.BUFFER_TASK_STARTED,
    EventKind.TASK_CANCELLED, EventKind.HOMEWORK_INSPECTION_CANCELLED,
    EventKind.NEXT_TASK_SET,
    EventKind.HOMEWORK_ASSIGNED,
}


class BookCustody(str, Enum):
    STUDENT = "student"
    TEACHER = "teacher"
    UNKNOWN = "unknown"


class InspectionStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"


@dataclass(frozen=True)
class ClassroomEvent:
    event_id: str
    key: LessonKey
    kind: EventKind
    source: EventSource
    occurred_at: datetime
    received_at: datetime
    activity_id: str | None = None
    book_id: str | None = None
    paper_no: str | None = None
    attempt_id: str | None = None
    description: str | None = None
    range_text: str | None = None
    due_date: date | None = None
    source_ref: str | None = None
    supersedes_id: str | None = None
    custody: BookCustody | None = None

    def __post_init__(self) -> None:
        _id(self.event_id, "event_id")
        _aware(self.occurred_at, "occurred_at")
        _aware(self.received_at, "received_at")
        if self.received_at < self.occurred_at:
            raise ValueError("received_at cannot precede occurred_at")
        if self.kind in _ACTIVITY_KINDS:
            _id(self.activity_id, "activity_id")
        if self.kind in _BOOK_KINDS:
            _id(self.book_id, "book_id")
        if self.kind in _PAPER_KINDS:
            _id(self.paper_no, "paper_no")
            _id(self.attempt_id, "attempt_id")
        if self.kind in _DESCRIPTION_KINDS and not (self.description or "").strip():
            raise ValueError(f"{self.kind.value} needs a description")
        if self.kind is EventKind.HOMEWORK_ASSIGNED and not (self.range_text or "").strip():
            raise ValueError("homework assignment needs an exact range")
        if self.kind is EventKind.BOOK_CUSTODY_SET and self.custody is None:
            raise ValueError("book custody event needs a custody value")
        if self.kind is EventKind.TEST_GRADED:
            if self.source is not EventSource.VERIFIED_APP or not self.source_ref:
                raise ValueError("app grade needs a verified app source reference")
        if self.source is EventSource.VERIFIED_APP and not self.source_ref:
            raise ValueError("verified app events need a source reference")
        if self.supersedes_id is not None:
            _id(self.supersedes_id, "supersedes_id")
            if self.supersedes_id == self.event_id:
                raise ValueError("an event cannot supersede itself")


@dataclass(frozen=True)
class CurrentTask:
    activity_id: str
    description: str
    started_at: datetime
    elapsed: timedelta


@dataclass(frozen=True)
class NextTask:
    activity_id: str
    description: str


@dataclass(frozen=True)
class HomeworkAssignment:
    book_id: str
    range_text: str
    due_date: date | None
    event_id: str


@dataclass(frozen=True)
class BookState:
    book_id: str
    custody: BookCustody
    inspection: InspectionStatus
    last_event_id: str


@dataclass(frozen=True)
class AssessmentState:
    paper_no: str
    attempt_id: str
    submitted: bool = False
    graded: bool = False
    correction_done: bool = False
    teacher_verified: bool = False


@dataclass(frozen=True)
class StudentClassroomState:
    key: LessonKey
    current_task: CurrentTask | None
    waiting_since: datetime | None
    next_task: NextTask | None
    checked_books: Mapping[str, str]
    book_states: Mapping[str, BookState]
    assigned_homework: Mapping[str, tuple[HomeworkAssignment, ...]]
    assessments: Mapping[tuple[str, str], AssessmentState]
    effective_event_count: int


def _effective_events(events: Sequence[ClassroomEvent], key: LessonKey) -> list[ClassroomEvent]:
    by_id: dict[str, ClassroomEvent] = {}
    superseded: set[str] = set()
    for event in events:
        if event.key != key:
            raise JoinError("classroom event belongs to another lesson or student")
        if event.event_id in by_id:
            raise JoinError("duplicate classroom event ID")
        by_id[event.event_id] = event
    for event in events:
        if event.supersedes_id is None:
            continue
        previous = by_id.get(event.supersedes_id)
        if previous is None or previous.kind is not event.kind:
            raise JoinError("correction must target an existing event of the same kind")
        if event.received_at <= previous.received_at:
            raise JoinError("correction must be received after its predecessor")
        if event.supersedes_id in superseded:
            raise JoinError("one classroom event has multiple corrections")
        superseded.add(event.supersedes_id)
    return sorted(
        (event for event in events if event.event_id not in superseded),
        key=lambda event: (event.occurred_at, event.received_at, event.event_id),
    )


def project_student_classroom(
    *, key: LessonKey, events: Sequence[ClassroomEvent], as_of: datetime,
) -> StudentClassroomState:
    """Project exact, append-only teacher events into one student's live board."""
    _aware(as_of, "as_of")
    active: ClassroomEvent | None = None
    waiting_since: datetime | None = None
    next_task: NextTask | None = None
    checked_books: dict[str, str] = {}
    book_states: dict[str, BookState] = {}
    assigned: dict[str, list[HomeworkAssignment]] = {}
    assessments: dict[tuple[str, str], AssessmentState] = {}
    visible_events = [event for event in events if event.received_at <= as_of]
    effective = [event for event in _effective_events(visible_events, key)
                 if event.occurred_at <= as_of]
    for event in effective:
        kind = event.kind
        if kind in (EventKind.TASK_STARTED, EventKind.BUFFER_TASK_STARTED):
            if active is not None:
                raise JoinError("new task started before the prior task ended")
            if kind is EventKind.BUFFER_TASK_STARTED:
                if waiting_since is None:
                    raise JoinError("buffer task needs a waiting student")
                waiting_since = None
            active = event
            if next_task and next_task.activity_id == event.activity_id:
                next_task = None
        elif kind in (EventKind.TASK_FINISHED, EventKind.TASK_CANCELLED):
            if active is None or active.activity_id != event.activity_id:
                raise JoinError("task end does not match the active task")
            active = None
        elif kind is EventKind.WAIT_STARTED:
            if waiting_since is not None:
                raise JoinError("duplicate waiting start")
            waiting_since = event.occurred_at
        elif kind is EventKind.WAIT_ENDED:
            if waiting_since is None:
                raise JoinError("waiting end without a start")
            waiting_since = None
        elif kind is EventKind.NEXT_TASK_SET:
            next_task = NextTask(event.activity_id or "", event.description or "")
        elif kind is EventKind.NEXT_TASK_CLEARED:
            next_task = None
        elif kind is EventKind.HOMEWORK_CHECKED:
            book_id = event.book_id or ""
            previous = book_states.get(book_id)
            book_states[book_id] = BookState(
                book_id, previous.custody if previous else BookCustody.UNKNOWN,
                InspectionStatus.COMPLETE, event.event_id)
            checked_books[book_id] = event.event_id
        elif kind is EventKind.BOOK_CUSTODY_SET:
            book_id = event.book_id or ""
            previous = book_states.get(book_id)
            book_states[book_id] = BookState(
                book_id, event.custody or BookCustody.UNKNOWN,
                previous.inspection if previous else InspectionStatus.PENDING,
                event.event_id)
        elif kind is EventKind.HOMEWORK_INSPECTION_STARTED:
            book_id = event.book_id or ""
            previous = book_states.get(book_id)
            if previous and previous.inspection is InspectionStatus.IN_PROGRESS:
                raise JoinError("book inspection is already in progress")
            if previous and previous.inspection is InspectionStatus.COMPLETE:
                raise JoinError("completed book inspection needs a correction")
            book_states[book_id] = BookState(
                book_id, BookCustody.TEACHER,
                InspectionStatus.IN_PROGRESS, event.event_id)
        elif kind is EventKind.HOMEWORK_INSPECTION_CANCELLED:
            book_id = event.book_id or ""
            previous = book_states.get(book_id)
            if previous is None or previous.inspection is not InspectionStatus.IN_PROGRESS:
                raise JoinError("book inspection cancel needs an active inspection")
            book_states[book_id] = BookState(
                book_id, previous.custody, InspectionStatus.PENDING,
                event.event_id)
        elif kind is EventKind.HOMEWORK_ASSIGNED:
            book_id = event.book_id or ""
            assigned.setdefault(book_id, []).append(HomeworkAssignment(
                book_id, event.range_text or "", event.due_date, event.event_id,
            ))
        elif kind in _PAPER_KINDS:
            paper_no = event.paper_no or ""
            attempt_id = event.attempt_id or ""
            assessment_key = (paper_no, attempt_id)
            previous = assessments.get(
                assessment_key, AssessmentState(paper_no, attempt_id))
            if kind is EventKind.TEST_SUBMITTED:
                assessments[assessment_key] = AssessmentState(
                    paper_no, attempt_id, submitted=True)
            elif kind is EventKind.TEST_GRADED:
                if not previous.submitted:
                    raise JoinError("app grade cannot precede a known submission")
                assessments[assessment_key] = AssessmentState(
                    paper_no, attempt_id, True, True)
            elif kind is EventKind.CORRECTION_DONE:
                if not previous.graded:
                    raise JoinError("correction cannot precede a verified grade")
                assessments[assessment_key] = AssessmentState(
                    paper_no, attempt_id, True, True, True)
            elif kind is EventKind.TEACHER_VERIFIED:
                if not previous.correction_done:
                    raise JoinError("teacher correction check needs a correction event")
                assessments[assessment_key] = AssessmentState(
                    paper_no, attempt_id, True, True, True, True)
    current = None
    if active is not None:
        current = CurrentTask(
            active.activity_id or "", active.description or "",
            active.occurred_at, as_of - active.occurred_at,
        )
    return StudentClassroomState(
        key, current, waiting_since, next_task,
        MappingProxyType(checked_books), MappingProxyType(book_states),
        MappingProxyType({book_id: tuple(items) for book_id, items in assigned.items()}),
        MappingProxyType(assessments), len(effective),
    )


def commit_classroom_event(
    *, key: LessonKey, existing: Sequence[ClassroomEvent],
    event: ClassroomEvent, as_of: datetime,
) -> tuple[ClassroomEvent, ...]:
    """Validate one explicit input against its exact context, then append once.

    A Sheet or chat adapter must persist the returned log and read back the
    event ID. This pure function has no external effects or locking of its own.
    """
    _aware(as_of, "as_of")
    if event.key != key:
        raise JoinError("input event belongs to another lesson or student")
    if event.received_at > as_of or event.occurred_at > as_of:
        raise JoinError("input event is later than the commit time")
    for previous in existing:
        if previous.event_id == event.event_id:
            if previous != event:
                raise JoinError("event ID already belongs to different content")
            project_student_classroom(key=key, events=existing, as_of=as_of)
            return tuple(existing)
    appended = (*existing, event)
    project_student_classroom(key=key, events=appended, as_of=as_of)
    return appended
