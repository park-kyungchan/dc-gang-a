"""Invented-only tests for date-first whole-class and selected detail."""

import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from workbench_v2 import (
    APP_FIELDS, DAY_RECORD_FIELDS, AppPreparation, CourseAssignment,
    DayRecordSnapshot, Fact, FactState, JoinError, LessonKey, RosterEntry,
    SelectionState, Source, project_class_overview,
)


NOW = datetime(2026, 9, 27, 3, 0, tzinfo=timezone.utc)
DAY = date(2026, 9, 21)


def fixture():
    keys = [LessonKey(DAY, "synthetic-occurrence", f"S{i:03d}")
            for i in range(1, 7)]
    roster = [
        RosterEntry(key, "A" if i < 3 else "B",
                    Fact.unknown(Source.LMS_ROSTER, "school grade not read"), NOW)
        for i, key in enumerate(keys)
    ]
    day = [
        DayRecordSnapshot(
            key, f"C{i:03d}", f"R{i:03d}", f"M{i:03d}",
            {field: Fact.unknown(Source.LMS_DAY_RECORD, "wire field not read")
             for field in DAY_RECORD_FIELDS}, NOW,
        ) for i, key in enumerate(keys, 1)
    ]
    courses = [
        CourseAssignment(
            keys[i - 1], f"C{i:03d}",
            Fact.known(f"Synthetic Gauss {i}", Source.LMS_COURSE, NOW),
            Fact.known("v1", Source.LMS_COURSE, NOW),
            Fact.unknown(Source.LMS_COURSE, "unit not read"),
            date(2026, 9, 1), date(2026, 9, 30), NOW,
        ) for i in (1, 2)
    ]
    app = [AppPreparation(
        keys[0], "C001", True,
        {"video_uploaded": Fact.known(True, Source.PRESTUDY_APP, NOW)}, NOW,
    )]
    return keys, dict(
        lesson_date=DAY, occurrence_id="synthetic-occurrence",
        group_filter=None, selected_student_id=keys[0].student_id,
        as_of=NOW, max_age=timedelta(hours=1), roster=roster,
        day_records=day, courses=courses, app_preparation=app,
    )


class ClassOverviewTests(unittest.TestCase):
    def test_all_groups_preserve_unknowns_and_one_selected_detail(self):
        keys, data = fixture()
        view = project_class_overview(**data)
        self.assertEqual(view.observed_count, 6)
        self.assertEqual(view.coverage.state, FactState.UNKNOWN)
        self.assertEqual(view.selection_state, SelectionState.IN_SCOPE)
        self.assertEqual(view.selected.key, keys[0])
        self.assertEqual(view.rows[0].book.value, "Synthetic Gauss 1")
        self.assertEqual(view.rows[2].book.state, FactState.UNKNOWN)
        self.assertTrue(view.rows[0].preparation["video_uploaded"].value)
        self.assertEqual(view.rows[1].preparation["video_uploaded"].state,
                         FactState.UNKNOWN)
        self.assertEqual(set(view.rows[0].preparation), set(APP_FIELDS))

    def test_group_change_gates_old_selection_without_substitution(self):
        keys, data = fixture()
        view = project_class_overview(**{**data, "group_filter": "B"})
        self.assertEqual([row.key for row in view.rows], keys[3:])
        self.assertEqual(view.selection_state, SelectionState.OUT_OF_GROUP)
        self.assertIsNone(view.selected)
        missing = project_class_overview(
            **{**data, "selected_student_id": "S999"})
        self.assertEqual(missing.selection_state, SelectionState.NOT_IN_LESSON)
        self.assertIsNone(missing.selected)

    def test_scope_and_completeness_fail_closed(self):
        keys, data = fixture()
        with self.assertRaisesRegex(JoinError, "duplicate lesson roster"):
            project_class_overview(
                **{**data, "roster": [*data["roster"], data["roster"][0]]})
        foreign = replace(data["roster"][0],
                          key=LessonKey(date(2026, 9, 22),
                                        "synthetic-occurrence", keys[0].student_id))
        with self.assertRaisesRegex(JoinError, "foreign lesson"):
            project_class_overview(
                **{**data, "roster": [foreign, *data["roster"][1:]]})
        stale = Fact.known(True, Source.LMS_DAY_RECORD, NOW - timedelta(days=2))
        view = project_class_overview(**{**data, "coverage": stale})
        self.assertEqual(view.coverage.state, FactState.STALE)
        with self.assertRaisesRegex(JoinError, "wrong source"):
            project_class_overview(
                **{**data, "coverage": Fact.known(True, Source.TEACHER, NOW)})


if __name__ == "__main__":
    unittest.main()
