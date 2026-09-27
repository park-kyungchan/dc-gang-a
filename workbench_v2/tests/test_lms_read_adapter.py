"""Invented records only; no academy client, session, or network access."""

import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from workbench_v2 import (
    DAY_RECORD_FIELDS, DAY_RECORD_READ, STUDY_COURSE_READ, CourseRead,
    CourseRow, DayRecordRead, DayRecordRow, Fact, FactState, JoinError,
    LessonKey, OccurrenceBinding, Source, adapt_selected_lms_reads,
    project_selection,
)


AT = datetime(2026, 9, 27, 3, 0, tzinfo=timezone.utc)
KEY = LessonKey(date(2026, 9, 21), "synthetic-occurrence-1", "synthetic-student-1")


def fixture():
    binding = OccurrenceBinding(KEY, "synthetic-record-1", "reviewed schedule row", True)
    fields = {field: Fact.unknown(Source.LMS_DAY_RECORD, "wire value not read")
              for field in DAY_RECORD_FIELDS}
    row = DayRecordRow(KEY.student_id, "synthetic-course-1", binding.record_seq,
                       "synthetic-cm-1", fields)
    day = DayRecordRead(DAY_RECORD_READ, KEY.lesson_date, "synthetic-group-1", AT,
                        (1,), 1, True, (row,))
    course_row = CourseRow(KEY.student_id, "synthetic-source-course-1",
                           "synthetic-course-1", True,
                           date(2026, 9, 1), date(2026, 9, 30),
                           Fact.known("Synthetic book", Source.LMS_COURSE, AT),
                           Fact.known("v1", Source.LMS_COURSE, AT),
                           Fact.unknown(Source.LMS_COURSE, "unit not read"))
    course = CourseRead(STUDY_COURSE_READ, KEY.student_id, AT, (1,), 1, True,
                        (course_row,))
    return binding, day, course


class LmsReadAdapterTests(unittest.TestCase):
    def test_exact_verified_reads_feed_projection(self):
        binding, day, course = fixture()
        adapted = adapt_selected_lms_reads(selection=KEY, binding=binding,
                                           day_read=day, course_read=course)
        view = project_selection(
            selection=KEY, group_filter=day.group_id, as_of=AT,
            max_age=timedelta(hours=1), roster=[adapted.roster_entry],
            day_records=[adapted.day_record], courses=[adapted.course],
        )
        self.assertEqual(view.book.value, "Synthetic book")
        self.assertEqual(view.school_grade.state, FactState.UNKNOWN)
        self.assertTrue(all(fact.state is FactState.UNKNOWN
                            for fact in view.day_record.values()))
        self.assertTrue(all(fact.state is FactState.UNKNOWN
                            for fact in view.preparation.values()))

    def test_unverified_course_relation_and_out_of_period_stay_unknown(self):
        binding, day, course = fixture()
        unverified = replace(course.rows[0], key_relation_verified=False,
                             linked_day_course_id=None)
        adapted = adapt_selected_lms_reads(
            selection=KEY, binding=binding, day_read=day,
            course_read=replace(course, rows=(unverified,)))
        self.assertIsNone(adapted.course)
        out_of_period = replace(course.rows[0], effective_from=date(2026, 9, 22))
        adapted = adapt_selected_lms_reads(
            selection=KEY, binding=binding, day_read=day,
            course_read=replace(course, rows=(out_of_period,)))
        self.assertIsNone(adapted.course)

    def test_unbound_or_ambiguous_lesson_fails_closed(self):
        binding, day, course = fixture()
        with self.assertRaisesRegex(JoinError, "binding is unverified"):
            adapt_selected_lms_reads(selection=KEY, binding=replace(binding, verified=False),
                                     day_read=day)
        with self.assertRaisesRegex(JoinError, "occurrence binding"):
            adapt_selected_lms_reads(selection=KEY,
                                     binding=replace(binding, record_seq="other-record"),
                                     day_read=day)
        with self.assertRaisesRegex(JoinError, "absent or ambiguous"):
            adapt_selected_lms_reads(selection=KEY, binding=binding,
                                     day_read=replace(day, rows=(day.rows[0], day.rows[0])))
        with self.assertRaisesRegex(JoinError, "multiple date-valid"):
            adapt_selected_lms_reads(selection=KEY, binding=binding, day_read=day,
                                     course_read=replace(course,
                                                         rows=(course.rows[0], course.rows[0])))

    def test_read_contract_pagination_and_foreign_course_fail_closed(self):
        binding, day, course = fixture()
        with self.assertRaisesRegex(JoinError, "pagination"):
            adapt_selected_lms_reads(selection=KEY, binding=binding,
                                     day_read=replace(day, total_pages=2))
        with self.assertRaisesRegex(JoinError, "DayRecord operation"):
            adapt_selected_lms_reads(selection=KEY, binding=binding,
                                     day_read=replace(day, operation="GET udtPrg"))
        with self.assertRaisesRegex(JoinError, "foreign DayRecord course"):
            adapt_selected_lms_reads(
                selection=KEY, binding=binding, day_read=day,
                course_read=replace(course, rows=(replace(
                    course.rows[0], linked_day_course_id="foreign-course"),)))


if __name__ == "__main__":
    unittest.main()
