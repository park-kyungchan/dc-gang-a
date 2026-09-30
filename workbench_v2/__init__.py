"""Local, read-only projection for the Park Main Sheet v2 first slice."""

from .core import (
    APP_FIELDS,
    DAY_RECORD_FIELDS,
    AppPreparation,
    CourseAssignment,
    DayRecordField,
    DayRecordReadbackTarget,
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
from .class_overview import (
    ClassOverview, PreparationRow, SelectionState, project_class_overview,
)
from .canonical_entities import (
    CANONICAL_ROSTER_PATH, CanonicalGroup, CanonicalLookupError,
    CanonicalRegistry, CanonicalStudent, CanonicalTeacher, canonical_registry,
    find_group, find_student, find_student_by_id, find_student_by_login_id,
    find_student_by_name, get_all_groups, get_all_students, get_cohort_students,
    get_group, get_raw_canonical_roster, get_student, get_student_by_id,
    get_student_by_login_id, get_student_by_name, get_students_by_group,
    get_teacher, has_student, is_cohort_student, reload_canonical_registry,
)
from .routes import (
    ROUTE_REGISTRY_PATH as LMS_ROUTE_REGISTRY_PATH,
    LmsRouteDefinition,
    LmsRouteRegistry,
    RouteLookupError,
    UnsafeMutatingOperationError,
    assert_safe_read,
    get_all_routes,
    get_route,
    has_route,
    is_safe_read,
)

__all__ = [
    "APP_FIELDS", "DAY_RECORD_FIELDS", "AppPreparation", "CourseAssignment",
    "DayRecordField", "DayRecordReadbackTarget", "DayRecordSnapshot", "DeliveryReceipt", "Draft",
    "DraftAuthor", "Fact", "FactState", "JoinError", "LessonKey",
    "Projection", "ReportEvidence", "RosterEntry", "SaveReadback",
    "SaveState", "Source", "SptProjection", "project_selection",
    "DAY_RECORD_READ", "STUDY_COURSE_READ", "AdaptedLmsReads",
    "CourseRead", "CourseRow", "DayRecordRead", "DayRecordRow",
    "OccurrenceBinding", "adapt_selected_lms_reads",
    "ClassOverview", "PreparationRow", "SelectionState", "project_class_overview",
    "CANONICAL_ROSTER_PATH", "CanonicalGroup", "CanonicalLookupError",
    "CanonicalRegistry", "CanonicalStudent", "CanonicalTeacher", "canonical_registry",
    "find_group", "find_student", "find_student_by_id", "find_student_by_login_id",
    "find_student_by_name", "get_all_groups", "get_all_students", "get_cohort_students",
    "get_group", "get_raw_canonical_roster", "get_student", "get_student_by_id",
    "get_student_by_login_id", "get_student_by_name", "get_students_by_group",
    "get_teacher", "has_student", "is_cohort_student", "reload_canonical_registry",
    "LMS_ROUTE_REGISTRY_PATH", "LmsRouteDefinition", "LmsRouteRegistry",
    "RouteLookupError", "UnsafeMutatingOperationError", "assert_safe_read",
    "get_all_routes", "get_route", "has_route", "is_safe_read",
]
