"""Append-only classroom raw input and whole-class end-of-day review projection.

The caller establishes the exact student/lesson selector and persists events.
This module performs no chat parsing, Sheet write, scheduling, or notification.
It returns IDs and counts, never teacher raw text in the summary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Sequence

from .core import JoinError, LessonKey, _aware, _id


class RawSource(str, Enum):
    TEACHER_CHAT = "teacher_chat"
    TEACHER_SHEET = "teacher_sheet"


class ReviewDisposition(str, Enum):
    RESOLVED = "resolved"
    CARRY_FORWARD = "carry_forward"


@dataclass(frozen=True)
class RawObservation:
    input_id: str
    key: LessonKey
    text: str
    source: RawSource
    received_at: datetime
    source_ref: str

    def __post_init__(self) -> None:
        _id(self.input_id, "input_id")
        _id(self.source_ref, "source_ref")
        _aware(self.received_at, "received_at")
        if not self.text.strip():
            raise ValueError("raw observation cannot be empty")


@dataclass(frozen=True)
class ReviewDecision:
    decision_id: str
    input_id: str
    key: LessonKey
    disposition: ReviewDisposition
    reviewed_at: datetime
    reviewer_id: str
    normalized_event_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        for label in ("decision_id", "input_id", "reviewer_id"):
            _id(getattr(self, label), label)
        _aware(self.reviewed_at, "reviewed_at")
        if not self.normalized_event_ids:
            raise ValueError("review needs a normalized or carry-forward event")
        for event_id in self.normalized_event_ids:
            _id(event_id, "normalized_event_id")


@dataclass(frozen=True)
class EndOfDayQueue:
    lesson_date: date
    pending_ids_by_student: Mapping[str, tuple[str, ...]]
    total_pending: int
    reminder_window_active: bool


def project_end_of_day(
    *, lesson_date: date, student_ids: Sequence[str],
    observations: Sequence[RawObservation], decisions: Sequence[ReviewDecision],
    as_of: datetime,
) -> EndOfDayQueue:
    """Expose every student's pending raw input; callable at any time.

    The 21:30-22:00 local window only marks a UI reminder opportunity. A
    scheduled notification or a teacher approval is outside this projection.
    """
    _aware(as_of, "as_of")
    if len(set(student_ids)) != len(student_ids):
        raise JoinError("duplicate roster student")
    for student_id in student_ids:
        _id(student_id, "student_id")
    pending: dict[str, list[str]] = {student_id: [] for student_id in student_ids}
    raw_by_id: dict[str, RawObservation] = {}
    for raw in observations:
        if raw.input_id in raw_by_id:
            raise JoinError("duplicate raw input ID")
        if raw.key.student_id not in pending or raw.key.lesson_date != lesson_date:
            raise JoinError("raw input student or lesson scope mismatch")
        raw_by_id[raw.input_id] = raw
        if raw.received_at <= as_of:
            pending[raw.key.student_id].append(raw.input_id)
    reviewed: set[str] = set()
    decision_ids: set[str] = set()
    for decision in decisions:
        if decision.decision_id in decision_ids or decision.input_id in reviewed:
            raise JoinError("duplicate review decision")
        decision_ids.add(decision.decision_id)
        raw = raw_by_id.get(decision.input_id)
        if raw is None or raw.key != decision.key:
            raise JoinError("review decision raw-input binding mismatch")
        if decision.reviewed_at < raw.received_at:
            raise JoinError("review predates raw observation")
        if decision.reviewed_at <= as_of:
            reviewed.add(decision.input_id)
    projected = MappingProxyType({
        student_id: tuple(input_id for input_id in input_ids
                          if input_id not in reviewed)
        for student_id, input_ids in pending.items()
    })
    total = sum(len(input_ids) for input_ids in projected.values())
    korea_now = as_of.astimezone(timezone(timedelta(hours=9)))
    local_clock = korea_now.time()
    return EndOfDayQueue(
        lesson_date, projected, total,
        bool(total and korea_now.date() == lesson_date
             and time(21, 30) <= local_clock <= time(22, 0)),
    )
