import { describe, expect, it } from "bun:test";
import {
  appendRevision, assertWeekStart, filterLearningEntries, known, localCalendarWeek,
  projectLearningTimeline, projectLearningWeeks, selectLearningEntries, stableId, unknown,
  weekStartForLocalDate,
  type EntityId, type LearningEntry, type LearningRevision, type SourceObservation, type TeacherPlan,
} from "../../src/learning";

// Invented dates, identities and content only; no roster, browser or network fixtures.
const refs = ["synthetic:weekly-evidence"];
const student = stableId("student", "synthetic-weekly", "alpha");
const otherStudent = stableId("student", "synthetic-weekly", "beta");
const edition = stableId("edition", "synthetic-weekly", "book-A");
const otherEdition = stableId("edition", "synthetic-weekly", "book-B");
const page = stableId("page", "synthetic-weekly", "book-A", "1");
const query = { asOfDate: "2027-01-01", timeZone: "Asia/Seoul" } as const;
function plan(date = "2026-12-31", overrides: Partial<TeacherPlan> = {}): TeacherPlan {
  return {
    kind: "teacher_plan", teacherId: "synthetic-teacher", horizon: "future", purpose: "lesson", status: "approved",
    context: { studentId: student, lessonDate: date, occurrenceId: known("synthetic-occurrence", refs),
      localStartTime: known("14:00", refs), timeZone: "Asia/Seoul" },
    scope: { editionId: known(edition, refs), unitId: unknown("Unit not mapped"), pageIds: known([page], refs), problemIds: unknown("Questions not mapped") },
    assignmentId: unknown("Assignment not joined"), basedOnRevisionIds: [], dueDate: unknown("No due date"), ...overrides,
  };
}
function observation(date = "2026-12-31", overrides: Partial<SourceObservation> = {}): SourceObservation {
  const base = plan(date);
  return {
    kind: "source_observation", context: base.context, scope: base.scope, sessionKind: "lesson",
    makeupForOccurrenceId: unknown("Not a makeup"),
    provenance: { system: "lms_day_record", recordKey: "synthetic-record", observedAt: "2029-01-01T00:00:00Z",
      sourceTimestamp: unknown("Not observed"), contractRef: "synthetic:contract", contentDigest: unknown("Not retained") },
    exactBinding: known({ studentId: student, lessonDate: date, occurrenceId: "synthetic-occurrence" }, refs),
    attendance: unknown("No attendance proof"), activity: "attempted", correctionChecked: unknown("Not inspected"),
    correctness: unknown("No grade proof"), ...overrides,
  };
}
function historyOf(entries: readonly LearningEntry[]): readonly LearningRevision[] {
  let history: readonly LearningRevision[] = [];
  entries.forEach((payload, index) => {
    history = appendRevision(history, {
      entityId: stableId("entity", "synthetic-weekly", String(index)), expectedRevisionId: null,
      idempotencyKey: `synthetic-weekly-command-${index}`, actorId: "synthetic-teacher",
      recordedAt: "2030-01-01T00:00:00Z", reason: "Synthetic weekly test", payload,
    }).history;
  });
  return history;
}

describe("Monday local-calendar week contract", () => {
  it("includes Monday through Sunday and crosses a month boundary", () => {
    for (const day of ["2026-09-28", "2026-09-30", "2026-10-01", "2026-10-04"]) {
      expect(localCalendarWeek(day)).toEqual({ weekStart: "2026-09-28", weekEnd: "2026-10-04", startsOn: "monday" });
    }
    expect(weekStartForLocalDate("2026-10-05")).toBe("2026-10-05");
  });
  it("uses the actual Monday date across a year boundary, not an ISO week-year label", () => {
    expect(localCalendarWeek("2027-01-01")).toEqual({ weekStart: "2026-12-28", weekEnd: "2027-01-03", startsOn: "monday" });
    expect(weekStartForLocalDate("2027-01-03")).toBe("2026-12-28");
    expect(weekStartForLocalDate("2027-01-04")).toBe("2027-01-04");
  });
  it("preserves Gregorian leap days and local weeks across daylight-saving dates", () => {
    expect(localCalendarWeek("2028-02-29")).toEqual({ weekStart: "2028-02-28", weekEnd: "2028-03-05", startsOn: "monday" });
    expect(weekStartForLocalDate("2026-03-08")).toBe("2026-03-02");
    expect(weekStartForLocalDate("2026-11-01")).toBe("2026-10-26");
  });
  it("rejects malformed/impossible dates, non-Monday selectors and unrepresentable week ranges", () => {
    for (const value of ["2026-02-30", "2027-02-29", "2026-1-01", "2026-W40", "2026-10-01T00:00:00Z"]) {
      expect(() => weekStartForLocalDate(value)).toThrow();
    }
    expect(() => assertWeekStart("2026-10-01")).toThrow("Monday");
    expect(() => assertWeekStart("2026-09-28")).not.toThrow();
    expect(() => localCalendarWeek("9999-12-31")).toThrow("range");
    expect(() => localCalendarWeek("0000-01-01")).toThrow("range");
  });
});

describe("weekly filter intersections and unresolved candidates", () => {
  it("ANDs cross-year week, month and exact day rather than requiring the Monday to be in the month", () => {
    const entries = [plan("2026-12-31"), plan("2027-01-01"), plan("2027-01-03"), plan("2027-01-04")];
    expect(filterLearningEntries(entries, { weekStart: "2026-12-28", month: "2027-01" }).map(row => row.context.lessonDate))
      .toEqual(["2027-01-01", "2027-01-03"]);
    expect(filterLearningEntries(entries, { weekStart: "2026-12-28", month: "2027-01", day: "2027-01-03" }))
      .toEqual([entries[2]!]);
    expect(filterLearningEntries(entries, { weekStart: "2026-12-28", day: "2027-01-04" })).toEqual([]);
    expect(filterLearningEntries(entries, { weekStart: "2026-12-28", month: "2026-12", day: "2027-01-01" })).toEqual([]);
  });
  it("combines week with existing student, edition and local-time selectors", () => {
    const base = plan();
    const entries = [base, plan(undefined, { context: { ...base.context, studentId: otherStudent } }),
      plan(undefined, { scope: { ...base.scope, editionId: known(otherEdition, refs) } }),
      plan(undefined, { context: { ...base.context, localStartTime: known("15:00", refs) } })];
    expect(filterLearningEntries(entries, { weekStart: "2026-12-28", timeZone: "Asia/Seoul", studentId: student, editionId: edition, lessonTime: "14:00" }))
      .toEqual([base]);
  });
  it("uses lesson-local date even when source UTC observation is in a different week", () => {
    const source = observation("2027-01-03", { provenance: { ...observation().provenance, observedAt: "2027-01-04T00:00:00Z" } });
    expect(filterLearningEntries([source], { weekStart: "2026-12-28", timeZone: "Asia/Seoul" })).toHaveLength(1);
    expect(filterLearningEntries([source], { weekStart: "2027-01-04", timeZone: "Asia/Seoul" })).toHaveLength(0);
  });
  it("retains foreign-zone rows before applying month, week, day or wall-clock comparisons", () => {
    const base = plan("2027-01-04");
    const foreign = plan(undefined, { context: { ...base.context, timeZone: "America/Los_Angeles", localStartTime: known("20:00", refs) } });
    const filter = { weekStart: "2026-12-28", month: "2026-12", day: "2026-12-31", lessonTime: "14:00", timeZone: "Asia/Seoul" };
    const result = selectLearningEntries([foreign], filter);
    expect(result.matched).toEqual([]);
    expect(result.unresolved).toEqual([{ entry: foreign, issues: ["lesson_time_zone_unresolved"] }]);
    expect(filterLearningEntries([foreign], filter)).toEqual([]);
  });
  it("does not revive definitely foreign students or editions merely because the time zone is unresolved", () => {
    const base = plan();
    const foreign = plan(undefined, { context: { ...base.context, timeZone: "America/Los_Angeles", studentId: otherStudent } });
    expect(selectLearningEntries([foreign], { ...query, studentId: student }).unresolved).toEqual([]);
    expect(selectLearningEntries([foreign], { ...query, editionId: otherEdition }).unresolved).toEqual([]);
  });
  it("retains unknown exact edition/time matches separately without making them matches", () => {
    const base = plan();
    const uncertain = plan(undefined, { context: { ...base.context, localStartTime: unknown("No source time") },
      scope: { ...base.scope, editionId: unknown("Unverified edition") } });
    const result = selectLearningEntries([uncertain], { weekStart: "2026-12-28", timeZone: "Asia/Seoul", lessonTime: "14:00", editionId: edition });
    expect(result.matched).toEqual([]);
    expect(result.unresolved[0]!.issues).toEqual(["edition_filter_unresolved", "lesson_time_unresolved"]);
  });
  it("validates week, date and zone selectors even with no records", () => {
    for (const filter of [{ weekStart: "2027-01-01" }, { weekStart: "2026-02-30" }, { day: "2027-02-29" }, { timeZone: "not/a-zone" }]) {
      expect(() => filterLearningEntries([], filter)).toThrow();
    }
    expect(() => projectLearningTimeline([], { weekStart: "2027-01-01" })).toThrow();
  });
});

describe("week -> lesson -> edition audit grouping", () => {
  it("classifies weeks relative to asOfDate without changing historical plans or inferring completion", () => {
    const result = projectLearningWeeks(historyOf([plan("2026-12-21"), plan("2027-01-03"), plan("2027-01-04")]), query);
    expect(result.currentWeekStart).toBe("2026-12-28");
    expect(result.weeks.map(week => [week.weekStart, week.period])).toEqual([
      ["2026-12-21", "historical"], ["2026-12-28", "current"], ["2027-01-04", "future"],
    ]);
    const historicalPlan = result.weeks[0]!.lessons[0]!.editions[0]!.teacherPlans[0]!.entry as TeacherPlan;
    expect(historicalPlan.status).toBe("approved");
    expect(historicalPlan.horizon).toBe("future");
    expect(historicalPlan).not.toHaveProperty("completion");
    expect(result.weeks[0]).not.toHaveProperty("completion");
  });
  it("groups only exact same-student lesson occurrences and editions while preserving both lanes", () => {
    const base = plan();
    const result = projectLearningWeeks(historyOf([base, observation(), plan(undefined, { scope: { ...base.scope, editionId: known(otherEdition, refs) } }),
      plan(undefined, { context: { ...base.context, occurrenceId: known("synthetic-other-occurrence", refs) } }),
      plan(undefined, { context: { ...base.context, studentId: otherStudent } })]), query);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0]!.lessons).toHaveLength(3);
    const lesson = result.weeks[0]!.lessons.find(item => item.editions.length === 2)!;
    expect(lesson.studentId).toBe(student);
    const group = lesson.editions.find(item => item.sourceFacts.length === 1)!;
    expect(group.sourceFacts).toHaveLength(1);
    expect(group.teacherPlans).toHaveLength(1);
    expect(group.sourceFacts[0]!.entry.kind).toBe("source_observation");
    expect(group.teacherPlans[0]!.entry.kind).toBe("teacher_plan");
    expect(group.teacherPlans[0]!.entry.scope.pageIds).toEqual(base.scope.pageIds);
    expect(group.teacherPlans[0]!.revisionId).toBeTruthy();
    expect(group.teacherPlans[0]!.entityId).toBeTruthy();
  });
  it("never merges unknown lesson occurrences or unverified source joins by name/date", () => {
    const base = plan();
    const unknownLesson = plan(undefined, { context: { ...base.context, occurrenceId: unknown("Not joined") } });
    const result = projectLearningWeeks(historyOf([base, unknownLesson, unknownLesson,
      observation(undefined, { exactBinding: unknown("Observed row only") })]), query);
    expect(result.weeks[0]!.lessons).toHaveLength(4);
    expect(result.weeks[0]!.lessons.filter(lesson => lesson.binding === "unresolved_source_or_occurrence")).toHaveLength(3);
    expect(new Set(result.weeks[0]!.lessons.map(lesson => lesson.lessonKey)).size).toBe(4);
  });
  it("keeps lesson and makeup lanes separate even when a supplied occurrence key is reused", () => {
    const result = projectLearningWeeks(historyOf([plan(), observation(),
      plan(undefined, { purpose: "makeup" }),
      observation(undefined, { sessionKind: "makeup", makeupForOccurrenceId: known("synthetic-prior-occurrence", refs) })]), query);
    expect(result.weeks[0]!.lessons).toHaveLength(2);
    expect(result.weeks[0]!.lessons.map(lesson => lesson.sessionKind).sort()).toEqual(["lesson", "makeup"]);
    for (const lesson of result.weeks[0]!.lessons) {
      expect(lesson.editions[0]!.teacherPlans).toHaveLength(1);
      expect(lesson.editions[0]!.sourceFacts).toHaveLength(1);
    }
  });
  it("keeps unknown editions in separate entity groups without inventing a shared book identity", () => {
    const base = plan();
    const unknownBook = plan(undefined, { scope: { ...base.scope, editionId: unknown("No edition join") } });
    const result = projectLearningWeeks(historyOf([unknownBook, unknownBook]), query);
    expect(result.weeks[0]!.lessons).toHaveLength(1);
    expect(result.weeks[0]!.lessons[0]!.editions).toHaveLength(2);
    expect(result.weeks[0]!.lessons[0]!.editions.every(group => group.editionId.state === "unknown")).toBe(true);
  });
  it("assigns no week or period to a foreign-zone unresolved row", () => {
    const base = plan("2027-01-04");
    const foreign = plan(undefined, { context: { ...base.context, timeZone: "America/Los_Angeles" } });
    const result = projectLearningWeeks(historyOf([foreign]), { ...query, weekStart: "2026-12-28", day: "2026-12-31" });
    expect(result.weeks).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.issues).toEqual(["lesson_time_zone_unresolved"]);
    expect(result.unresolved[0]).not.toHaveProperty("weekStart");
    expect(result.unresolved[0]).not.toHaveProperty("period");
  });
  it("retains unknown filter values in the weekly unresolved queue", () => {
    const base = plan();
    const result = projectLearningWeeks(historyOf([plan(undefined, { context: { ...base.context, localStartTime: unknown("Unknown lesson time") } })]),
      { ...query, lessonTime: "14:00" });
    expect(result.weeks).toEqual([]);
    expect(result.unresolved[0]!.issues).toContain("lesson_time_unresolved");
  });
  it("uses timezone-qualified week keys, never one UTC week key for different local calendars", () => {
    const seoul = projectLearningWeeks(historyOf([plan()]), query);
    const base = plan();
    const la = projectLearningWeeks(historyOf([plan(undefined, { context: { ...base.context, timeZone: "America/Los_Angeles" } })]),
      { ...query, timeZone: "America/Los_Angeles" });
    expect(seoul.weeks[0]!.weekStart).toBe(la.weeks[0]!.weekStart);
    expect(seoul.weeks[0]!.weekKey).not.toBe(la.weeks[0]!.weekKey);
  });
  it("projects only the latest revision while retaining the full history unchanged", () => {
    const history = historyOf([plan()]);
    const next = appendRevision(history, {
      entityId: history[0]!.entityId, expectedRevisionId: history[0]!.revisionId, idempotencyKey: "synthetic-weekly-revision",
      actorId: "synthetic-teacher", recordedAt: "2030-01-02T00:00:00Z", reason: "Synthetic change of lesson date",
      payload: plan("2027-01-04", { status: "cancelled" }),
    }).history;
    const result = projectLearningWeeks(next, query);
    expect(history).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(result.weeks).toHaveLength(1);
    expect(result.weeks[0]!.weekStart).toBe("2027-01-04");
    expect(result.weeks[0]!.lessons[0]!.editions[0]!.teacherPlans[0]!.revisionId).toBe(next[1]!.revisionId);
    expect((result.weeks[0]!.lessons[0]!.editions[0]!.teacherPlans[0]!.entry as TeacherPlan).status).toBe("cancelled");
  });
  it("is deterministic for independent input order and freezes the grouped audit envelope", () => {
    const history = historyOf([plan("2027-01-04"), plan("2026-12-31"), observation()]);
    const result = projectLearningWeeks(history, query);
    expect(result).toEqual(projectLearningWeeks([...history].reverse(), query));
    expect(Object.isFrozen(result.weeks[0]!.lessons[0]!.editions[0]!.teacherPlans)).toBe(true);
  });
  it("orders mixed-case and punctuation opaque IDs by code point rather than locale collation", () => {
    let history: readonly LearningRevision[] = [];
    for (const entityId of ["synthetic-a", "synthetic-Z", "synthetic-_", "synthetic-A", "synthetic-!"]) {
      history = appendRevision(history, {
        entityId: entityId as EntityId, expectedRevisionId: null, idempotencyKey: `retry:${entityId}`,
        actorId: "synthetic-teacher", recordedAt: "2030-01-01T00:00:00Z", reason: "Synthetic opaque-key ordering", payload: plan(),
      }).history;
    }
    const result = projectLearningWeeks(history, query);
    expect<string[]>(result.weeks[0]!.lessons[0]!.editions[0]!.teacherPlans.map(row => row.entityId))
      .toEqual(["synthetic-!", "synthetic-A", "synthetic-Z", "synthetic-_", "synthetic-a"]);
  });
  it("rejects invalid as-of/week/zone inputs even with an empty history", () => {
    for (const change of [{ asOfDate: "2027-02-29" }, { weekStart: "2027-01-01" }, { timeZone: "not/a-zone" }]) {
      expect(() => projectLearningWeeks([], { ...query, ...change })).toThrow();
    }
    expect(projectLearningWeeks([], query).weeks).toEqual([]);
  });
});
