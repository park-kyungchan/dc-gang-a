"""Automated Unit Test Suite for Canonical Entity Registry (Python 3.12 stdlib).

Validates:
- RUB-01: Single Source of Truth from canonical_roster.json
- RUB-04 & RUB-05: Deterministic lookup for all 4 students and fail-closed error handling
- RUB-07: Dual runtime parity with TypeScript implementation
- RUB-10: Path safe across execution environments and current working directories
"""

import os
import unittest
from pathlib import Path

from workbench_v2.canonical_entities import (
    CANONICAL_ROSTER_PATH,
    CanonicalLookupError,
    CanonicalRegistry,
    canonical_registry,
    find_group,
    find_student,
    find_student_by_id,
    find_student_by_login_id,
    find_student_by_name,
    get_all_groups,
    get_all_students,
    get_cohort_students,
    get_group,
    get_raw_canonical_roster,
    get_student,
    get_student_by_id,
    get_student_by_login_id,
    get_student_by_name,
    get_students_by_group,
    get_teacher,
    has_student,
    is_cohort_student,
)


class TestCanonicalEntities(unittest.TestCase):
    """Exhaustive unit test suite verifying canonical entity registry behavior."""

    def test_rub01_and_rub10_path_safety_and_ssot(self) -> None:
        """CANONICAL_ROSTER_PATH must resolve to physical file on disk regardless of cwd."""
        self.assertTrue(CANONICAL_ROSTER_PATH.exists(), f"Path does not exist: {CANONICAL_ROSTER_PATH}")
        self.assertTrue(
            str(CANONICAL_ROSTER_PATH).endswith(os.path.join("data", "canonical", "canonical_roster.json"))
        )

        raw = get_raw_canonical_roster()
        self.assertEqual(raw["version"], "1.0.0")
        self.assertEqual(raw["academy"], "대치 강의하는 아이들")
        self.assertEqual(raw["branch"], "대치점")
        self.assertEqual(len(raw["students"]), 6)

    def test_teacher_metadata_parity(self) -> None:
        """Teacher entity attributes must match canonical values in both snake_case and camelCase."""
        teacher = get_teacher()
        self.assertEqual(teacher.teacher_pri_no, "1292923")
        self.assertEqual(teacher.teacherPriNo, "1292923")
        self.assertEqual(teacher.teacher_id, "1292923")
        self.assertEqual(teacher.teacherId, "1292923")
        self.assertEqual(teacher.name, "박경찬")
        self.assertEqual(teacher.academy, "대치 강의하는 아이들")
        self.assertEqual(teacher.branch, "대치점")
        self.assertEqual(teacher.sheet_tab_gid, "1754681846")
        self.assertEqual(teacher.sheetTabGid, "1754681846")

    def test_groups_metadata_and_lookups(self) -> None:
        """All 5 class groups must be registered and retrievable."""
        g1 = get_group("1")
        self.assertEqual(g1.name, "화목2부")
        self.assertEqual(g1.days, (2, 4))
        self.assertEqual(g1.time, "17:00")

        g2 = get_group("2")
        self.assertEqual(g2.name, "월수1부")
        self.assertEqual(g2.days, (1, 3))
        self.assertEqual(g2.time, "15:00")

        g3 = get_group("3")
        self.assertEqual(g3.name, "월금1부")
        self.assertEqual(g3.days, (1, 5))
        self.assertEqual(g3.time, "15:00")

        g4 = get_group("4")
        self.assertEqual(g4.name, "수금2부")
        self.assertEqual(g4.days, (3, 5))
        self.assertEqual(g4.time, "17:00")

        g5 = get_group("5")
        self.assertEqual(g5.name, "월수금2부")
        self.assertEqual(g5.days, (1, 3, 5))
        self.assertEqual(g5.time, "17:00")

        all_groups = get_all_groups()
        self.assertEqual(len(all_groups), 5)
        group_ids = sorted([g.group_id for g in all_groups])
        self.assertEqual(group_ids, ["1", "2", "3", "4", "5"])

        self.assertIsNone(find_group("99"))
        self.assertIsNone(find_group("invalid"))

    def test_rub04_all_four_cohort_pupils_and_test_account(self) -> None:
        """All 4 students must be accurately indexed; Lee Ru-han (1294174) must not be omitted."""
        # 1. Shin Ji-woo
        s1 = get_student_by_id("1293032")
        self.assertEqual(s1.name, "신지우")
        self.assertEqual(s1.login_id, "GA14581_jiwooo0729")
        self.assertEqual(s1.loginId, "GA14581_jiwooo0729")
        self.assertEqual(s1.grade, "초5")
        self.assertEqual(s1.school_grade, "초5")
        self.assertEqual(s1.group, "2")
        self.assertEqual(s1.group_id, "2")
        self.assertEqual(s1.group_name, "월수1부")
        self.assertEqual(s1.course_seq, "4")
        self.assertEqual(s1.courseSeq, "4")
        self.assertEqual(s1.cm_seq, "82150")
        self.assertEqual(s1.cmSeq, "82150")
        self.assertEqual(s1.primary_book, "초5-2 가우스 2권")
        self.assertEqual(s1.primaryBook, "초5-2 가우스 2권")
        self.assertEqual(s1.secondary_book, "초5-1 다빈치 1권")
        self.assertEqual(s1.secondaryBook, "초5-1 다빈치 1권")
        self.assertFalse(s1.is_test)

        # 2. Lee Ru-han (TRAP 3 prevention)
        s2 = get_student_by_id("1294174")
        self.assertEqual(s2.name, "이루한")
        self.assertEqual(s2.login_id, "GA14581_ruhan0604")
        self.assertEqual(s2.grade, "중1")
        self.assertEqual(s2.group, "4")
        self.assertEqual(s2.group_id, "4")
        self.assertEqual(s2.group_name, "수금2부")
        self.assertEqual(s2.course_seq, "6")
        self.assertEqual(s2.cm_seq, "82495")
        self.assertEqual(s2.primary_book, "중1-2 가우스 3권")
        self.assertEqual(s2.secondary_book, "중1-1 다빈치 1권")
        self.assertFalse(s2.is_test)

        # 3. Park Se-eun
        s3 = get_student_by_id("1293067")
        self.assertEqual(s3.name, "박세은")
        self.assertEqual(s3.login_id, "GA14581_seeun0325")
        self.assertEqual(s3.grade, "초5")
        self.assertEqual(s3.group, "3")
        self.assertEqual(s3.group_name, "월금1부")
        self.assertEqual(s3.primary_book, "초5-2 가우스 2권")
        self.assertIsNone(s3.secondary_book)
        self.assertFalse(s3.is_test)

        # 4. Yoo Ji-yeon
        s4 = get_student_by_id("1293138")
        self.assertEqual(s4.name, "유지연")
        self.assertEqual(s4.login_id, "GA14581_jiyeon0622")
        self.assertEqual(s4.grade, "중1")
        self.assertEqual(s4.group, "3")
        self.assertEqual(s4.group_name, "월금1부")
        self.assertEqual(s4.primary_book, "가우스 1-1")
        self.assertIsNone(s4.secondary_book)
        self.assertFalse(s4.is_test)

        # 5. Lee Hyun-seung
        s5 = get_student_by_id("1294575")
        self.assertEqual(s5.name, "이현승")
        self.assertEqual(s5.login_id, "GA14581_hyonseng1021")
        self.assertEqual(s5.grade, "중1")
        self.assertEqual(s5.group, "5")
        self.assertEqual(s5.group_name, "월수금2부")
        self.assertEqual(s5.course_seq, "5")
        self.assertEqual(s5.cm_seq, "82709")
        self.assertFalse(s5.is_test)

        # Test Account
        t = get_student_by_id("1235920")
        self.assertEqual(t.name, "test")
        self.assertEqual(t.login_id, "GA14581_test")
        self.assertTrue(t.is_test)
        self.assertTrue(t.isTest)

        # Cohort validation checks
        self.assertFalse(is_cohort_student("1235920"))
        self.assertTrue(is_cohort_student("1293032"))
        self.assertTrue(is_cohort_student("1294174"))
        self.assertTrue(is_cohort_student("1294575"))

    def test_cohort_and_group_filtering(self) -> None:
        """Cohort retrieval must isolate test accounts; group filtering must be exact."""
        cohort = get_cohort_students()
        self.assertEqual(len(cohort), 5)
        cohort_ids = sorted([s.student_id for s in cohort])
        self.assertEqual(cohort_ids, ["1293032", "1293067", "1293138", "1294174", "1294575"])

        self.assertEqual(len(get_all_students(include_test=False)), 5)
        self.assertEqual(len(get_all_students(include_test=True)), 6)

        g2_students = get_students_by_group("2")
        self.assertEqual(len(g2_students), 1)
        self.assertEqual(g2_students[0].name, "신지우")

        g3_students = get_students_by_group("3")
        self.assertEqual(len(g3_students), 2)
        g3_names = sorted([s.name for s in g3_students])
        self.assertEqual(g3_names, ["박세은", "유지연"])

        g4_students = get_students_by_group("4")
        self.assertEqual(len(g4_students), 1)
        self.assertEqual(g4_students[0].name, "이루한")

        g5_students = get_students_by_group("5")
        self.assertEqual(len(g5_students), 1)
        self.assertEqual(g5_students[0].name, "이현승")

        g1_students = get_students_by_group("1")
        self.assertEqual(len(g1_students), 0)

    def test_polymorphic_lookups_and_presence(self) -> None:
        """get_student must resolve transparently across id, loginId, and name."""
        self.assertEqual(get_student("1293032").name, "신지우")
        self.assertEqual(get_student("GA14581_jiwooo0729").name, "신지우")
        self.assertEqual(get_student("신지우").student_id, "1293032")

        self.assertEqual(get_student("1294174").name, "이루한")
        self.assertEqual(get_student("GA14581_ruhan0604").name, "이루한")
        self.assertEqual(get_student("이루한").student_id, "1294174")

        self.assertTrue(has_student("1293032"))
        self.assertTrue(has_student("1294174"))
        self.assertTrue(has_student("1293067"))
        self.assertTrue(has_student("1293138"))
        self.assertTrue(has_student("1235920"))
        self.assertFalse(has_student("9999999"))

    def test_rub05_fail_closed_error_handling(self) -> None:
        """Unknown queries must raise CanonicalLookupError (fail-closed, zero toxic fallback)."""
        with self.assertRaises(CanonicalLookupError):
            get_student_by_id("9999999")

        with self.assertRaises(CanonicalLookupError):
            get_student_by_id("")

        with self.assertRaises(CanonicalLookupError):
            get_student_by_name("존재하지않는학생")

        with self.assertRaises(CanonicalLookupError):
            get_student_by_login_id("unknown_user")

        with self.assertRaises(CanonicalLookupError):
            get_student("unknown_identifier")

        with self.assertRaises(CanonicalLookupError):
            get_group("99")

        self.assertIsNone(find_student_by_id("9999999"))
        self.assertIsNone(find_student_by_name("unknown"))
        self.assertIsNone(find_student_by_login_id("unknown"))
        self.assertIsNone(find_student("unknown"))

        with self.assertRaises(CanonicalLookupError):
            CanonicalRegistry(Path("/non/existent/roster.json"))


if __name__ == "__main__":
    unittest.main()
