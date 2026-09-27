"""Synthetic-only contract tests for the first Main Sheet projection slice."""

import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

from workbench_v2 import (
    APP_FIELDS, DAY_RECORD_FIELDS, AppPreparation, CourseAssignment,
    DayRecordField, DayRecordSnapshot, DeliveryReceipt, Draft, DraftAuthor,
    Fact, FactState, JoinError, LessonKey, ReportEvidence, RosterEntry,
    SaveReadback, SaveState, Source, SptProjection, project_selection,
)


NOW = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
DAY = date(2026, 9, 21)
AGE = timedelta(hours=24)


def known(value, source, at=NOW):
    return Fact.known(value, source, at)


def inputs():
    keys = [LessonKey(DAY, "occ-1", f"S{i:03d}") for i in range(1, 7)]
    roster = [RosterEntry(key, "G-A" if i < 3 else "G-B",
                          known(f"grade-{i + 3}", Source.LMS_ROSTER), NOW)
              for i, key in enumerate(keys)]
    dayrecords = [
        DayRecordSnapshot(
            key, f"C{i:03d}", f"R{i:03d}", f"M{i:03d}",
            {field: known("recorded" if field is not DayRecordField.ATTENDANCE else "Y",
                          Source.LMS_DAY_RECORD) for field in DAY_RECORD_FIELDS}, NOW,
        ) for i, key in enumerate(keys, 1)
    ]
    courses = [
        CourseAssignment(keys[i - 1], f"C{i:03d}",
                         known(f"Gauss book {i}", Source.LMS_COURSE),
                         known("v1", Source.LMS_COURSE),
                         Fact.unknown(Source.LMS_COURSE, "unit not observed"),
                         date(2026, 9, 1), None, NOW)
        for i in (1, 2)
    ]
    return keys, dict(selection=keys[0], group_filter=None, as_of=NOW,
                      max_age=AGE, roster=roster, day_records=dayrecords,
                      courses=courses)


class ProjectionTests(unittest.TestCase):
    def test_six_students_and_missing_app_or_course_stay_unknown(self):
        keys, data = inputs()
        self.assertEqual(len(data["roster"]), 6)
        for key in keys:
            view = project_selection(**{**data, "selection": key})
            self.assertEqual(view.key, key)
            self.assertEqual(len(view.day_record), 8)
            self.assertEqual(set(view.preparation), set(APP_FIELDS))
            self.assertTrue(all(f.state is FactState.UNKNOWN
                                for f in view.preparation.values()))
            self.assertEqual(view.report.receipt.state, FactState.UNKNOWN)
        third = project_selection(**{**data, "selection": keys[2]})
        self.assertEqual(third.book.state, FactState.UNKNOWN)
        self.assertEqual(third.school_grade.state, FactState.KNOWN)

    def test_exact_app_evidence_keeps_stages_separate(self):
        keys, data = inputs()
        app = AppPreparation(keys[0], "C001", True, {
            "video_uploaded": known(True, Source.PRESTUDY_APP),
            "required_examples_submitted": known(True, Source.PRESTUDY_APP),
            "required_examples_auto_graded": known(False, Source.PRESTUDY_APP),
        }, NOW)
        view = project_selection(**{**data, "app_preparation": [app]})
        self.assertTrue(view.preparation["video_uploaded"].value)
        self.assertFalse(view.preparation["required_examples_auto_graded"].value)
        self.assertEqual(view.preparation["required_examples_corrected"].state,
                         FactState.UNKNOWN)
        self.assertEqual(view.preparation["video_teacher_checked"].state,
                         FactState.UNKNOWN)

    def test_stale_context_rejected_and_old_fact_hidden(self):
        _, data = inputs()
        stale = replace(data["roster"][0], observed_at=NOW - timedelta(days=2))
        with self.assertRaisesRegex(JoinError, "roster snapshot"):
            project_selection(**{**data, "roster": [stale, *data["roster"][1:]]})
        old_grade = known("grade-old", Source.LMS_ROSTER, NOW - timedelta(days=2))
        roster = [replace(data["roster"][0], school_grade=old_grade),
                  *data["roster"][1:]]
        view = project_selection(**{**data, "roster": roster})
        self.assertEqual(view.school_grade.state, FactState.STALE)
        self.assertIsNone(view.school_grade.value)
        self.assertEqual(view.school_grade.source, Source.LMS_ROSTER)

    def test_foreign_course_and_unverified_app_join_rejected(self):
        _, data = inputs()
        foreign = AppPreparation(data["selection"], "C999", True,
                                 {"video_uploaded": known(True, Source.PRESTUDY_APP)}, NOW)
        with self.assertRaisesRegex(JoinError, "foreign"):
            project_selection(**{**data, "app_preparation": [foreign]})
        with self.assertRaisesRegex(JoinError, "unverified"):
            project_selection(**{**data, "app_preparation": [replace(foreign,
                                                                     course_id="C001",
                                                                     join_verified=False)]})
        with self.assertRaisesRegex(JoinError, "course ID"):
            project_selection(**{**data, "courses": [replace(data["courses"][0],
                                                              course_id="C999")]})

    def test_out_of_context_selection_rejected_without_fallback(self):
        keys, data = inputs()
        with self.assertRaisesRegex(JoinError, "outside the selected group"):
            project_selection(**{**data, "group_filter": "G-B"})
        with self.assertRaisesRegex(JoinError, "not in the selected lesson roster"):
            project_selection(**{**data, "selection": LessonKey(DAY, "occ-1", "S999")})
        view = project_selection(**{**data, "selection": keys[4], "group_filter": "G-B"})
        self.assertEqual(view.key.student_id, "S005")
        self.assertEqual(project_selection(**{**data, "group_filter": "0"}).key, keys[0])

    def test_draft_save_preview_sent_label_and_receipt_are_independent(self):
        _, data = inputs()
        key = data["selection"]
        draft = Draft(key, "D1", DraftAuthor.LLM,
                      known("Draft body", Source.LLM), 1)
        report = ReportEvidence(key, "P1", known("Current preview", Source.REPORT_PREVIEW),
                                known(True, Source.SENT_LABEL),
                                Fact.unknown(Source.DELIVERY_RECEIPT,
                                             "no independent receipt"))
        view = project_selection(**{**data, "drafts": [draft], "reports": [report]})
        self.assertEqual(view.drafts[0].text.value, "Draft body")
        self.assertFalse(view.save_effects)
        self.assertEqual(view.report.current_preview.value, "Current preview")
        self.assertTrue(view.report.sent_label.value)
        self.assertEqual(view.report.receipt.state, FactState.UNKNOWN)
        self.assertNotEqual(view.drafts[0].text.value, view.report.current_preview.value)

        save = SaveReadback(key, "R001", DayRecordField.MEMO, "Saved body", "T1",
                            SaveState.VERIFIED_READBACK,
                            known("Saved body", Source.LMS_DAY_RECORD),
                            "effect-1", NOW - timedelta(minutes=2),
                            NOW - timedelta(minutes=1))
        delivered = DeliveryReceipt("P1", "receipt-1", "Delivered body")
        report = replace(report, receipt=known(delivered, Source.DELIVERY_RECEIPT))
        view = project_selection(**{**data, "drafts": [draft], "save_effects": [save],
                                    "reports": [report]})
        self.assertEqual(view.save_effects[0].state, SaveState.VERIFIED_READBACK)
        self.assertEqual(view.report.receipt.value.delivered_body, "Delivered body")
        self.assertNotEqual(view.report.receipt.value.delivered_body, view.drafts[0].text.value)

    def test_forged_save_and_foreign_receipt_rejected(self):
        _, data = inputs()
        key = data["selection"]
        save = SaveReadback(key, "R001", DayRecordField.MEMO, "proposed", "T1",
                            SaveState.VERIFIED_READBACK,
                            known("different", Source.LMS_DAY_RECORD),
                            "effect-1", NOW - timedelta(minutes=2),
                            NOW - timedelta(minutes=1))
        with self.assertRaisesRegex(JoinError, "exact matching readback"):
            project_selection(**{**data, "save_effects": [save]})
        with self.assertRaisesRegex(JoinError, "foreign DayRecord"):
            project_selection(**{**data, "save_effects": [replace(save, record_seq="R999")]})
        report = ReportEvidence(key, "P1", Fact.unknown(Source.REPORT_PREVIEW),
                                Fact.unknown(Source.SENT_LABEL),
                                known(DeliveryReceipt("P2", "receipt-2", "body"),
                                      Source.DELIVERY_RECEIPT))
        with self.assertRaisesRegex(JoinError, "selected report"):
            project_selection(**{**data, "reports": [report]})

    def test_reviewed_proposal_is_not_a_save(self):
        _, data = inputs()
        reviewed = SaveReadback(data["selection"], "R001", DayRecordField.MEMO,
                                "proposed", "T1", SaveState.REVIEWED,
                                Fact.unknown(Source.LMS_DAY_RECORD, "not saved"),
                                "effect-review", NOW)
        view = project_selection(**{**data, "save_effects": [reviewed]})
        self.assertEqual(view.save_effects[0].state, SaveState.REVIEWED)
        self.assertEqual(view.save_effects[0].readback.state, FactState.UNKNOWN)
        self.assertEqual(view.report.receipt.state, FactState.UNKNOWN)
        with self.assertRaisesRegex(JoinError, "unverified save"):
            project_selection(**{**data, "save_effects": [replace(
                reviewed, readback=known("proposed", Source.LMS_DAY_RECORD))]})

    def test_versions_are_retained_and_spt_requires_approved_receipt(self):
        _, data = inputs()
        key = data["selection"]
        old = Draft(key, "D1", DraftAuthor.TEACHER,
                    known("old note", Source.TEACHER), 1,
                    reviewed_at=NOW, reviewer_id="T1")
        correction = Draft(key, "D2", DraftAuthor.TEACHER,
                           known("corrected note", Source.TEACHER), 2,
                           supersedes_id="D1", correction_reason="teacher correction")
        event = SptProjection(key, "E1", "SPT-receipt-1", "question",
                              known("needs review", Source.SPT), True)
        view = project_selection(**{**data, "drafts": [old, correction],
                                    "spt_activity": [event]})
        self.assertEqual([d.draft_id for d in view.drafts], ["D1", "D2"])
        self.assertIsNotNone(view.drafts[0].reviewed_at)
        self.assertIsNone(view.drafts[1].reviewed_at)
        self.assertEqual(view.spt_activity[0].receipt_id, "SPT-receipt-1")
        with self.assertRaisesRegex(JoinError, "earlier retained revision"):
            project_selection(**{**data, "drafts": [correction]})
        with self.assertRaisesRegex(JoinError, "raw SPT event"):
            project_selection(**{**data, "spt_activity": [replace(event, approved=False)]})

    def test_other_students_are_never_projected_into_selection(self):
        keys, data = inputs()
        other = Draft(keys[1], "D-other", DraftAuthor.TEACHER,
                      known("other student text", Source.TEACHER), 1)
        other_event = SptProjection(keys[1], "E-other", "receipt-other", "question",
                                    known("other activity", Source.SPT), True)
        view = project_selection(**{**data, "drafts": [other],
                                    "spt_activity": [other_event]})
        self.assertEqual(view.drafts, ())
        self.assertEqual(view.spt_activity, ())


if __name__ == "__main__":
    unittest.main()
