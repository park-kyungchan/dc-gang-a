"""Exact previous-homework binding for a classroom concept whiteboard test.

The caller must obtain the previous occurrence relation and assignment rows
from reviewed source contracts. This module does no date guessing or I/O.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Sequence

from .core import JoinError, LessonKey, _id


class OccurrenceStatus(str, Enum):
    HELD = "held"
    CANCELLED = "cancelled"
    PLANNED = "planned"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class CalendarOccurrence:
    key: LessonKey
    status: OccurrenceStatus


def contradicting_held_occurrence(
    *, current_key: LessonKey, teacher_prior_date: date,
    observed: Sequence[CalendarOccurrence], evidence_verified: bool,
) -> LessonKey | None:
    """Find a proven held lesson later than a teacher's prior-date hint.

    One later held lesson disproves the hint even if intervening schedule
    coverage is incomplete. No result does not prove the hint is correct.
    """
    if not evidence_verified:
        raise JoinError("held occurrence evidence is unverified")
    if teacher_prior_date >= current_key.lesson_date:
        raise JoinError("teacher prior date is not earlier than current")
    if any(item.key.student_id != current_key.student_id for item in observed):
        raise JoinError("held occurrence student scope mismatch")
    later = [item.key for item in observed
             if item.status is OccurrenceStatus.HELD
             and teacher_prior_date < item.key.lesson_date < current_key.lesson_date]
    return max(later, key=lambda key: key.lesson_date) if later else None


def previous_held_occurrence(
    *, current_key: LessonKey, calendar: Sequence[CalendarOccurrence],
    coverage_verified: bool, source_ref: str,
) -> LessonKey:
    """Select the prior held lesson, skipping proven cancellations only.

    `coverage_verified` means the reviewed source lists every scheduled
    occurrence through the current lesson for this student. A teacher's date
    suggestion alone must not set this flag.
    """
    _id(source_ref, "source_ref")
    if not coverage_verified:
        raise JoinError("calendar coverage is unverified")
    if not calendar or any(item.key.student_id != current_key.student_id
                           for item in calendar):
        raise JoinError("calendar student scope mismatch")
    current = [item for item in calendar if item.key == current_key]
    if len(current) != 1 or current[0].status not in (
            OccurrenceStatus.PLANNED, OccurrenceStatus.HELD):
        raise JoinError("current occurrence missing or cancelled")
    earlier = [item for item in calendar if item.key.lesson_date < current_key.lesson_date]
    held = [item for item in earlier if item.status is OccurrenceStatus.HELD]
    if not held:
        raise JoinError("no previous held occurrence")
    latest_date = max(item.key.lesson_date for item in held)
    latest = [item for item in held if item.key.lesson_date == latest_date]
    if len(latest) != 1:
        raise JoinError("ambiguous previous held occurrence")
    if any(item.status is not OccurrenceStatus.CANCELLED
           for item in earlier if item.key.lesson_date > latest_date):
        raise JoinError("intervening occurrence is unresolved")
    return latest[0].key


@dataclass(frozen=True)
class PriorAssignment:
    assignment_id: str
    source_key: LessonKey
    book_id: str
    range_text: str
    source_ref: str

    def __post_init__(self) -> None:
        _id(self.assignment_id, "assignment_id")
        _id(self.book_id, "book_id")
        _id(self.source_ref, "source_ref")
        if not self.range_text.strip():
            raise ValueError("prior homework needs an exact range")


@dataclass(frozen=True)
class ConceptScope:
    current_key: LessonKey
    previous_key: LessonKey
    assignments: tuple[PriorAssignment, ...]
    link_source_ref: str


def bind_concept_scope(
    *, current_key: LessonKey, previous_key: LessonKey,
    link_source_ref: str, assignments: Sequence[PriorAssignment],
) -> ConceptScope:
    """Use only the verified previous occurrence's homework, per book.

    An empty or mixed-source result stays unbound. A holiday, absence, or
    makeup gap does not change the exact previous occurrence supplied by the
    reviewed adapter.
    """
    _id(link_source_ref, "link_source_ref")
    if previous_key.student_id != current_key.student_id:
        raise JoinError("previous homework belongs to another student")
    if previous_key == current_key or previous_key.lesson_date > current_key.lesson_date:
        raise JoinError("previous occurrence is not earlier than the current one")
    if not assignments:
        raise JoinError("previous occurrence has no verified homework assignments")
    seen: set[str] = set()
    for item in assignments:
        if item.source_key != previous_key:
            raise JoinError("homework assignment belongs to another occurrence")
        if item.assignment_id in seen:
            raise JoinError("duplicate homework assignment ID")
        seen.add(item.assignment_id)
    return ConceptScope(current_key, previous_key, tuple(assignments), link_source_ref)
