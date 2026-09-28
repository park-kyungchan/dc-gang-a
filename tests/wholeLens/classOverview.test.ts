import { describe, expect, test } from "bun:test";
import {
  APP_FIELDS,
  DAY_RECORD_FIELDS,
  DayRecordField,
  FactState,
  JoinError,
  SelectionState,
  Source,
  factKnown,
  factUnknown,
  projectClassOverview,
  type AppPreparation,
  type CourseAssignment,
  type DayRecordSnapshot,
  type LessonKey,
  type RosterEntry,
} from "../../src/wholeLens/domain";

const LESSON_DATE = "2026-09-21";
const OCCURRENCE_ID = "SYN-OCCURRENCE-01";
const AS_OF = "2026-09-27T12:00:00.000Z";
const MAX_AGE_MICROS = 24n * 60n * 60n * 1_000_000n;

function fixture(studentCount: number) {
  const keys: LessonKey[] = Array.from({ length: studentCount }, (_, index) => ({
    lessonDate: LESSON_DATE,
    occurrenceId: OCCURRENCE_ID,
    studentId: `SYN-${String(index + 1).padStart(3, "0")}`,
  }));
  const splitAt = Math.ceil(studentCount / 2);
  const roster: RosterEntry[] = keys.map((key, index) => ({
    key,
    groupId: index < splitAt ? "G-A" : "G-B",
    schoolGrade: factUnknown(Source.LMS_ROSTER, "synthetic grade not supplied"),
    observedAt: AS_OF,
  }));
  const dayRecords: DayRecordSnapshot[] = keys.map((key, index) => ({
    key,
    courseId: `SYN-COURSE-${String(index + 1).padStart(3, "0")}`,
    recordSeq: `SYN-RECORD-${String(index + 1).padStart(3, "0")}`,
    cmSeq: `SYN-CM-${String(index + 1).padStart(3, "0")}`,
    fields: Object.fromEntries(DAY_RECORD_FIELDS.map((field) => [
      field,
      factUnknown(Source.LMS_DAY_RECORD, "synthetic field not read"),
    ])),
    observedAt: AS_OF,
  }));
  const courses: CourseAssignment[] = keys.slice(0, 2).map((key, index) => ({
    key,
    courseId: `SYN-COURSE-${String(index + 1).padStart(3, "0")}`,
    book: factKnown(`Synthetic Book ${index + 1}`, Source.LMS_COURSE, AS_OF),
    version: factKnown("synthetic-v1", Source.LMS_COURSE, AS_OF),
    unit: factUnknown(Source.LMS_COURSE, "synthetic unit not read"),
    effectiveFrom: "2026-09-01",
    effectiveUntil: "2026-09-30",
    observedAt: AS_OF,
  }));
  const appPreparation: AppPreparation[] = [{
    key: keys[0],
    courseId: "SYN-COURSE-001",
    joinVerified: true,
    fields: {
      video_uploaded: factKnown(true, Source.PRESTUDY_APP, AS_OF),
      required_examples_submitted: factKnown(true, Source.PRESTUDY_APP, AS_OF),
      required_examples_auto_graded: factKnown(false, Source.PRESTUDY_APP, AS_OF),
    },
    observedAt: AS_OF,
  }];
  return {
    keys,
    roster,
    dayRecords,
    courses,
    appPreparation,
    input: {
      lessonDate: LESSON_DATE,
      occurrenceId: OCCURRENCE_ID,
      groupFilter: null as string | null,
      selectedStudentId: keys[0]?.studentId ?? null,
      asOf: AS_OF,
      maxAgeMicros: MAX_AGE_MICROS,
      roster,
      dayRecords,
      courses,
      appPreparation,
    },
  };
}

describe("date-first class overview", () => {
  test("keeps supplied 6- and 12-row counts separate from unknown completeness", () => {
    for (const count of [6, 12]) {
      const data = fixture(count);
      const overview = projectClassOverview(data.input);

      expect(overview.observedCount).toBe(count);
      expect(overview.rows).toHaveLength(count);
      expect(overview.coverage.state).toBe(FactState.UNKNOWN);
      expect(overview.selectionState).toBe(SelectionState.IN_SCOPE);
      expect(overview.selectedStudentId).toBe(data.keys[0]?.studentId);
      expect(new Set(overview.rows.map((row) => row.groupId))).toEqual(new Set(["G-A", "G-B"]));
    }
  });

  test("filters the selected group and never substitutes another student", () => {
    const data = fixture(6);
    const outsideGroup = projectClassOverview({ ...data.input, groupFilter: "G-B" });
    expect(outsideGroup.observedCount).toBe(3);
    expect(outsideGroup.rows.every((row) => row.groupId === "G-B")).toBe(true);
    expect(outsideGroup.selectionState).toBe(SelectionState.OUT_OF_GROUP);
    expect(outsideGroup.selectedStudentId).toBeNull();

    const absent = projectClassOverview({ ...data.input, selectedStudentId: "SYN-ABSENT" });
    expect(absent.selectionState).toBe(SelectionState.NOT_IN_LESSON);
    expect(absent.selectedStudentId).toBeNull();

    const inGroup = projectClassOverview({
      ...data.input,
      groupFilter: "G-B",
      selectedStudentId: data.keys[4]!.studentId,
    });
    expect(inGroup.selectionState).toBe(SelectionState.IN_SCOPE);
    expect(inGroup.selectedStudentId).toBe(data.keys[4]!.studentId);
  });

  test("keeps each app stage separate and missing stages unknown", () => {
    const data = fixture(6);
    const overview = projectClassOverview(data.input);
    const first = overview.rows[0]!;
    const second = overview.rows[1]!;

    expect(Object.keys(first.preparation).sort()).toEqual([...APP_FIELDS].sort());
    expect(first.preparation.video_uploaded).toMatchObject({ state: FactState.KNOWN, value: true });
    expect(first.preparation.required_examples_submitted).toMatchObject({ state: FactState.KNOWN, value: true });
    expect(first.preparation.required_examples_auto_graded).toMatchObject({ state: FactState.KNOWN, value: false });
    expect(first.preparation.required_examples_corrected.state).toBe(FactState.UNKNOWN);
    expect(first.preparation.video_teacher_checked.state).toBe(FactState.UNKNOWN);
    expect(APP_FIELDS.every((field) => second.preparation[field].state === FactState.UNKNOWN)).toBe(true);
    expect(overview.rows[2]!.book.state).toBe(FactState.UNKNOWN);
  });

  test("coverage is unknown by default and stale coverage hides its value", () => {
    const data = fixture(6);
    const missing = projectClassOverview(data.input);
    expect(missing.coverage.state).toBe(FactState.UNKNOWN);

    const stale = projectClassOverview({
      ...data.input,
      coverage: factKnown(true, Source.LMS_DAY_RECORD, "2026-09-24T00:00:00.000Z"),
    });
    expect(stale.coverage.state).toBe(FactState.STALE);
    expect("value" in stale.coverage).toBe(false);
  });

  test("rejects duplicate or foreign-scope rows and the all-groups pseudo-group", () => {
    const data = fixture(6);
    expect(() => projectClassOverview({
      ...data.input,
      roster: [...data.roster, data.roster[0]!],
    })).toThrow(JoinError);
    expect(() => projectClassOverview({
      ...data.input,
      dayRecords: data.dayRecords.map((row, index) => index === 0
        ? { ...row, key: { ...row.key, lessonDate: "2026-09-22" } }
        : row),
    })).toThrow("foreign lesson occurrence");
    expect(() => projectClassOverview({
      ...data.input,
      roster: data.roster.map((row, index) => index === 0 ? { ...row, groupId: "0" } : row),
    })).toThrow("all-groups is a filter");
  });
});
