"""Bind reviewed LMS read extracts to one lesson; this module performs no I/O.

Callers must classify the live operation, parse only a bounded response, and
establish the occurrence and course-key relations before setting proof flags.
This adapter cannot establish those proofs from a page shell or matching name.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Mapping, Sequence

from .core import (
    DAY_RECORD_FIELDS, CourseAssignment, DayRecordField, DayRecordSnapshot,
    Fact, JoinError, LessonKey, RosterEntry, Source, _aware, _id,
)


DAY_RECORD_READ = "POST DayRecordServlet p_process=Main"
STUDY_COURSE_READ = "POST CourseManageServlet reqCmd=StudyCourse"


@dataclass(frozen=True)
class OccurrenceBinding:
    """An independently checked link from a lesson occurrence to one LMS row."""

    key: LessonKey
    record_seq: str
    evidence_ref: str
    verified: bool


@dataclass(frozen=True)
class DayRecordRow:
    student_id: str
    course_id: str
    record_seq: str
    cm_seq: str
    fields: Mapping[DayRecordField, Fact[object]]


@dataclass(frozen=True)
class DayRecordRead:
    operation: str
    lesson_date: date
    group_id: str
    observed_at: datetime
    pages_read: tuple[int, ...]
    total_pages: int
    pagination_verified: bool
    rows: Sequence[DayRecordRow]


@dataclass(frozen=True)
class CourseRow:
    student_id: str
    source_course_id: str
    linked_day_course_id: str | None
    key_relation_verified: bool
    effective_from: date
    effective_until: date | None
    book: Fact[str]
    version: Fact[str]
    unit: Fact[str]


@dataclass(frozen=True)
class CourseRead:
    operation: str
    student_id: str
    observed_at: datetime
    pages_read: tuple[int, ...]
    total_pages: int
    pagination_verified: bool
    rows: Sequence[CourseRow]


@dataclass(frozen=True)
class AdaptedLmsReads:
    """Date-scoped membership, exact DayRecord, and optional verified course."""

    roster_entry: RosterEntry
    day_record: DayRecordSnapshot
    course: CourseAssignment | None


def _complete(pages: tuple[int, ...], total: int, verified: bool, label: str) -> None:
    if not verified or total < 1 or total > 20 or pages != tuple(range(1, total + 1)):
        raise JoinError(f"{label} pagination is unverified or incomplete")


def adapt_selected_lms_reads(
    *, selection: LessonKey, binding: OccurrenceBinding,
    day_read: DayRecordRead, course_read: CourseRead | None = None,
) -> AdaptedLmsReads:
    """Adapt one selected group/date/student after independent source review.

    A date-valid course without a verified key relation is deliberately omitted.
    No current Park roster completeness or app preparation is inferred.
    """
    if not binding.verified or binding.key != selection or not binding.evidence_ref:
        raise JoinError("selected occurrence binding is unverified")
    _id(binding.record_seq, "binding.record_seq")
    if day_read.operation != DAY_RECORD_READ or day_read.lesson_date != selection.lesson_date:
        raise JoinError("DayRecord operation or date does not match selection")
    _id(day_read.group_id, "group_id")
    if day_read.group_id == "0":
        raise JoinError("selected group must be explicit for lesson membership")
    _aware(day_read.observed_at, "DayRecord read time")
    _complete(day_read.pages_read, day_read.total_pages,
              day_read.pagination_verified, "DayRecord")

    matches = [row for row in day_read.rows if row.student_id == selection.student_id]
    if len(matches) != 1:
        raise JoinError("selected DayRecord student is absent or ambiguous")
    row = matches[0]
    if row.record_seq != binding.record_seq:
        raise JoinError("DayRecord row does not match occurrence binding")
    for label, value in (("student_id", row.student_id), ("course_id", row.course_id),
                         ("record_seq", row.record_seq), ("cm_seq", row.cm_seq)):
        _id(value, label)
    if set(row.fields) != set(DAY_RECORD_FIELDS):
        raise JoinError("DayRecord extract must carry exactly eight fields")
    for field, fact in row.fields.items():
        if fact.source is not Source.LMS_DAY_RECORD:
            raise JoinError(f"{field.value} has the wrong source")
        if fact.observed_at is not None and fact.observed_at > day_read.observed_at:
            raise JoinError(f"{field.value} was observed after the DayRecord read")

    roster = RosterEntry(selection, day_read.group_id,
                         Fact.unknown(Source.LMS_ROSTER, "school grade not read"),
                         day_read.observed_at)
    day = DayRecordSnapshot(selection, row.course_id, row.record_seq, row.cm_seq,
                            row.fields, day_read.observed_at)
    course = None
    if course_read is not None:
        if course_read.operation != STUDY_COURSE_READ or course_read.student_id != selection.student_id:
            raise JoinError("StudyCourse operation or selected student does not match")
        _aware(course_read.observed_at, "StudyCourse read time")
        _complete(course_read.pages_read, course_read.total_pages,
                  course_read.pagination_verified, "StudyCourse")
        valid = [candidate for candidate in course_read.rows
                 if candidate.student_id == selection.student_id
                 and candidate.effective_from <= selection.lesson_date
                 and (candidate.effective_until is None or
                      selection.lesson_date <= candidate.effective_until)]
        if len(valid) > 1:
            raise JoinError("multiple date-valid StudyCourse rows are ambiguous")
        if valid:
            candidate = valid[0]
            _id(candidate.source_course_id, "source_course_id")
            if candidate.key_relation_verified:
                if candidate.linked_day_course_id != row.course_id:
                    raise JoinError("StudyCourse key relation targets a foreign DayRecord course")
                for label, fact in (("book", candidate.book),
                                    ("version", candidate.version),
                                    ("unit", candidate.unit)):
                    if fact.source is not Source.LMS_COURSE:
                        raise JoinError(f"{label} has the wrong source")
                    if fact.observed_at is not None and fact.observed_at > course_read.observed_at:
                        raise JoinError(f"{label} was observed after the StudyCourse read")
                course = CourseAssignment(selection, row.course_id, candidate.book,
                                          candidate.version, candidate.unit,
                                          candidate.effective_from,
                                          candidate.effective_until,
                                          course_read.observed_at)
    return AdaptedLmsReads(roster, day, course)
