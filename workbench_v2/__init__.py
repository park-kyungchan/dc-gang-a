"""Local, read-only projection for the Park Main Sheet v2 first slice."""

from .core import (
    APP_FIELDS,
    DAY_RECORD_FIELDS,
    AppPreparation,
    CourseAssignment,
    DayRecordField,
    DayRecordSnapshot,
    DeliveryReceipt,
    Draft,
    DraftAuthor,
    Fact,
    FactState,
    JoinError,
    LessonKey,
    Projection,
    ReportEvidence,
    RosterEntry,
    SaveReadback,
    SaveState,
    Source,
    SptProjection,
    project_selection,
)
from .lms_read_adapter import (
    DAY_RECORD_READ, STUDY_COURSE_READ, AdaptedLmsReads, CourseRead,
    CourseRow, DayRecordRead, DayRecordRow, OccurrenceBinding,
    adapt_selected_lms_reads,
)

__all__ = [
    "APP_FIELDS", "DAY_RECORD_FIELDS", "AppPreparation", "CourseAssignment",
    "DayRecordField", "DayRecordSnapshot", "DeliveryReceipt", "Draft",
    "DraftAuthor", "Fact", "FactState", "JoinError", "LessonKey",
    "Projection", "ReportEvidence", "RosterEntry", "SaveReadback",
    "SaveState", "Source", "SptProjection", "project_selection",
    "DAY_RECORD_READ", "STUDY_COURSE_READ", "AdaptedLmsReads",
    "CourseRead", "CourseRow", "DayRecordRead", "DayRecordRow",
    "OccurrenceBinding", "adapt_selected_lms_reads",
]
