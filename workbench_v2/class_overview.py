"""Date-first class preparation over exact, already reviewed lesson reads.

This module performs no I/O. The observed row count is never treated as proof
that the current tutor roster or app submission history is complete.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from types import MappingProxyType
from typing import Mapping, Sequence

from .core import (
    APP_FIELDS, AppPreparation, CourseAssignment, DayRecordSnapshot, Draft,
    Fact, JoinError, LessonKey, Projection, ReportEvidence, RosterEntry,
    SaveReadback, Source, SptProjection, _aware, _id, project_selection,
)


class SelectionState(str, Enum):
    NONE = "none"
    IN_SCOPE = "in_scope"
    OUT_OF_GROUP = "out_of_group"
    NOT_IN_LESSON = "not_in_lesson"


@dataclass(frozen=True)
class PreparationRow:
    key: LessonKey
    group_id: str
    school_grade: Fact[str]
    book: Fact[str]
    course_version: Fact[str]
    unit: Fact[str]
    preparation: Mapping[str, Fact[object]]


@dataclass(frozen=True)
class ClassOverview:
    lesson_date: date
    occurrence_id: str
    group_filter: str | None
    observed_count: int
    coverage: Fact[bool]
    rows: tuple[PreparationRow, ...]
    selection_state: SelectionState
    selected: Projection | None


def project_class_overview(
    *, lesson_date: date, occurrence_id: str, group_filter: str | None,
    selected_student_id: str | None, as_of: datetime, max_age: timedelta,
    roster: Sequence[RosterEntry], day_records: Sequence[DayRecordSnapshot],
    courses: Sequence[CourseAssignment] = (),
    app_preparation: Sequence[AppPreparation] = (),
    coverage: Fact[bool] | None = None,
    drafts: Sequence[Draft] = (),
    spt_activity: Sequence[SptProjection] = (),
    save_effects: Sequence[SaveReadback] = (),
    reports: Sequence[ReportEvidence] = (),
) -> ClassOverview:
    """Show observed date rows beside only the selected student's full detail.

    The caller must supply an exact occurrence identity. An out-of-context
    selection keeps its warning state but exposes no replacement student's
    detail. Missing app or course reads stay unknown.
    """
    _id(occurrence_id, "occurrence_id")
    _aware(as_of, "as_of")
    if max_age <= timedelta(0):
        raise ValueError("max_age must be positive")
    if group_filter not in (None, "0"):
        _id(group_filter, "group_filter")
    if len(roster) > 50 or len(day_records) > 50:
        raise JoinError("lesson read exceeds bounded class size")
    for label, batch in (("roster", roster), ("DayRecord", day_records),
                         ("course", courses), ("app", app_preparation)):
        if any(row.key.lesson_date != lesson_date or
               row.key.occurrence_id != occurrence_id for row in batch):
            raise JoinError(f"{label} contains a foreign lesson occurrence")
    if len({row.key for row in roster}) != len(roster):
        raise JoinError("duplicate lesson roster entry")
    if any(row.group_id == "0" for row in roster):
        raise JoinError("all-groups is a filter, not a student's group")

    coverage = coverage or Fact.unknown(
        Source.LMS_DAY_RECORD, "date/group row coverage not verified")
    if coverage.source is not Source.LMS_DAY_RECORD:
        raise JoinError("coverage has the wrong source")
    coverage = coverage.at(as_of, max_age)

    visible = [row for row in roster
               if group_filter in (None, "0") or row.group_id == group_filter]
    rows: list[PreparationRow] = []
    for member in visible:
        view = project_selection(
            selection=member.key, group_filter=group_filter, as_of=as_of,
            max_age=max_age, roster=roster, day_records=day_records,
            courses=courses, app_preparation=app_preparation,
        )
        rows.append(PreparationRow(
            member.key, view.group_id, view.school_grade, view.book,
            view.course_version, view.unit,
            MappingProxyType({name: view.preparation[name] for name in APP_FIELDS}),
        ))

    state = SelectionState.NONE
    selected = None
    if selected_student_id is not None:
        key = LessonKey(lesson_date, occurrence_id, selected_student_id)
        if key not in {row.key for row in roster}:
            state = SelectionState.NOT_IN_LESSON
        elif key not in {row.key for row in visible}:
            state = SelectionState.OUT_OF_GROUP
        else:
            state = SelectionState.IN_SCOPE
            selected = project_selection(
                selection=key, group_filter=group_filter, as_of=as_of,
                max_age=max_age, roster=roster, day_records=day_records,
                courses=courses, app_preparation=app_preparation, drafts=drafts,
                spt_activity=spt_activity, save_effects=save_effects,
                reports=reports,
            )
    return ClassOverview(
        lesson_date, occurrence_id, group_filter, len(rows), coverage,
        tuple(rows), state, selected,
    )
