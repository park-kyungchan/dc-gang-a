import { describe, expect, it } from "bun:test";
import {
  appendRevision, known, stableId, unknown,
  type LearningCatalog, type LearningEntry, type LearningRevision, type SourceObservation, type TeacherPlan,
} from "../../src/learning/index.ts";
import { learningWeekSelectorOptions, projectLearningView, renderLearningViewCells, type LearningViewFilters } from "../../src/sheets/learningViewProjection.ts";
import { makeSyntheticLearningPreview } from "./learningViewProjection.fixture.ts";
import {
  buildMainSheetDryRun, cellsInLearningRange, EXISTING_SHEET_PRESERVATION,
  LEARNING_VIEW_AUTO_RANGES, LEARNING_VIEW_LAYOUT_VERSION, LEARNING_VIEW_MANUAL_RANGES,
  learningCellOwner, type LiteralCell, type MainSheetSnapshot, type MainSheetTarget,
} from "../../src/sheets/mainSheetLearningPreview.ts";

const stamp = "2026-10-01T05:00:00Z";
const refs = ["synthetic:verified-fixture"];
const student = stableId("student", "synthetic", "learner-a");
const otherStudent = stableId("student", "synthetic", "learner-b");
const edition = stableId("edition", "synthetic", "book-a");
const major = stableId("unit", "synthetic", "major-a");
const middle = stableId("unit", "synthetic", "middle-a");
const minor = stableId("unit", "synthetic", "minor-a");
const page = stableId("page", "synthetic", "page-a");
const q1 = stableId("problem", "synthetic", "question-a");
const q2 = stableId("problem", "synthetic", "question-b");
function catalog(): LearningCatalog {
  return {
    editions: [{ id: edition, title: "Synthetic algebra", editionLabel: known("edition A", refs), provenanceRefs: refs }],
    units: [
      { id: major, editionId: edition, title: "Major A", level: "major", parentId: null },
      { id: middle, editionId: edition, title: "Middle A", level: "middle", parentId: known(major, refs) },
      { id: minor, editionId: edition, title: "Minor A", level: "minor", parentId: known(middle, refs) },
    ],
    pages: [{ id: page, editionId: edition, printedLabel: "12-A", minorUnitId: known(minor, refs) }],
    problems: [
      { id: q1, editionId: edition, printedLabel: "1", pageId: known(page, refs) },
      { id: q2, editionId: edition, printedLabel: "2", pageId: known(page, refs) },
    ],
  };
}
function source(overrides: Partial<SourceObservation> = {}): SourceObservation {
  const context = {
    studentId: student, lessonDate: "2026-10-01", occurrenceId: known("synthetic-occurrence-a", refs),
    localStartTime: known("14:00", refs), timeZone: "Asia/Seoul",
  };
  return {
    kind: "source_observation", context,
    sessionKind: "lesson", makeupForOccurrenceId: unknown("not a makeup"),
    scope: { editionId: known(edition, refs), unitId: known(minor, refs), pageIds: known([page], refs), problemIds: known([q1], refs) },
    provenance: {
      system: "lms_day_record", recordKey: "synthetic-record-a", observedAt: stamp,
      sourceTimestamp: known("2026-10-01T04:59:00Z", refs), contractRef: "synthetic:contract", contentDigest: unknown("not supplied"),
    },
    exactBinding: known({ studentId: student, lessonDate: context.lessonDate, occurrenceId: "synthetic-occurrence-a" }, refs),
    attendance: known("held", refs), activity: "attempted", correctionChecked: unknown("not inspected"), correctness: unknown("no question grade"),
    ...overrides,
  };
}
function plan(overrides: Partial<TeacherPlan> = {}): TeacherPlan {
  const sample = source();
  return {
    kind: "teacher_plan", context: sample.context, teacherId: "synthetic-teacher", horizon: "present", purpose: "lesson",
    status: "approved", scope: sample.scope, assignmentId: unknown("not joined"), basedOnRevisionIds: [], dueDate: unknown("not set"),
    ...overrides,
  };
}
function history(entries: readonly LearningEntry[]): readonly LearningRevision[] {
  let ledger: readonly LearningRevision[] = [];
  entries.forEach((payload, index) => {
    const next = appendRevision(ledger, {
      entityId: stableId("entity", "synthetic", String(index)), expectedRevisionId: null, idempotencyKey: `synthetic:${index}`,
      actorId: "synthetic-reader", recordedAt: stamp, reason: "Synthetic projection fixture", payload,
    });
    if (next.result.status !== "ready") throw new Error("Fixture append failed");
    ledger = next.history;
  });
  return ledger;
}
function project(entries: readonly LearningEntry[] = [source(), plan()], filters: Partial<LearningViewFilters> = {}) {
  return projectLearningView({
    history: history(entries), catalog: catalog(), filters: { asOfDate: "2026-10-01", timeZone: "Asia/Seoul", ...filters },
    capturedAt: stamp, sourceCoverage: known("complete", refs), maxSourceAgeMs: 60_000,
  });
}
function dateSource(date: string): SourceObservation {
  const row = source();
  return source({ context: { ...row.context, lessonDate: date }, exactBinding: known({ studentId: student, lessonDate: date, occurrenceId: "synthetic-occurrence-a" }, refs) });
}

const target: MainSheetTarget = { spreadsheetId: "synthetic-workbook", sheetId: 42, title: "Synthetic Main" };
function snapshot(): MainSheetSnapshot {
  return {
    target, snapshotId: "synthetic-snapshot", observedAt: stamp, revisionToken: "revision-one",
    layoutVersion: LEARNING_VIEW_LAYOUT_VERSION, rows: 160, columns: 16,
    inventory: { cellsComplete: true, formulasComplete: true, protectionsComplete: true, manualOwnershipComplete: true,
      structureFingerprint: "synthetic-layout-digest", protectionFingerprint: "synthetic-protection-digest" },
    cells: cellsInLearningRange("A1:P160").map(cell => ({ cell, value: null, formula: null, note: null, protected: false, teacherOwned: learningCellOwner(cell) === "teacher" })),
  };
}
function editCell(input: MainSheetSnapshot, address: string, edit: Partial<MainSheetSnapshot["cells"][number]>): MainSheetSnapshot {
  return { ...input, cells: input.cells.map(cell => cell.cell === address ? { ...cell, ...edit } : cell) };
}
function preview(baseline = snapshot(), observed = baseline, desired: readonly LiteralCell[] = [{ cell: "A1", value: "Synthetic view", valueKind: "literal" }]) {
  return buildMainSheetDryRun({ expectedTarget: target, baseline, observed, desired, now: stamp, maxSnapshotAgeMs: 60_000 });
}

describe("learning Main Sheet projection", () => {
  it("filters Monday-through-Sunday weeks across month boundaries using local lesson dates", () => {
    const entries = [dateSource("2026-09-27"), dateSource("2026-09-28"), dateSource("2026-10-04"), dateSource("2026-10-05")];
    const selected = project(entries, { weekStart: "2026-09-28" });
    expect(selected.sourceFacts.map(row => row.entry.context.lessonDate)).toEqual(["2026-09-28", "2026-10-04"]);
    expect(selected.weeklyOverview.weeks).toHaveLength(1);
    expect(selected.weeklyOverview.weeks[0]).toMatchObject({ weekStart: "2026-09-28", weekEnd: "2026-10-04", period: "current", startsOn: "monday" });
    const octoberIntersection = project(entries, { month: "2026-10", weekStart: "2026-09-28" });
    expect(octoberIntersection.sourceFacts.map(row => row.entry.context.lessonDate)).toEqual(["2026-10-04"]);
  });
  it("preserves week→lesson→edition grouping with distinct source and teacher envelopes", () => {
    const result = project([dateSource("2026-09-23"), source(), plan(), plan({ context: { ...plan().context, lessonDate: "2026-10-08" }, horizon: "future", status: "draft" })]);
    expect(result.weeklyOverview.weeks.map(week => [week.weekStart, week.period])).toEqual([
      ["2026-09-21", "historical"], ["2026-09-28", "current"], ["2026-10-05", "future"],
    ]);
    const current = result.weeklyOverview.weeks[1]!.lessons[0]!.editions[0]!;
    expect(current.sourceFacts).toHaveLength(1);
    expect(current.teacherPlans).toHaveLength(1);
    expect(current.sourceFacts[0]!.revisionId).toBe(result.sourceFacts[1]!.revisionId);
    expect(current.teacherPlans[0]!.entry.scope.problemIds).toEqual(plan().scope.problemIds);
  });
  it("does not guess a week for foreign-zone rows before applying the week filter", () => {
    const old = dateSource("2026-09-23");
    const row = { ...old, context: { ...old.context, timeZone: "America/New_York" } };
    const result = project([row], { weekStart: "2026-10-05", lessonTime: "14:00" });
    expect(result.sourceFacts).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.period).toBe("unresolved");
    expect(result.weeklyOverview.weeks).toHaveLength(0);
  });
  it("rejects non-Monday and contradictory week/date/month selectors", () => {
    expect(() => project([], { weekStart: "2026-10-01" })).toThrow("Monday");
    expect(() => project([], { weekStart: "2026-09-28", date: "2026-10-05" })).toThrow("outside selected week");
    expect(() => project([], { weekStart: "2026-09-21", month: "2026-10" })).toThrow("do not overlap");
  });
  it("prunes weekly hierarchy rows consistently while keeping whole-plan reconciliation independent", () => {
    const first = source({ activity: "reported_complete" });
    const second = source({ activity: "reported_complete", scope: { ...source().scope, problemIds: known([q2], refs) }, provenance: { ...source().provenance, recordKey: "synthetic-second" } });
    const wholePlan = plan({ scope: { ...plan().scope, problemIds: known([q1, q2], refs) } });
    const result = project([first, second, wholePlan], { weekStart: "2026-09-28", hierarchy: { problemId: q1 } });
    const grouped = result.weeklyOverview.weeks[0]!.lessons[0]!.editions[0]!;
    expect(grouped.sourceFacts).toHaveLength(1);
    expect(grouped.teacherPlans).toHaveLength(1);
    expect(grouped.sourceFacts[0]!.entityId).toBe(result.sourceFacts[0]!.entityId);
    expect(result.planComparisons[0]!.result.coverage).toBe("fully_observed");
  });
  it("keeps unknown-time rows in the unresolved queue when a week and time are selected", () => {
    const row = source({ context: { ...source().context, localStartTime: unknown("unverified time") } });
    const result = project([row], { weekStart: "2026-09-28", lessonTime: "14:00" });
    expect(result.weeklyOverview.weeks).toHaveLength(0);
    expect(result.unresolved[0]!.issues).toContain("lesson_time_unresolved");
    expect(result.wholeClass[0]!.unresolvedCount).toBe(1);
  });
  it("offers observed week selectors without assigning a new cell or changing source dates", () => {
    const result = project([dateSource("2026-09-23"), source()]);
    expect(learningWeekSelectorOptions(result)).toEqual([
      { label: "전체", weekStart: null },
      { label: "2026-09-21–2026-09-27", weekStart: "2026-09-21" },
      { label: "2026-09-28–2026-10-04", weekStart: "2026-09-28" },
    ]);
    const selected = project([source()], { weekStart: "2026-09-28" });
    expect(renderLearningViewCells(selected).cells.find(cell => cell.cell === "A2")!.value).toContain("선택 주 2026-09-28–2026-10-04");
    expect(learningCellOwner("A7")).toBe("preserve");
  });
  it("separates historical/current/future facts and plans without promoting plans to academy facts", () => {
    const old = dateSource("2026-09-30");
    const futurePlan = plan({ context: { ...plan().context, lessonDate: "2026-10-02" }, horizon: "future", status: "draft" });
    const result = project([old, source(), plan(), futurePlan]);
    expect(result.comparison.historical.sourceFacts).toHaveLength(1);
    expect(result.comparison.current.sourceFacts).toHaveLength(1);
    expect(result.comparison.current.teacherPlans).toHaveLength(1);
    expect(result.comparison.future.sourceFacts).toHaveLength(0);
    expect(result.comparison.future.teacherPlans).toHaveLength(1);
    expect(result.mode).toBe("read_only_projection");
  });
  it("AND-filters month/date/time/student but retains the whole-class overview", () => {
    const other = source({ context: { ...source().context, studentId: otherStudent }, exactBinding: known({ studentId: otherStudent, lessonDate: "2026-10-01", occurrenceId: "synthetic-occurrence-a" }, refs) });
    const result = project([source(), other, dateSource("2026-09-30")], { month: "2026-10", date: "2026-10-01", lessonTime: "14:00", studentId: student });
    expect(result.sourceFacts).toHaveLength(1);
    expect(result.wholeClass).toHaveLength(2);
  });
  it("keeps unknown lesson-time matches in an explicit unresolved queue", () => {
    const row = source({ context: { ...source().context, localStartTime: unknown("no verified lesson time") } });
    const result = project([row], { lessonTime: "14:00" });
    expect(result.sourceFacts).toHaveLength(0);
    expect(result.unresolved[0]!.issues).toContain("lesson_time_unresolved");
    expect(result.wholeClass[0]!.unresolvedCount).toBe(1);
  });
  it("keeps unmatched identity visible without allowing reconciliation", () => {
    const unbound = source({ exactBinding: unknown("observed row only") });
    const result = project([unbound, plan()]);
    expect(result.sourceFacts[0]!.identity).toBe("unresolved");
    expect(result.unresolved).toHaveLength(1);
    expect(result.planComparisons[0]!.result.completion).toBe("not_established");
    expect(result.questionAudit.find(row => row.path.problem.id === q1)!.status).toBe("identity_unresolved");
  });
  it("uses local lesson dates and makes mixed time zones unresolved", () => {
    const row = source({ context: { ...source().context, timeZone: "America/New_York" } });
    expect(project([row]).unresolved[0]!.issues).toContain("lesson_time_zone_unresolved");
    expect(project([dateSource("2026-09-30")]).comparison.historical.sourceFacts).toHaveLength(1);
  });
  it("does not discard foreign-zone rows by incomparable month/date/time filters", () => {
    const base = dateSource("2026-09-30");
    const row = { ...base, context: { ...base.context, localStartTime: known("01:00", refs), timeZone: "America/New_York" } };
    const result = project([row], { month: "2026-10", date: "2026-10-01", lessonTime: "14:00" });
    expect(result.sourceFacts).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.period).toBe("unresolved");
    expect(result.wholeClass[0]!.unresolvedCount).toBe(1);
  });
  it("does not re-admit foreign-zone observations into full-evidence reconciliation", () => {
    const row = source({ context: { ...source().context, timeZone: "America/New_York", localStartTime: known("01:00", refs) }, activity: "reported_complete" });
    const result = project([row, plan()], { lessonTime: "14:00" });
    expect(result.unresolved).toHaveLength(1);
    expect(result.planComparisons[0]!.result.coverage).toBe("not_observed");
    expect(result.planComparisons[0]!.result.completion).toBe("not_established");
  });
  it("reconciles the whole visible plan against full evidence independent of hierarchy narrowing", () => {
    const first = source({ activity: "reported_complete" });
    const second = source({ activity: "reported_complete", scope: { ...source().scope, problemIds: known([q2], refs) }, provenance: { ...source().provenance, recordKey: "synthetic-second" } });
    const wholePlan = plan({ scope: { ...plan().scope, problemIds: known([q1, q2], refs) } });
    const full = project([first, second, wholePlan]);
    const narrowed = project([first, second, wholePlan], { hierarchy: { problemId: q1 } });
    expect(narrowed.sourceFacts).toHaveLength(1);
    expect(narrowed.planComparisons[0]!.result).toEqual(full.planComparisons[0]!.result);
    expect(narrowed.planComparisons[0]!.result.coverage).toBe("fully_observed");
    expect(narrowed.planComparisons[0]!.result.completion).toBe("reported_only");
  });
  it("filters by opaque edition/major/middle/minor/page/question keys", () => {
    const result = project([source()], { hierarchy: { editionId: edition, majorUnitId: major, middleUnitId: middle, minorUnitId: minor, pageId: page, problemId: q1 } });
    expect(result.sourceFacts).toHaveLength(1);
    expect(result.questionAudit).toHaveLength(1);
    expect(result.questionAudit[0]!.path.page!.printedLabel).toBe("12-A");
    expect(project([source()], { hierarchy: { problemId: q2 } }).sourceFacts).toHaveLength(0);
  });
  it("does not join a source's missing edition from a matching catalog label", () => {
    const row = source({ scope: { ...source().scope, editionId: unknown("edition not verified") } });
    expect(project([row], { hierarchy: { editionId: edition } }).unresolved[0]!.issues).toContain("hierarchy_match_unresolved");
  });
  it("keeps per-question identity and inspection unresolved when the source edition is unknown", () => {
    const row = source({
      scope: { ...source().scope, editionId: unknown("edition not verified") },
      provenance: { ...source().provenance, system: "teacher_observation" },
      activity: "teacher_inspected", correctionChecked: known(true, refs),
    });
    const audit = project([row]).questionAudit.find(item => item.path.problem.id === q1)!;
    expect(audit.path.editionId).toBe(edition);
    expect(audit.status).toBe("identity_unresolved");
    expect(audit.evidence[0]!.identity).toBe("unresolved");
    expect(audit.evidence[0]!.teacherInspection).toBe("not_established");
  });
  it("rejects bad calendar values and unknown/mismatched hierarchy selectors", () => {
    expect(() => project([], { month: "2026-13" })).toThrow();
    expect(() => project([], { date: "2026-02-30" })).toThrow();
    expect(() => project([], { month: "2026-10", date: "2026-09-30" })).toThrow();
    expect(() => project([], { lessonTime: "24:00" })).toThrow();
    expect(() => project([], { hierarchy: { majorUnitId: minor } })).toThrow();
    expect(() => project([], { hierarchy: { problemId: stableId("problem", "synthetic", "missing") } })).toThrow();
  });
  it("retains stale observations and excludes them from completion reconciliation", () => {
    const result = projectLearningView({ history: history([source({ activity: "reported_complete" }), plan()]), catalog: catalog(),
      filters: { asOfDate: "2026-10-01", timeZone: "Asia/Seoul" }, capturedAt: "2026-10-01T06:00:00Z",
      sourceCoverage: unknown("pagination not verified"), maxSourceAgeMs: 60_000 });
    expect(result.sourceFacts[0]!.freshness).toBe("stale");
    expect(result.planComparisons[0]!.result.completion).toBe("not_established");
    expect(result.warnings.some(item => item.includes("coverage is incomplete"))).toBe(true);
  });
  it("keeps app correctness, correction and teacher inspection distinct", () => {
    const row = source({ provenance: { ...source().provenance, system: "app_submission" }, correctness: known("correct", refs), correctionChecked: known(true, refs), activity: "reported_complete" });
    const audit = project([row]).questionAudit.find(item => item.path.problem.id === q1)!;
    expect(audit.evidence[0]!.correctness).toEqual(known("correct", refs));
    expect(audit.evidence[0]!.teacherInspection).toBe("not_established");
  });
  it("does not broadcast a multi-question grade to individual questions", () => {
    const row = source({ scope: { ...source().scope, problemIds: known([q1, q2], refs) }, correctness: known("partial", refs), correctionChecked: known(true, refs) });
    const audit = project([row]).questionAudit;
    expect(audit).toHaveLength(2);
    expect(audit.every(item => item.evidence[0]!.correctness.state === "unknown")).toBe(true);
    expect(audit.every(item => item.evidence[0]!.correctionChecked.state === "unknown")).toBe(true);
  });
  it("shows catalog questions under a page-only source with unknown question evidence", () => {
    const row = source({ scope: { ...source().scope, problemIds: unknown("question map not bound") }, activity: "reported_complete" });
    const audit = project([row]).questionAudit;
    expect(audit).toHaveLength(2);
    expect(audit.every(item => item.status === "not_observed" && !item.evidence.length)).toBe(true);
    expect(audit[0]!.contextRevisionIds).toHaveLength(1);
  });
  it("uses the latest validated revision, not duplicate entity rows", () => {
    const initial = history([plan()]);
    const revised = appendRevision(initial, { entityId: initial[0]!.entityId, expectedRevisionId: initial[0]!.revisionId,
      idempotencyKey: "synthetic-correction", actorId: "synthetic-teacher", recordedAt: stamp, reason: "Revise plan",
      payload: plan({ status: "cancelled" }) });
    const result = projectLearningView({ history: revised.history, catalog: catalog(), filters: { asOfDate: "2026-10-01", timeZone: "Asia/Seoul" },
      capturedAt: stamp, sourceCoverage: known("complete", refs), maxSourceAgeMs: 60_000 });
    expect(result.teacherPlans).toHaveLength(1);
    expect((result.teacherPlans[0]!.entry as TeacherPlan).status).toBe("cancelled");
    expect(() => projectLearningView({ history: [{ ...initial[0]!, reason: "tampered" }], catalog: catalog(), filters: result.filters,
      capturedAt: stamp, sourceCoverage: known("complete", refs), maxSourceAgeMs: 60_000 })).toThrow();
  });
  it("keeps makeup observations independent and never merges them into normal plans", () => {
    const row = source({ sessionKind: "makeup", makeupForOccurrenceId: known("synthetic-original-lesson", refs), activity: "reported_complete" });
    const result = project([row, plan()]);
    expect((result.sourceFacts[0]!.entry as SourceObservation).sessionKind).toBe("makeup");
    expect(result.planComparisons[0]!.result.completion).toBe("not_established");
  });
  it("rejects future-recorded snapshots and requires an explicit freshness policy", () => {
    const common = { history: history([source()]), catalog: catalog(), filters: { asOfDate: "2026-10-01", timeZone: "Asia/Seoul" }, sourceCoverage: known("complete" as const, refs) };
    expect(() => projectLearningView({ ...common, capturedAt: "2026-10-01T04:00:00Z", maxSourceAgeMs: 60_000 })).toThrow();
    expect(() => projectLearningView({ ...common, capturedAt: stamp, maxSourceAgeMs: -1 })).toThrow();
  });
  it("renders only A:P auto-owned cells and reports every truncated section", () => {
    const entries = Array.from({ length: 23 }, (_, index) => source({ provenance: { ...source().provenance, recordKey: `synthetic-record-${index}` } }));
    const result = project(entries);
    const rendered = renderLearningViewCells(result);
    expect(rendered.sections.find(row => row.key === "sourceFacts")).toMatchObject({ total: 23, shown: 20, remaining: 3 });
    expect(rendered.cells.every(cell => learningCellOwner(cell.cell) === "projection")).toBe(true);
    expect(rendered.cells.some(cell => cell.cell === "K4" || cell.cell === "A143")).toBe(false);
    expect(renderLearningViewCells(result, { sourceFacts: 20 }).sections.find(row => row.key === "sourceFacts")).toMatchObject({ shown: 3, remaining: 0 });
    expect(() => renderLearningViewCells(result, { sourceFacts: 24 })).toThrow();
  });
  it("returns immutable projections without mutating source input", () => {
    const rows = [source(), plan()];
    const before = JSON.stringify(rows);
    const view = project(rows);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.sourceFacts[0]!.entry)).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("generates the native design preview from this renderer with explicit static controls", async () => {
    const fixture = makeSyntheticLearningPreview();
    const stored = await Bun.file(new URL("../../docs/main-sheet-preview.synthetic.json", import.meta.url)).json();
    expect(stored).toEqual(fixture);
    expect(fixture.syntheticOnly).toBe(true);
    expect(fixture.status).toBe("static_design_only");
    expect(fixture.controls).toHaveLength(10);
    expect(fixture.cells.some(cell => cell.cell.startsWith("L") && typeof cell.value === "string" && cell.value.includes("conflict"))).toBe(true);
    expect(fixture.cells.some(cell => cell.value === "가상 학생 A")).toBe(true);
    expect(fixture.cells.every(cell => learningCellOwner(cell.cell) === "projection")).toBe(true);
  });
  it("records finite synthetic scenario parity without allowing Sheet-side audit inference", async () => {
    const original = await Bun.file(new URL("../../docs/main-sheet-scenarios.synthetic.json", import.meta.url)).json();
    const weekly = await Bun.file(new URL("../../docs/main-sheet-week-scenarios.synthetic.json", import.meta.url)).json();
    expect(original).toMatchObject({ syntheticOnly: true, scenarioCount: 90, validCount: 66, invalidCount: 24, invarianceChecks: 462, invariantFailures: [] });
    expect(weekly).toMatchObject({ syntheticOnly: true, scenarioCount: 360, validCount: 156, invalidCount: 204, invarianceChecks: 1092, invariantFailures: [] });
    expect(new Set(weekly.scenarios.map((scenario: { selectorKey: string }) => scenario.selectorKey)).size).toBe(360);
    expect(weekly.scenarios.find((scenario: { selectorKey: string }) => scenario.selectorKey === "전체|2026-09-21|전체|전체|전체").counts)
      .toEqual({ source: 1, plans: 0, audit: 2, unresolved: 0, wholeClass: 1 });
    expect(weekly.scenarios.find((scenario: { selectorKey: string }) => scenario.selectorKey === "전체|2026-09-28|전체|전체|전체").counts)
      .toEqual({ source: 4, plans: 1, audit: 6, unresolved: 1, wholeClass: 1 });
    expect(weekly.scenarios.find((scenario: { selectorKey: string }) => scenario.selectorKey === "전체|2026-10-05|전체|전체|전체").counts)
      .toEqual({ source: 0, plans: 1, audit: 2, unresolved: 0, wholeClass: 1 });
    expect(weekly.scenarios.find((scenario: { selectorKey: string }) => scenario.selectorKey === "전체|2026-09-28|전체|전체|1").counts)
      .toEqual({ source: 2, plans: 1, audit: 1, unresolved: 0, wholeClass: 1 });
    expect(weekly.scenarios.find((scenario: { selectorKey: string }) => scenario.selectorKey === "2026-10|2026-09-21|전체|전체|전체").status).toBe("invalid");
    expect(weekly.scenarios.filter((scenario: { status: string }) => scenario.status === "valid").every((scenario: { sections: { rows: unknown[][]; shown: number }[] }) =>
      scenario.sections.every(section => section.rows.length === section.shown && section.rows.every(row => row.length === 16)))).toBe(true);
  });
});

describe("bounded Main Sheet migration and refresh preview", () => {
  it("defines disjoint auto/manual ownership and defaults all remaining cells to preserve", () => {
    const auto = LEARNING_VIEW_AUTO_RANGES.flatMap(cellsInLearningRange);
    const manual = LEARNING_VIEW_MANUAL_RANGES.flatMap(cellsInLearningRange);
    expect(new Set(auto).size).toBe(auto.length);
    expect(manual.some(cell => auto.includes(cell))).toBe(false);
    expect(learningCellOwner("A7")).toBe("preserve");
    expect(EXISTING_SHEET_PRESERVATION.main.selectors).toEqual(["I5", "I8"]);
    expect(EXISTING_SHEET_PRESERVATION.todayPanel.teacherOwnedRanges).toContain("R10:U39");
  });
  it("produces exact before/after/recovery values without an executable request", () => {
    const result = preview();
    expect(result.status).toBe("preview_ready");
    expect(result.executable).toBe(false);
    expect(result.mode).toBe("dry_run_only");
    expect(result.changes).toEqual([{ cell: "A1", before: null, after: "Synthetic view", valueKind: "literal", reason: "projection_refresh" }]);
    expect(result.recovery).toEqual([{ cell: "A1", onlyIfCurrentValueEquals: "Synthetic view", restore: null }]);
    expect(result).not.toHaveProperty("requests");
  });
  it("blocks unadopted legacy layout and does not infer layout from the larger grid", () => {
    const old = { ...snapshot(), layoutVersion: "legacy-observed", rows: 160, columns: 16 };
    const result = preview(old);
    expect(result.status).toBe("blocked");
    expect(result.issues.map(row => row.code)).toContain("observed_layout_not_adopted");
  });
  it("preserves teacher inputs, protected cells, formulas and notes even when blank", () => {
    for (const edit of [{ teacherOwned: true }, { protected: true }, { formula: "=IF(TRUE,\"\",1)" }, { note: "Teacher correction" }]) {
      const snap = editCell(snapshot(), "A1", edit);
      const result = preview(snap);
      expect(result.status).toBe("blocked");
      expect(result.changes).toHaveLength(0);
      expect(result.preservedCells).toContain("A1");
    }
    for (const cell of ["K4", "A143", "A7"]) {
      const result = preview(undefined, undefined, [{ cell, value: "do not write", valueKind: "literal" }]);
      expect(result.issues.map(row => row.code)).toContain("outside_projection_allowlist");
      expect(result.changes).toHaveLength(0);
    }
  });
  it("detects changed manual cells even if caller reuses snapshot/revision identifiers", () => {
    const baseline = snapshot();
    const observed = editCell(baseline, "A143", { value: "new teacher input" });
    const result = preview(baseline, observed);
    expect(result.status).toBe("blocked");
    expect(result.issues.find(row => row.code === "snapshot_cells_changed")!.cells).toEqual(["A143"]);
    expect(result.beforeDigest).not.toBe(result.observedDigest);
  });
  it("detects structural/protection/revision drift and wrong sheet targets", () => {
    const baseline = snapshot();
    const observed = { ...baseline, revisionToken: "revision-two", target: { ...target, sheetId: 43 },
      inventory: { ...baseline.inventory, protectionFingerprint: "changed" } };
    const result = preview(baseline, observed);
    expect(result.issues.map(row => row.code)).toEqual(expect.arrayContaining(["observed_target_mismatch", "snapshot_metadata_changed"]));
  });
  it("does not treat a missing cell or incomplete inventory as blank", () => {
    const snap = snapshot();
    const incomplete = { ...snap, cells: snap.cells.filter(row => row.cell !== "A1"), inventory: { ...snap.inventory, formulasComplete: false } };
    const result = preview(incomplete);
    expect(result.status).toBe("blocked");
    expect(result.issues.map(row => row.code)).toContain("desired_cell_unobserved");
    expect(result.issues.map(row => row.code)).toContain("observed_inventory_incomplete");
    expect(result.changes).toHaveLength(0);
  });
  it("requires literal true for inventory completeness at the runtime boundary", () => {
    for (const flag of ["cellsComplete", "formulasComplete", "protectionsComplete", "manualOwnershipComplete"] as const) {
      for (const invalid of ["false", "true", 1, {}, [], null, false]) {
        const snap = snapshot();
        const malformed = { ...snap, inventory: { ...snap.inventory, [flag]: invalid } } as unknown as MainSheetSnapshot;
        const result = preview(malformed);
        expect(result.status).toBe("blocked");
        expect(result.issues.map(row => row.code)).toContain("observed_inventory_incomplete");
      }
    }
  });
  it("blocks stale or future snapshots with caller-supplied freshness policy", () => {
    for (const observedAt of ["2026-10-01T04:00:00Z", "2026-10-01T06:00:00Z"]) {
      expect(preview({ ...snapshot(), observedAt }).issues.map(row => row.code)).toContain("observed_snapshot_stale");
    }
  });
  it("keeps formula-looking strings literal and preserves false versus zero", () => {
    const result = preview(undefined, undefined, [
      { cell: "A1", value: "=IMPORTXML(\"never-run\")", valueKind: "literal" },
      { cell: "B1", value: false, valueKind: "literal" },
      { cell: "C1", value: 0, valueKind: "literal" },
    ]);
    expect(result.status).toBe("preview_ready");
    expect(result.changes.map(row => row.after)).toEqual(["=IMPORTXML(\"never-run\")", false, 0]);
    expect(result.changes.every(row => row.valueKind === "literal")).toBe(true);
  });
  it("rejects broad/cross-sheet/out-of-grid ranges and duplicate desired cells", () => {
    for (const cell of ["A:A", "Other!A1", "Q1", "A161", "A1:B2"]) {
      expect(() => preview(undefined, undefined, [{ cell, value: "x", valueKind: "literal" }])).toThrow();
    }
    expect(() => preview(undefined, undefined, [{ cell: "A1", value: "x", valueKind: "literal" }, { cell: "A1", value: "y", valueKind: "literal" }])).toThrow();
  });
  it("is deterministic, immutable and idempotent on unchanged values", () => {
    expect(preview().previewDigest).toBe(preview().previewDigest);
    expect(Object.isFrozen(preview().changes)).toBe(true);
    const snap = editCell(snapshot(), "A1", { value: "Synthetic view" });
    expect(preview(snap).changes).toHaveLength(0);
    expect(preview(snap).unchangedCells).toEqual(["A1"]);
  });
  it("integrates the projection into a bounded preview without touching selectors", () => {
    const view = project();
    const rendered = renderLearningViewCells(view);
    const snap = editCell(snapshot(), "K4", { value: student });
    const result = preview(snap, snap, rendered.cells);
    expect(result.status).toBe("preview_ready");
    expect(result.changes.every(row => learningCellOwner(row.cell) === "projection")).toBe(true);
    expect(result.preservedCells).toContain("K4");
    expect(snap.cells.find(cell => cell.cell === "K4")!.value).toBe(student);
  });
});
