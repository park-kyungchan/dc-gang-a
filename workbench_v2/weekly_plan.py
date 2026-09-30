"""Evidence-gated, read-only homework quantity proposal for one student/book.

This pure calculator does not discover a calendar, textbook, student history, or
page states. A caller must bind those to exact backend/teacher evidence first.
The result is a draft for teacher review, never an assignment or LMS write.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from fractions import Fraction
from math import ceil, floor
from typing import Sequence

from .core import JoinError, _id
from .page_progress import PageState


@dataclass(frozen=True)
class UnitPageAudit:
    unit_id: str
    book_edition_id: str
    first_page: int
    page_states: tuple[PageState, ...]
    source_ref: str

    def __post_init__(self) -> None:
        for label in ("unit_id", "book_edition_id", "source_ref"):
            _id(getattr(self, label), label)
        if self.first_page < 1 or not self.page_states:
            raise ValueError("unit needs a positive, nonempty page interval")
        if any(not isinstance(state, PageState) for state in self.page_states):
            raise ValueError("unit page state is invalid")


@dataclass(frozen=True)
class PaceEvidence:
    """Teacher-verified completed subunits during a measured prior interval."""

    student_id: str
    book_edition_id: str
    period_start: date
    period_end: date
    completed_units: int
    source_ref: str

    def __post_init__(self) -> None:
        _id(self.student_id, "student_id")
        _id(self.book_edition_id, "book_edition_id")
        _id(self.source_ref, "source_ref")
        if self.completed_units < 0 or not 1 <= (self.period_end - self.period_start).days <= 60:
            raise ValueError("invalid observed pace")


@dataclass(frozen=True)
class QuantityProposal:
    student_id: str
    book_edition_id: str
    start_date: date
    next_date: date
    calendar_source_ref: str
    unit_source_ref: str
    baseline_low: int
    baseline_high: int
    unfinished_pages: int
    unfinished_units: int
    page_share_ceiling: Fraction | None
    observed_capacity: Fraction | None
    suggested_new_low: int | None
    suggested_new_high: int | None
    review_reason: str


def propose_book_quantity(
    *, student_id: str, book_edition_id: str, start_date: date,
    next_date: date, calendar_complete: bool, calendar_source_ref: str,
    unit_source_ref: str, page_audit_complete: bool,
    assignment_source_ref: str, outstanding_unit_ids: Sequence[str],
    weekly_min: int, weekly_max: int,
    unfinished_units: Sequence[UnitPageAudit], pace: PaceEvidence | None,
) -> QuantityProposal:
    """Scale baseline by elapsed days, then subtract verified unfinished work.

    An unverified page or missing personal pace yields a baseline and a review
    reason, not a fabricated exact new-unit count. A lower candidate counts
    every unfinished subunit as a full slot. An upper candidate subtracts its
    page share, which is a capacity ceiling, not a difficulty estimate. Exact
    page targets still need a verified edition TOC and teacher selection.
    """
    _id(student_id, "student_id")
    _id(book_edition_id, "book_edition_id")
    _id(calendar_source_ref, "calendar_source_ref")
    _id(unit_source_ref, "unit_source_ref")
    _id(assignment_source_ref, "assignment_source_ref")
    if not calendar_complete:
        raise JoinError("calendar coverage is unverified")
    if not page_audit_complete:
        raise JoinError("page audit coverage is unverified")
    days = (next_date - start_date).days
    if days < 1 or days > 60:
        raise ValueError("planning interval must be 1 to 60 days")
    if weekly_min < 0 or weekly_max < weekly_min:
        raise ValueError("invalid weekly target policy")
    if pace is not None and (
        pace.student_id != student_id or pace.book_edition_id != book_edition_id
        or pace.period_end > start_date
    ):
        raise JoinError("individual pace student, edition, or period mismatch")
    seen: set[str] = set()
    seen_pages: set[int] = set()
    unresolved = False
    unfinished_pages = 0
    page_share_ceiling = Fraction(0)
    unfinished_unit_count = 0
    if len(set(outstanding_unit_ids)) != len(outstanding_unit_ids):
        raise JoinError("duplicate outstanding assignment unit")
    for unit_id in outstanding_unit_ids:
        _id(unit_id, "outstanding_unit_id")
    for unit in unfinished_units:
        if unit.book_edition_id != book_edition_id or unit.unit_id in seen:
            raise JoinError("unit edition mismatch or duplicate unit")
        seen.add(unit.unit_id)
        pages = set(range(unit.first_page, unit.first_page + len(unit.page_states)))
        if seen_pages.intersection(pages):
            raise JoinError("overlapping unit page intervals")
        seen_pages.update(pages)
        incomplete = sum(state in (PageState.NOT_DONE, PageState.REOPENED)
                         for state in unit.page_states)
        uncertain = any(state in (PageState.UNKNOWN, PageState.ASSIGNED,
                                  PageState.REPORTED_DONE)
                        for state in unit.page_states)
        unfinished_pages += incomplete
        unfinished_unit_count += incomplete > 0
        page_share_ceiling += Fraction(incomplete, len(unit.page_states))
        unresolved = unresolved or uncertain
    if seen != set(outstanding_unit_ids):
        raise JoinError("outstanding assignment and page audit coverage mismatch")
    baseline_low = ceil(Fraction(weekly_min * days, 7))
    baseline_high = ceil(Fraction(weekly_max * days, 7))
    capacity = (Fraction(pace.completed_units * days,
                         (pace.period_end - pace.period_start).days)
                if pace is not None else None)
    low = (max(0, floor(capacity - unfinished_unit_count))
           if capacity is not None and not unresolved else None)
    high = (max(0, floor(capacity - page_share_ceiling))
            if capacity is not None and not unresolved else None)
    reason = ("page evidence unresolved" if unresolved else
              "individual pace unavailable" if pace is None else
              "teacher review required")
    return QuantityProposal(
        student_id, book_edition_id, start_date, next_date,
        calendar_source_ref, unit_source_ref, baseline_low, baseline_high,
        unfinished_pages, unfinished_unit_count,
        None if unresolved else page_share_ceiling,
        capacity, low, high, reason,
    )
