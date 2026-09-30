"""Canonical Entity Registry & Dual-Runtime SSoT Wrapper (Python 3.12 stdlib).

Provides deterministic, typed, O(1) lookups for the Daechi Whole-Lens cohort.
Driven strictly by data/canonical/canonical_roster.json.

Invariants:
- Single Source of Truth (SSoT): canonical_roster.json
- Fail-Closed: Unknown queries raise CanonicalLookupError, never silent toxic fallbacks
- Path-Safe: Absolute resolution anchored to Path(__file__).resolve(), independent of os.getcwd()
- Zero external dependencies: Python 3.12 stdlib only
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


class CanonicalLookupError(LookupError):
    """Raised when an unknown student, group, or entity is requested (fail-closed)."""
    pass


# Anchor path strictly relative to module file location
CANONICAL_ROSTER_PATH: Path = (
    Path(__file__).resolve().parent.parent / "data" / "canonical" / "canonical_roster.json"
)


@dataclass(frozen=True)
class CanonicalTeacher:
    teacher_pri_no: str
    teacher_id: str
    name: str
    academy: str
    branch: str
    sheet_tab_gid: str

    @property
    def teacherPriNo(self) -> str:
        return self.teacher_pri_no

    @property
    def teacherId(self) -> str:
        return self.teacher_id

    @property
    def sheetTabGid(self) -> str:
        return self.sheet_tab_gid


@dataclass(frozen=True)
class CanonicalGroup:
    group_id: str
    id: str
    name: str
    days: tuple[int, ...]
    time: str

    @property
    def groupId(self) -> str:
        return self.group_id


@dataclass(frozen=True)
class CanonicalStudent:
    student_id: str
    name: str
    login_id: str
    grade: str | None
    school_grade: str | None
    group: str | None
    group_id: str | None
    group_name: str | None
    course_seq: str | None
    cm_seq: str | None
    primary_book: str | None
    secondary_book: str | None
    is_test: bool

    @property
    def studentId(self) -> str:
        return self.student_id

    @property
    def loginId(self) -> str:
        return self.login_id

    @property
    def schoolGrade(self) -> str | None:
        return self.school_grade

    @property
    def groupId(self) -> str | None:
        return self.group_id

    @property
    def groupName(self) -> str | None:
        return self.group_name

    @property
    def courseSeq(self) -> str | None:
        return self.course_seq

    @property
    def cmSeq(self) -> str | None:
        return self.cm_seq

    @property
    def primaryBook(self) -> str | None:
        return self.primary_book

    @property
    def secondaryBook(self) -> str | None:
        return self.secondary_book

    @property
    def isTest(self) -> bool:
        return self.is_test


class CanonicalRegistry:
    """In-memory O(1) indexed lookup registry for canonical entities."""

    def __init__(self, roster_path: Path | str = CANONICAL_ROSTER_PATH) -> None:
        self._roster_path = Path(roster_path)
        self._raw: dict = {}
        self._teacher: CanonicalTeacher | None = None
        self._groups_by_id: dict[str, CanonicalGroup] = {}
        self._students_by_id: dict[str, CanonicalStudent] = {}
        self._students_by_login_id: dict[str, CanonicalStudent] = {}
        self._students_by_name: dict[str, CanonicalStudent] = {}
        self._students_by_group: dict[str, list[CanonicalStudent]] = {}
        self._cohort_students: list[CanonicalStudent] = []
        self._all_students: list[CanonicalStudent] = []
        self.reload(self._roster_path)

    def _load_roster(self, file_path: Path) -> dict:
        if not file_path.exists():
            raise CanonicalLookupError(f"Canonical roster file not found at: '{file_path}'")
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as err:
            raise CanonicalLookupError(
                f"Failed to parse canonical roster JSON at '{file_path}': {err}"
            ) from err

    def reload(self, custom_path: Path | str | None = None) -> None:
        target_path = Path(custom_path) if custom_path else self._roster_path
        self._raw = self._load_roster(target_path)

        # Parse teacher
        t_data = self._raw["teacher"]
        self._teacher = CanonicalTeacher(
            teacher_pri_no=str(t_data.get("teacherPriNo") or t_data.get("teacherId")),
            teacher_id=str(t_data.get("teacherId") or t_data.get("teacherPriNo")),
            name=str(t_data.get("name")),
            academy=str(t_data.get("academy")),
            branch=str(t_data.get("branch")),
            sheet_tab_gid=str(t_data.get("sheetTabGid")),
        )

        # Clear and index groups
        self._groups_by_id.clear()
        for key, g_data in self._raw.get("groups", {}).items():
            grp = CanonicalGroup(
                group_id=str(g_data.get("groupId", key)),
                id=str(g_data.get("id", key)),
                name=str(g_data.get("name")),
                days=tuple(g_data.get("days", ())),
                time=str(g_data.get("time")),
            )
            self._groups_by_id[key] = grp
            self._groups_by_id[grp.group_id] = grp
            self._groups_by_id[grp.id] = grp

        # Clear and index students
        self._students_by_id.clear()
        self._students_by_login_id.clear()
        self._students_by_name.clear()
        self._students_by_group.clear()
        self._cohort_students = []
        self._all_students = []

        for s_data in self._raw.get("students", []):
            student = CanonicalStudent(
                student_id=str(s_data.get("studentId")),
                name=str(s_data.get("name")),
                login_id=str(s_data.get("loginId")),
                grade=s_data.get("grade"),
                school_grade=s_data.get("schoolGrade", s_data.get("grade")),
                group=str(s_data.get("group")) if s_data.get("group") is not None else None,
                group_id=str(s_data.get("groupId", s_data.get("group"))) if (s_data.get("groupId") or s_data.get("group")) is not None else None,
                group_name=s_data.get("groupName"),
                course_seq=str(s_data.get("courseSeq")) if s_data.get("courseSeq") is not None else None,
                cm_seq=str(s_data.get("cmSeq")) if s_data.get("cmSeq") is not None else None,
                primary_book=s_data.get("primaryBook"),
                secondary_book=s_data.get("secondaryBook"),
                is_test=bool(s_data.get("isTest", False)),
            )

            self._all_students.append(student)
            self._students_by_id[student.student_id] = student
            self._students_by_login_id[student.login_id] = student
            self._students_by_name[student.name] = student

            if not student.is_test:
                self._cohort_students.append(student)

            grp = student.group_id or student.group
            if grp:
                if grp not in self._students_by_group:
                    self._students_by_group[grp] = []
                self._students_by_group[grp].append(student)

    def get_raw_roster(self) -> dict:
        return self._raw

    def get_teacher(self) -> CanonicalTeacher:
        if self._teacher is None:
            raise CanonicalLookupError("Teacher not loaded in canonical registry")
        return self._teacher

    def get_group(self, group_id: str) -> CanonicalGroup:
        grp = self._groups_by_id.get(str(group_id))
        if grp is None:
            raise CanonicalLookupError(f"Canonical group not found for ID: '{group_id}'")
        return grp

    def find_group(self, group_id: str) -> CanonicalGroup | None:
        return self._groups_by_id.get(str(group_id))

    def get_all_groups(self) -> list[CanonicalGroup]:
        seen = set()
        result = []
        for grp in self._groups_by_id.values():
            if grp.group_id not in seen:
                seen.add(grp.group_id)
                result.append(grp)
        return result

    def get_student_by_id(self, student_id: str) -> CanonicalStudent:
        student = self._students_by_id.get(str(student_id))
        if student is None:
            raise CanonicalLookupError(f"Canonical student not found for ID: '{student_id}'")
        return student

    def find_student_by_id(self, student_id: str) -> CanonicalStudent | None:
        return self._students_by_id.get(str(student_id))

    def get_student_by_name(self, name: str) -> CanonicalStudent:
        student = self._students_by_name.get(name)
        if student is None:
            raise CanonicalLookupError(f"Canonical student not found for name: '{name}'")
        return student

    def find_student_by_name(self, name: str) -> CanonicalStudent | None:
        return self._students_by_name.get(name)

    def get_student_by_login_id(self, login_id: str) -> CanonicalStudent:
        student = self._students_by_login_id.get(login_id)
        if student is None:
            raise CanonicalLookupError(f"Canonical student not found for login ID: '{login_id}'")
        return student

    def find_student_by_login_id(self, login_id: str) -> CanonicalStudent | None:
        return self._students_by_login_id.get(login_id)

    def get_student(self, identifier: str) -> CanonicalStudent:
        student = self.find_student(identifier)
        if student is None:
            raise CanonicalLookupError(f"Canonical student not found for identifier: '{identifier}'")
        return student

    def find_student(self, identifier: str) -> CanonicalStudent | None:
        if identifier in self._students_by_id:
            return self._students_by_id[identifier]
        if identifier in self._students_by_login_id:
            return self._students_by_login_id[identifier]
        if identifier in self._students_by_name:
            return self._students_by_name[identifier]
        return None

    def get_all_students(self, include_test: bool = False) -> list[CanonicalStudent]:
        if include_test:
            return list(self._all_students)
        return list(self._cohort_students)

    def get_cohort_students(self) -> list[CanonicalStudent]:
        return list(self._cohort_students)

    def get_students_by_group(self, group_id: str) -> list[CanonicalStudent]:
        return list(self._students_by_group.get(str(group_id), []))

    def is_cohort_student(self, student_id: str) -> bool:
        student = self._students_by_id.get(str(student_id))
        return bool(student and not student.is_test)

    def has_student(self, student_id: str) -> bool:
        return str(student_id) in self._students_by_id


# Global module singleton instance
canonical_registry = CanonicalRegistry()

# Functional export surface
get_teacher = canonical_registry.get_teacher
get_group = canonical_registry.get_group
find_group = canonical_registry.find_group
get_all_groups = canonical_registry.get_all_groups

get_student = canonical_registry.get_student
get_student_by_id = canonical_registry.get_student_by_id
get_student_by_name = canonical_registry.get_student_by_name
get_student_by_login_id = canonical_registry.get_student_by_login_id

find_student = canonical_registry.find_student
find_student_by_id = canonical_registry.find_student_by_id
find_student_by_name = canonical_registry.find_student_by_name
find_student_by_login_id = canonical_registry.find_student_by_login_id

get_all_students = canonical_registry.get_all_students
get_cohort_students = canonical_registry.get_cohort_students
get_students_by_group = canonical_registry.get_students_by_group
is_cohort_student = canonical_registry.is_cohort_student
has_student = canonical_registry.has_student

reload_canonical_registry = canonical_registry.reload
get_raw_canonical_roster = canonical_registry.get_raw_roster

# Parity camelCase aliases
getStudent = get_student
getStudentById = get_student_by_id
getStudentByName = get_student_by_name
getStudentByLoginId = get_student_by_login_id
findStudent = find_student
findStudentById = find_student_by_id
findStudentByName = find_student_by_name
findStudentByLoginId = find_student_by_login_id
getCohortStudents = get_cohort_students
getAllStudents = get_all_students
getStudentsByGroup = get_students_by_group
isCohortStudent = is_cohort_student
hasStudent = has_student
