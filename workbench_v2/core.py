"""Pure projection. No LMS/Sheets client, credential loader, or write operation.

Adapters must establish source-specific identifiers and semantic read contracts
before constructing these records. A matching name, page shell, or HTTP 200 is
not evidence of a selected-student fact.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from enum import Enum
from types import MappingProxyType
from typing import Generic, Mapping, Sequence, TypeVar


class JoinError(ValueError):
    """A selection or source join cannot safely be projected."""


class Source(str, Enum):
    LMS_ROSTER = "lms_roster"
    LMS_DAY_RECORD = "lms_day_record"
    LMS_COURSE = "lms_course"
    PRESTUDY_APP = "prestudy_app"
    TEACHER = "teacher"
    LLM = "llm"
    SPT = "spt_approved_projection"
    REPORT_PREVIEW = "lms_report_preview"
    SENT_LABEL = "lms_sent_label"
    DELIVERY_RECEIPT = "verified_delivery_receipt"


class FactState(str, Enum):
    KNOWN = "known"
    UNKNOWN = "unknown"
    STALE = "stale"


T = TypeVar("T")


def _aware(value: datetime, label: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must be timezone-aware")


def _id(value: str, label: str) -> None:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ValueError(f"{label} must be a nonempty opaque ID")


@dataclass(frozen=True)
class Fact(Generic[T]):
    state: FactState
    source: Source
    value: T | None = None
    observed_at: datetime | None = None
    reason: str | None = None

    def __post_init__(self) -> None:
        if self.observed_at is not None:
            _aware(self.observed_at, "observed_at")
        if self.state is FactState.KNOWN and (self.value is None or self.observed_at is None):
            raise ValueError("known facts need a value and observed_at")
        if self.state is not FactState.KNOWN and self.value is not None:
            raise ValueError("unknown/stale facts cannot expose a value")
        if self.state is not FactState.KNOWN and not self.reason:
            raise ValueError("unknown/stale facts need a reason")

    @classmethod
    def known(cls, value: T, source: Source, observed_at: datetime) -> Fact[T]:
        return cls(FactState.KNOWN, source, value, observed_at)

    @classmethod
    def unknown(cls, source: Source, reason: str = "not observed") -> Fact[T]:
        return cls(FactState.UNKNOWN, source, reason=reason)

    def at(self, as_of: datetime, max_age: timedelta) -> Fact[T]:
        """Hide an old current-state value; preserve source and observation time."""
        if self.observed_at is not None and self.observed_at > as_of:
            raise JoinError("source observation is later than projection time")
        if (self.state is FactState.KNOWN and self.observed_at is not None
                and as_of - self.observed_at > max_age):
            return Fact(FactState.STALE, self.source, observed_at=self.observed_at,
                        reason="source value older than max_age")
        return self


@dataclass(frozen=True)
class LessonKey:
    lesson_date: date
    occurrence_id: str
    student_id: str

    def __post_init__(self) -> None:
        _id(self.occurrence_id, "occurrence_id")
        _id(self.student_id, "student_id")


class DayRecordField(str, Enum):
    ATTENDANCE = "attendance"
    DAILY_TEST = "daily_test"
    PROGRESS = "progress"
    HOMEWORK = "homework"
    MEMO = "memo"
    HOMEWORK_RATE = "homework_rate"
    STUDENT_MEMO = "student_memo"
    UNIT_SELECTION = "unit_selection"


DAY_RECORD_FIELDS = tuple(DayRecordField)
APP_FIELDS = (
    "video_uploaded", "video_teacher_checked", "required_examples_assigned",
    "required_examples_submitted", "required_examples_auto_graded",
    "required_examples_corrected", "type_practice_assigned",
    "type_practice_submitted", "type_practice_auto_graded",
    "type_practice_corrected", "teacher_follow_up",
)


@dataclass(frozen=True)
class RosterEntry:
    key: LessonKey
    group_id: str
    school_grade: Fact[str]
    observed_at: datetime


@dataclass(frozen=True)
class DayRecordSnapshot:
    key: LessonKey
    course_id: str
    record_seq: str
    cm_seq: str
    fields: Mapping[DayRecordField, Fact[object]]
    observed_at: datetime


@dataclass(frozen=True)
class CourseAssignment:
    key: LessonKey
    course_id: str
    book: Fact[str]
    version: Fact[str]
    unit: Fact[str]
    effective_from: date
    effective_until: date | None
    observed_at: datetime


@dataclass(frozen=True)
class AppPreparation:
    key: LessonKey
    course_id: str
    join_verified: bool
    fields: Mapping[str, Fact[object]]
    observed_at: datetime


class DraftAuthor(str, Enum):
    TEACHER = "teacher"
    LLM = "llm"


@dataclass(frozen=True)
class Draft:
    key: LessonKey
    draft_id: str
    author: DraftAuthor
    text: Fact[str]
    revision: int
    reviewed_at: datetime | None = None
    reviewer_id: str | None = None
    supersedes_id: str | None = None
    correction_reason: str | None = None


@dataclass(frozen=True)
class SptProjection:
    key: LessonKey
    event_id: str
    receipt_id: str
    kind: str
    detail: Fact[object]
    approved: bool


class SaveState(str, Enum):
    REVIEWED = "reviewed"
    ATTEMPTED = "attempted"
    VERIFIED_READBACK = "verified_readback"
    ERROR = "error"


@dataclass(frozen=True)
class SaveReadback:
    """Imported audit evidence; this package never attempts an LMS save."""

    key: LessonKey
    record_seq: str
    field: DayRecordField
    proposed_value: object
    reviewer_id: str
    state: SaveState
    readback: Fact[object]
    effect_id: str
    reviewed_at: datetime
    attempted_at: datetime | None = None


@dataclass(frozen=True)
class DeliveryReceipt:
    report_seq: str
    receipt_id: str
    delivered_body: str


@dataclass(frozen=True)
class ReportEvidence:
    key: LessonKey
    report_seq: str
    current_preview: Fact[str]
    sent_label: Fact[bool]
    receipt: Fact[DeliveryReceipt]


@dataclass(frozen=True)
class Projection:
    key: LessonKey
    group_id: str
    school_grade: Fact[str]
    book: Fact[str]
    course_version: Fact[str]
    unit: Fact[str]
    day_record: Mapping[DayRecordField, Fact[object]]
    preparation: Mapping[str, Fact[object]]
    drafts: tuple[Draft, ...]
    spt_activity: tuple[SptProjection, ...]
    save_effects: tuple[SaveReadback, ...]
    report: ReportEvidence


def _one(rows: Sequence[T], key: LessonKey, label: str) -> T | None:
    found = [row for row in rows if row.key == key]  # type: ignore[attr-defined]
    if len(found) > 1:
        raise JoinError(f"ambiguous {label} for selected lesson/student")
    return found[0] if found else None


def _current(observed_at: datetime, as_of: datetime, max_age: timedelta, label: str) -> None:
    _aware(observed_at, f"{label}.observed_at")
    if observed_at > as_of or as_of - observed_at > max_age:
        raise JoinError(f"{label} snapshot is stale or from the future")


def _source(fact: Fact[object], expected: Source, label: str) -> None:
    if fact.source is not expected:
        raise JoinError(f"{label} has the wrong source")


def _not_future(fact: Fact[object], as_of: datetime, label: str) -> None:
    if fact.observed_at is not None and fact.observed_at > as_of:
        raise JoinError(f"{label} observation is later than projection time")


def project_selection(
    *, selection: LessonKey, group_filter: str | None, as_of: datetime,
    max_age: timedelta, roster: Sequence[RosterEntry],
    day_records: Sequence[DayRecordSnapshot],
    courses: Sequence[CourseAssignment] = (),
    app_preparation: Sequence[AppPreparation] = (),
    drafts: Sequence[Draft] = (),
    spt_activity: Sequence[SptProjection] = (),
    save_effects: Sequence[SaveReadback] = (),
    reports: Sequence[ReportEvidence] = (),
) -> Projection:
    """Project one date/occurrence/student from already reviewed, typed reads.

    Other students in the input batches are ignored. Any selected-student
    course/record mismatch, unverified app join, duplicate, stale context, or
    out-of-group selection fails closed. No fallback student is selected.
    """
    _aware(as_of, "as_of")
    if max_age <= timedelta(0):
        raise ValueError("max_age must be positive")
    member = _one(roster, selection, "roster entry")
    if member is None:
        raise JoinError("selected student is not in the selected lesson roster")
    if group_filter not in (None, "0") and member.group_id != group_filter:
        raise JoinError("selected student is outside the selected group")
    _id(member.group_id, "group_id")
    _current(member.observed_at, as_of, max_age, "roster")
    _source(member.school_grade, Source.LMS_ROSTER, "school grade")

    day = _one(day_records, selection, "DayRecord row")
    if day is None:
        raise JoinError("selected student has no verified DayRecord row")
    _current(day.observed_at, as_of, max_age, "DayRecord")
    for label, value in (("course_id", day.course_id), ("record_seq", day.record_seq),
                         ("cm_seq", day.cm_seq)):
        _id(value, label)
    if set(day.fields) != set(DAY_RECORD_FIELDS):
        raise JoinError("DayRecord must carry exactly the eight authorized fields")
    for field, fact in day.fields.items():
        _source(fact, Source.LMS_DAY_RECORD, field.value)
    day_view = {field: day.fields[field].at(as_of, max_age) for field in DAY_RECORD_FIELDS}

    course = _one(courses, selection, "course assignment")
    if course is not None:
        _current(course.observed_at, as_of, max_age, "course")
        if (course.course_id != day.course_id or
                not course.effective_from <= selection.lesson_date or
                (course.effective_until is not None and
                 selection.lesson_date > course.effective_until)):
            raise JoinError("course ID or effective date does not match selected DayRecord")
        for label, fact in (("book", course.book), ("version", course.version),
                            ("unit", course.unit)):
            _source(fact, Source.LMS_COURSE, label)
    course_facts = (
        (course.book.at(as_of, max_age), course.version.at(as_of, max_age),
         course.unit.at(as_of, max_age)) if course is not None else
        tuple(Fact.unknown(Source.LMS_COURSE, "course assignment not verified") for _ in range(3))
    )

    app = _one(app_preparation, selection, "app preparation")
    if app is not None:
        _current(app.observed_at, as_of, max_age, "app preparation")
        if not app.join_verified or app.course_id != day.course_id:
            raise JoinError("app student/course join is unverified or foreign")
        if set(app.fields) - set(APP_FIELDS):
            raise JoinError("unexpected app preparation field")
        for label, fact in app.fields.items():
            _source(fact, Source.PRESTUDY_APP, label)
    prep = {field: (app.fields[field].at(as_of, max_age) if app and field in app.fields
                    else Fact.unknown(Source.PRESTUDY_APP, "selected-student app read unavailable"))
            for field in APP_FIELDS}

    selected_drafts = tuple(d for d in drafts if d.key == selection)
    for draft in selected_drafts:
        _id(draft.draft_id, "draft_id")
        if draft.revision < 1 or (draft.reviewed_at is None) != (draft.reviewer_id is None):
            raise JoinError("draft revision/review metadata is invalid")
        if draft.reviewed_at is not None:
            _aware(draft.reviewed_at, "reviewed_at")
            _id(draft.reviewer_id, "reviewer_id")  # type: ignore[arg-type]
            if draft.reviewed_at > as_of:
                raise JoinError("draft review is later than projection time")
            if (draft.text.observed_at is not None and
                    draft.reviewed_at < draft.text.observed_at):
                raise JoinError("draft review predates this revision")
        _source(draft.text, Source(draft.author.value), "draft text")
        _not_future(draft.text, as_of, "draft text")
    if len({d.draft_id for d in selected_drafts}) != len(selected_drafts):
        raise JoinError("duplicate draft ID")
    draft_by_id = {d.draft_id: d for d in selected_drafts}
    for draft in selected_drafts:
        if draft.supersedes_id is not None:
            previous = draft_by_id.get(draft.supersedes_id)
            if previous is None or previous.revision >= draft.revision:
                raise JoinError("draft correction has no earlier retained revision")
            if not draft.correction_reason:
                raise JoinError("draft correction needs a reason")

    selected_spt = tuple(e for e in spt_activity if e.key == selection)
    for event in selected_spt:
        _id(event.event_id, "event_id")
        _id(event.receipt_id, "receipt_id")
        if not event.approved:
            raise JoinError("raw SPT event cannot enter the Sheet projection")
        _source(event.detail, Source.SPT, "SPT detail")
        _not_future(event.detail, as_of, "SPT detail")
    if len({e.event_id for e in selected_spt}) != len(selected_spt):
        raise JoinError("duplicate SPT event ID")

    selected_saves = tuple(e for e in save_effects if e.key == selection)
    for effect in selected_saves:
        _id(effect.effect_id, "effect_id")
        _id(effect.reviewer_id, "reviewer_id")
        _aware(effect.reviewed_at, "save.reviewed_at")
        if effect.reviewed_at > as_of:
            raise JoinError("save review is later than projection time")
        if effect.attempted_at is not None:
            _aware(effect.attempted_at, "save.attempted_at")
            if not effect.reviewed_at <= effect.attempted_at <= as_of:
                raise JoinError("save attempt is outside review/projection time")
        if effect.state is SaveState.VERIFIED_READBACK and effect.attempted_at is None:
            raise JoinError("verified save needs an attempted_at time")
        if effect.state is SaveState.REVIEWED and effect.attempted_at is not None:
            raise JoinError("reviewed-only save cannot have an attempt")
        if effect.state in (SaveState.ATTEMPTED, SaveState.ERROR) and effect.attempted_at is None:
            raise JoinError("attempted/error save needs an attempted_at time")
        if (effect.state is not SaveState.VERIFIED_READBACK and
                effect.readback.state is FactState.KNOWN):
            raise JoinError("unverified save cannot claim a known readback")
        if effect.record_seq != day.record_seq:
            raise JoinError("save readback targets a foreign DayRecord row")
        _source(effect.readback, Source.LMS_DAY_RECORD, "save readback")
        _not_future(effect.readback, as_of, "save readback")
        if (effect.state is SaveState.VERIFIED_READBACK and effect.readback.observed_at
                < effect.attempted_at):  # type: ignore[operator]
            raise JoinError("save readback predates attempt")
        if effect.state is SaveState.VERIFIED_READBACK and (
            effect.readback.state is not FactState.KNOWN or
            effect.readback.value != effect.proposed_value
        ):
            raise JoinError("verified save lacks an exact matching readback")
    if len({e.effect_id for e in selected_saves}) != len(selected_saves):
        raise JoinError("duplicate save effect ID")

    report = _one(reports, selection, "report evidence")
    if report is None:
        report = ReportEvidence(
            selection, "unknown",
            Fact.unknown(Source.REPORT_PREVIEW, "report preview not read"),
            Fact.unknown(Source.SENT_LABEL, "sent label not read"),
            Fact.unknown(Source.DELIVERY_RECEIPT, "delivery receipt not verified"),
        )
    else:
        _id(report.report_seq, "report_seq")
        _source(report.current_preview, Source.REPORT_PREVIEW, "report preview")
        _source(report.sent_label, Source.SENT_LABEL, "sent label")
        _source(report.receipt, Source.DELIVERY_RECEIPT, "delivery receipt")
        _not_future(report.receipt, as_of, "delivery receipt")
        if report.receipt.state is FactState.KNOWN:
            receipt = report.receipt.value
            if receipt is None or receipt.report_seq != report.report_seq:
                raise JoinError("receipt is not joined to the selected report")
            _id(receipt.receipt_id, "receipt_id")
            if not receipt.delivered_body:
                raise JoinError("receipt lacks the delivered body")
        report = replace(report, current_preview=report.current_preview.at(as_of, max_age),
                         sent_label=report.sent_label.at(as_of, max_age))

    return Projection(selection, member.group_id, member.school_grade.at(as_of, max_age),
                      course_facts[0], course_facts[1], course_facts[2],
                      MappingProxyType(day_view), MappingProxyType(prep),
                      selected_drafts, selected_spt, selected_saves, report)
