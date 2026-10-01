/** Pure Main Sheet read model: exact identity, explicit unknowns and teacher/source separation. */
import {
  assertDate, assertInstant, assertTime, assertKnowledge, assertWeekStart, canonicalJson, currentRevisions, digest, immutableCopy,
  localCalendarWeek, projectLearningWeeks, reconcilePlan, requireText, resolveProblemPath, unknown, validateCatalog, validateScope, weekStartForLocalDate,
  type ContentScope, type EditionId, type EntityId, type Knowledge, type LearningCatalog,
  type LearningEntry, type LearningRevision, type PageId, type ProblemId, type Reconciliation,
  type RevisionId, type SourceObservation, type StudentId, type UnitId, type LearningWeekGroup,
} from "../learning/index.ts";
import {
  cellsInLearningRange, LEARNING_VIEW_AUTO_RANGES, LEARNING_VIEW_LAYOUT_VERSION,
  type LiteralCell, type LiteralValue,
} from "./mainSheetLearningPreview.ts";

export interface HierarchyFilter {
  readonly editionId?: EditionId;
  readonly majorUnitId?: UnitId;
  readonly middleUnitId?: UnitId;
  readonly minorUnitId?: UnitId;
  readonly pageId?: PageId;
  readonly problemId?: ProblemId;
}
export interface LearningViewFilters {
  readonly asOfDate: string;
  readonly timeZone: string;
  readonly month?: string;
  /** Monday date in the selected lesson-local calendar, not a source timestamp. */
  readonly weekStart?: string;
  readonly date?: string;
  readonly lessonTime?: string;
  readonly studentId?: StudentId;
  readonly hierarchy?: HierarchyFilter;
}
export type TemporalPeriod = "historical" | "current" | "future" | "unresolved";
export interface LearningViewRow {
  readonly entityId: EntityId;
  readonly revisionId: RevisionId;
  readonly recordedAt: string;
  readonly entry: LearningEntry;
  readonly period: TemporalPeriod;
  readonly identity: "verified" | "unresolved";
  readonly freshness: "fresh" | "stale" | "not_source";
  readonly filterMatch: "matched" | "unresolved";
  readonly issues: readonly string[];
}
export interface QuestionEvidence {
  readonly entityId: EntityId;
  readonly revisionId: RevisionId;
  readonly source: SourceObservation["provenance"];
  readonly activity: SourceObservation["activity"];
  readonly correctness: SourceObservation["correctness"];
  readonly correctionChecked: Knowledge<boolean>;
  readonly identity: "verified" | "unresolved";
  readonly freshness: "fresh" | "stale";
  /** Presence of a grade never becomes a teacher-inspection claim. */
  readonly teacherInspection: "correction_checked" | "not_established";
}
export interface QuestionAuditRow {
  readonly studentId: StudentId;
  readonly occurrenceId: Knowledge<string>;
  readonly lessonDate: string;
  readonly path: ReturnType<typeof resolveProblemPath>;
  readonly evidence: readonly QuestionEvidence[];
  readonly plans: readonly { entityId: EntityId; revisionId: RevisionId; status: "draft" | "approved" | "cancelled" }[];
  readonly contextRevisionIds: readonly RevisionId[];
  readonly status: "evidence_present" | "identity_unresolved" | "stale_evidence" | "not_observed";
}
export interface LearningView {
  readonly layoutVersion: typeof LEARNING_VIEW_LAYOUT_VERSION;
  readonly mode: "read_only_projection";
  readonly filters: LearningViewFilters;
  readonly capturedAt: string;
  readonly inputDigest: string;
  readonly sourceCoverage: Knowledge<"complete" | "partial">;
  readonly catalog: LearningCatalog;
  /** Display-only labels. They are never used to join records or select identities. */
  readonly studentLabels: readonly { studentId: StudentId; label: string }[];
  readonly weeklyOverview: {
    readonly currentWeekStart: string;
    readonly timeZone: string;
    readonly startsOn: "monday";
    readonly weeks: readonly LearningWeekGroup[];
  };
  readonly wholeClass: readonly {
    studentId: StudentId; sourceCount: number; planCount: number; unresolvedCount: number; staleCount: number;
  }[];
  readonly sourceFacts: readonly LearningViewRow[];
  readonly teacherPlans: readonly LearningViewRow[];
  readonly unresolved: readonly LearningViewRow[];
  readonly comparison: Readonly<Record<Exclude<TemporalPeriod, "unresolved">, { sourceFacts: readonly LearningViewRow[]; teacherPlans: readonly LearningViewRow[] }>>;
  readonly questionAudit: readonly QuestionAuditRow[];
  readonly planComparisons: readonly { entityId: EntityId; revisionId: RevisionId; result: Reconciliation }[];
  readonly warnings: readonly string[];
}

type PathIds = HierarchyFilter;
type Match = "matched" | "unresolved" | "excluded";
function unitPath(catalog: LearningCatalog, unitId: UnitId): PathIds {
  const unit = catalog.units.find(item => item.id === unitId)!;
  const parent = unit.level !== "major" && unit.parentId.state === "known" ? unitPath(catalog, unit.parentId.value) : {};
  return { ...parent, editionId: unit.editionId, [unit.level === "major" ? "majorUnitId" : unit.level === "middle" ? "middleUnitId" : "minorUnitId"]: unit.id };
}
function pagePath(catalog: LearningCatalog, pageId: PageId): PathIds {
  const page = catalog.pages.find(item => item.id === pageId)!;
  return { ...(page.minorUnitId.state === "known" ? unitPath(catalog, page.minorUnitId.value) : {}), editionId: page.editionId, pageId };
}
function problemPath(catalog: LearningCatalog, problemId: ProblemId): PathIds {
  const problem = catalog.problems.find(item => item.id === problemId)!;
  return { ...(problem.pageId.state === "known" ? pagePath(catalog, problem.pageId.value) : {}), editionId: problem.editionId, problemId };
}
function matchesPath(path: PathIds, filter: HierarchyFilter): Match {
  let unknown = false;
  for (const key of Object.keys(filter) as (keyof HierarchyFilter)[]) {
    if (path[key] === undefined) unknown = true;
    else if (path[key] !== filter[key]) return "excluded";
  }
  return unknown ? "unresolved" : "matched";
}
function validateFilters(filters: LearningViewFilters, catalog: LearningCatalog): void {
  assertDate(filters.asOfDate);
  requireText(filters.timeZone, "filter time zone");
  try { new Intl.DateTimeFormat("en", { timeZone: filters.timeZone }); } catch { throw new Error("invalid filter time zone"); }
  if (filters.month !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(filters.month)) throw new Error("invalid month filter");
  if (filters.date !== undefined) assertDate(filters.date);
  if (filters.date && filters.month && !filters.date.startsWith(`${filters.month}-`)) throw new Error("date is outside selected month");
  if (filters.weekStart !== undefined) {
    assertWeekStart(filters.weekStart);
    if (filters.date && weekStartForLocalDate(filters.date) !== filters.weekStart) throw new Error("date is outside selected week");
    const week = localCalendarWeek(filters.weekStart);
    if (filters.month && (filters.month < week.weekStart.slice(0, 7) || filters.month > week.weekEnd.slice(0, 7))) {
      throw new Error("selected month and week do not overlap");
    }
  }
  if (filters.lessonTime !== undefined) assertTime(filters.lessonTime);
  if (filters.studentId !== undefined) requireText(filters.studentId, "student filter");
  const hierarchy = filters.hierarchy ?? {};
  for (const [key, id] of Object.entries(hierarchy)) {
    requireText(id, "hierarchy filter id");
    if (key === "editionId" && !catalog.editions.some(row => row.id === id)) throw new Error("unknown edition filter");
    if (["majorUnitId", "middleUnitId", "minorUnitId"].includes(key) &&
      !catalog.units.some(row => row.id === id && `${row.level}UnitId` === key)) throw new Error("unknown unit filter");
    if (key === "pageId" && !catalog.pages.some(row => row.id === id)) throw new Error("unknown page filter");
    if (key === "problemId" && !catalog.problems.some(row => row.id === id)) throw new Error("unknown question filter");
    if (!["editionId", "majorUnitId", "middleUnitId", "minorUnitId", "pageId", "problemId"].includes(key)) throw new Error("unsupported hierarchy filter");
  }
  const paths: PathIds[] = [
    ...(hierarchy.problemId ? [problemPath(catalog, hierarchy.problemId)] : []),
    ...(hierarchy.pageId ? [pagePath(catalog, hierarchy.pageId)] : []),
    ...([hierarchy.majorUnitId, hierarchy.middleUnitId, hierarchy.minorUnitId].filter(Boolean) as UnitId[]).map(id => unitPath(catalog, id)),
  ];
  for (const path of paths) for (const key of Object.keys(path) as (keyof HierarchyFilter)[]) {
    if (hierarchy[key] !== undefined && hierarchy[key] !== path[key]) throw new Error("inconsistent hierarchy filters");
  }
}
function scopeMatch(scope: ContentScope, filter: HierarchyFilter, catalog: LearningCatalog): Match {
  if (!Object.keys(filter).length) return "matched";
  if (filter.editionId && scope.editionId.state === "known" && filter.editionId !== scope.editionId.value) return "excluded";
  const paths = scope.problemIds.state === "known" && scope.problemIds.value.length
    ? scope.problemIds.value.map(id => problemPath(catalog, id))
    : scope.pageIds.state === "known" && scope.pageIds.value.length
      ? scope.pageIds.value.map(id => pagePath(catalog, id))
      : scope.unitId.state === "known" ? [unitPath(catalog, scope.unitId.value)]
        : [scope.editionId.state === "known" ? { editionId: scope.editionId.value } : {}];
  const matches = paths.map(path => matchesPath(path, filter));
  // A catalog ancestor does not verify an observation's missing edition binding.
  if (matches.includes("matched") && scope.editionId.state === "known") return "matched";
  return matches.some(match => match !== "excluded") ? "unresolved" : "excluded";
}
function selectionMatch(entry: LearningEntry, filters: LearningViewFilters, catalog: LearningCatalog): { match: Match; issues: string[] } {
  const { context } = entry;
  if (filters.studentId && context.studentId !== filters.studentId) {
    return { match: "excluded", issues: [] };
  }
  const issues: string[] = [];
  if (context.timeZone !== filters.timeZone) {
    // Incomparable wall-clock dates/times cannot exclude a potentially matching row.
    issues.push("lesson_time_zone_unresolved");
  } else {
    if ((filters.month && !context.lessonDate.startsWith(`${filters.month}-`)) ||
      (filters.weekStart && weekStartForLocalDate(context.lessonDate) !== filters.weekStart) ||
      (filters.date && context.lessonDate !== filters.date)) return { match: "excluded", issues: [] };
    if (filters.lessonTime) {
      if (context.localStartTime.state === "unknown") issues.push("lesson_time_unresolved");
      else if (context.localStartTime.value !== filters.lessonTime) return { match: "excluded", issues: [] };
    }
  }
  const hierarchyMatch = scopeMatch(entry.scope, filters.hierarchy ?? {}, catalog);
  if (hierarchyMatch === "excluded") return { match: "excluded", issues: [] };
  if (hierarchyMatch === "unresolved") issues.push("hierarchy_match_unresolved");
  return { match: issues.length ? "unresolved" : "matched", issues };
}

export function projectLearningView(input: {
  readonly history: readonly LearningRevision[];
  readonly catalog: LearningCatalog;
  readonly filters: LearningViewFilters;
  readonly capturedAt: string;
  readonly sourceCoverage: Knowledge<"complete" | "partial">;
  readonly studentLabels?: readonly { studentId: StudentId; label: string }[];
  /** Explicit caller policy, separate from lesson date and source timestamp. */
  readonly maxSourceAgeMs: number;
}): LearningView {
  validateCatalog(input.catalog);
  validateFilters(input.filters, input.catalog);
  assertInstant(input.capturedAt);
  if (!Number.isSafeInteger(input.maxSourceAgeMs) || input.maxSourceAgeMs < 0) throw new Error("explicit source freshness policy required");
  assertKnowledge(input.sourceCoverage, value => {
    if (!["complete", "partial"].includes(value)) throw new Error("invalid source coverage");
  });
  const studentLabels = input.studentLabels ?? [];
  studentLabels.forEach(row => { requireText(row.studentId, "display student id"); requireText(row.label, "display student label"); });
  if (new Set(studentLabels.map(row => row.studentId)).size !== studentLabels.length) throw new Error("duplicate student display identity");
  const revisions = currentRevisions(input.history);
  const now = Date.parse(input.capturedAt);
  const allRows: LearningViewRow[] = [];
  const fullFreshBoundObservations: SourceObservation[] = [];
  const wholeClass = new Map<StudentId, { studentId: StudentId; sourceCount: number; planCount: number; unresolvedCount: number; staleCount: number }>();
  const { studentId: _selectedStudent, hierarchy: _selectedHierarchy, ...classFilters } = input.filters;
  for (const revision of revisions) {
    if (Date.parse(revision.recordedAt) > now) throw new Error("revision was recorded after projection capture");
    if (revision.payload.kind === "book_assignment") continue;
    const entry = revision.payload;
    validateScope(entry.scope, input.catalog);
    const selection = selectionMatch(entry, input.filters, input.catalog);
    const identity = entry.context.occurrenceId.state === "known" &&
      (entry.kind === "teacher_plan" || entry.exactBinding.state === "known") ? "verified" : "unresolved";
    const freshness = entry.kind === "teacher_plan" ? "not_source" :
      now - Date.parse(entry.provenance.observedAt) <= input.maxSourceAgeMs ? "fresh" : "stale";
    if (entry.kind === "source_observation" && identity === "verified" && freshness === "fresh") fullFreshBoundObservations.push(entry);
    const issues = [...selection.issues];
    if (identity === "unresolved") issues.push("student_lesson_identity_unresolved");
    if (freshness === "stale") issues.push("source_snapshot_stale");
    const period = entry.context.timeZone !== input.filters.timeZone ? "unresolved" : entry.context.lessonDate < input.filters.asOfDate ? "historical" :
      entry.context.lessonDate === input.filters.asOfDate ? "current" : "future";
    if (selection.match !== "excluded") allRows.push({
      entityId: revision.entityId, revisionId: revision.revisionId, recordedAt: revision.recordedAt,
      entry, period, identity, freshness, filterMatch: selection.match, issues,
    });
    const classMatch = selectionMatch(entry, classFilters, input.catalog);
    if (classMatch.match !== "excluded") {
      const summary = wholeClass.get(entry.context.studentId) ?? { studentId: entry.context.studentId, sourceCount: 0, planCount: 0, unresolvedCount: 0, staleCount: 0 };
      if (entry.kind === "source_observation") summary.sourceCount++; else summary.planCount++;
      if (identity === "unresolved" || classMatch.match === "unresolved") summary.unresolvedCount++;
      if (freshness === "stale") summary.staleCount++;
      wholeClass.set(summary.studentId, summary);
    }
  }
  allRows.sort((a, b) => a.entry.context.lessonDate.localeCompare(b.entry.context.lessonDate) ||
    timeOf(a.entry).localeCompare(timeOf(b.entry)) || a.entry.context.studentId.localeCompare(b.entry.context.studentId) || a.entityId.localeCompare(b.entityId));
  const matched = allRows.filter(row => row.filterMatch === "matched");
  const sourceFacts = matched.filter(row => row.entry.kind === "source_observation");
  const teacherPlans = matched.filter(row => row.entry.kind === "teacher_plan");
  const unresolved = allRows.filter(row => row.filterMatch === "unresolved" || row.identity === "unresolved");
  const groupedWeeks = projectLearningWeeks(input.history, {
    asOfDate: input.filters.asOfDate, timeZone: input.filters.timeZone,
    ...(input.filters.month ? { month: input.filters.month } : {}),
    ...(input.filters.weekStart ? { weekStart: input.filters.weekStart } : {}),
    ...(input.filters.date ? { day: input.filters.date } : {}),
    ...(input.filters.lessonTime ? { lessonTime: input.filters.lessonTime } : {}),
    ...(input.filters.studentId ? { studentId: input.filters.studentId } : {}),
    ...(input.filters.hierarchy?.editionId ? { editionId: input.filters.hierarchy.editionId } : {}),
  });
  // The domain owns grouping and week arithmetic. Apply deeper hierarchy selection
  // only to its grouped rows; the complete unresolved queue remains above.
  const matchedEntities = new Set(matched.map(row => row.entityId));
  const weeklyOverview = {
    currentWeekStart: groupedWeeks.currentWeekStart, timeZone: groupedWeeks.timeZone, startsOn: groupedWeeks.startsOn,
    weeks: groupedWeeks.weeks.map(week => ({ ...week,
      lessons: week.lessons.map(lesson => ({ ...lesson,
        editions: lesson.editions.map(edition => ({ ...edition,
          sourceFacts: edition.sourceFacts.filter(row => matchedEntities.has(row.entityId)),
          teacherPlans: edition.teacherPlans.filter(row => matchedEntities.has(row.entityId)),
        })).filter(edition => edition.sourceFacts.length || edition.teacherPlans.length),
      })).filter(lesson => lesson.editions.length),
    })).filter(week => week.lessons.length),
  };
  const periodRows = (period: TemporalPeriod) => ({
    sourceFacts: sourceFacts.filter(row => row.period === period), teacherPlans: teacherPlans.filter(row => row.period === period),
  });
  const comparison = { historical: periodRows("historical"), current: periodRows("current"), future: periodRows("future") };
  const questionAudit = buildQuestionAudit(matched, input.catalog, input.filters.hierarchy ?? {});
  // UI narrowing must not change the meaning of an unchanged whole-plan scope.
  // Reconcile against all current compatible evidence, never the filtered table.
  const planComparisons = teacherPlans.map(row => ({
    entityId: row.entityId, revisionId: row.revisionId,
    result: reconcilePlan(row.entry as Extract<LearningEntry, { kind: "teacher_plan" }>,
      fullFreshBoundObservations.filter(observation => observation.context.timeZone === row.entry.context.timeZone)),
  }));
  const warnings = [
    ...(input.sourceCoverage.state === "unknown" || input.sourceCoverage.value !== "complete" ? ["Source coverage is incomplete or unknown; missing rows do not prove no lesson or no work."] : []),
    ...(unresolved.length ? ["Unresolved identities or filter matches remain visible and require verified joins."] : []),
    ...(sourceFacts.some(row => row.freshness === "stale") ? ["Stale source observations are displayed but excluded from plan reconciliation."] : []),
    "Question evidence is explicit only; page-level completion does not establish each question's grade or correction.",
    "The proposed A:P layout has not changed the operating workbook.",
  ];
  return immutableCopy({
    layoutVersion: LEARNING_VIEW_LAYOUT_VERSION, mode: "read_only_projection", filters: input.filters,
    capturedAt: input.capturedAt, inputDigest: digest(input), sourceCoverage: input.sourceCoverage, catalog: input.catalog, studentLabels, weeklyOverview,
    wholeClass: [...wholeClass.values()].sort((a, b) => a.studentId.localeCompare(b.studentId)),
    sourceFacts, teacherPlans, unresolved, comparison, questionAudit, planComparisons, warnings,
  });
}
function timeOf(entry: LearningEntry): string { return entry.context.localStartTime.state === "known" ? entry.context.localStartTime.value : "99:99"; }
function buildQuestionAudit(rows: readonly LearningViewRow[], catalog: LearningCatalog, hierarchy: HierarchyFilter): QuestionAuditRow[] {
  const grouped = new Map<string, { sample: LearningEntry; problemId: ProblemId; rows: LearningViewRow[] }>();
  for (const row of rows) {
    const ids = row.entry.scope.problemIds;
    const pages = row.entry.scope.pageIds;
    // Expand the catalog for display only; page evidence is not question evidence.
    const pageProblems = pages.state === "known" ? catalog.problems.filter(problem =>
      problem.pageId.state === "known" && pages.value.includes(problem.pageId.value)).map(problem => problem.id) : [];
    const problemIds = new Set([...(ids.state === "known" ? ids.value : []), ...pageProblems]);
    for (const problemId of problemIds) {
      if (matchesPath(problemPath(catalog, problemId), hierarchy) !== "matched") continue;
      // Unknown occurrences are isolated by entity, never coalesced by student/date.
      const occurrence = row.entry.context.occurrenceId;
      const key = canonicalJson([row.entry.context.studentId, row.entry.context.lessonDate,
        occurrence.state === "known" ? occurrence.value : `unresolved:${row.entityId}`, problemId]);
      const group = grouped.get(key) ?? { sample: row.entry, problemId, rows: [] };
      group.rows.push(row); grouped.set(key, group);
    }
  }
  return [...grouped.values()].map(group => {
    const questionEdition = catalog.problems.find(problem => problem.id === group.problemId)!.editionId;
    const directRows = group.rows.filter(row => row.entry.scope.problemIds.state === "known" && row.entry.scope.problemIds.value.includes(group.problemId));
    const evidence: QuestionEvidence[] = directRows.flatMap(row => row.entry.kind !== "source_observation" ? [] : [{
      entityId: row.entityId, revisionId: row.revisionId, source: row.entry.provenance,
      activity: row.entry.activity,
      correctness: row.entry.scope.problemIds.state === "known" && row.entry.scope.problemIds.value.length === 1
        ? row.entry.correctness : unknown("Multi-question observation does not establish per-question correctness"),
      correctionChecked: row.entry.scope.problemIds.state === "known" && row.entry.scope.problemIds.value.length === 1
        ? row.entry.correctionChecked : unknown("Multi-question observation needs per-question correction evidence"),
      identity: row.identity === "verified" && row.entry.scope.editionId.state === "known" && row.entry.scope.editionId.value === questionEdition
        ? "verified" : "unresolved", freshness: row.freshness as "fresh" | "stale",
      teacherInspection: row.entry.activity === "teacher_inspected" && row.entry.correctionChecked.state === "known" && row.entry.correctionChecked.value &&
        row.entry.scope.problemIds.state === "known" && row.entry.scope.problemIds.value.length === 1 &&
        row.entry.scope.editionId.state === "known" && row.entry.scope.editionId.value === questionEdition &&
        row.identity === "verified" && row.freshness === "fresh" ? "correction_checked" as const : "not_established" as const,
    }]);
    return {
      studentId: group.sample.context.studentId, occurrenceId: group.sample.context.occurrenceId, lessonDate: group.sample.context.lessonDate,
      path: resolveProblemPath(catalog, group.problemId), evidence,
      plans: directRows.flatMap(row => row.entry.kind !== "teacher_plan" ? [] : [{ entityId: row.entityId, revisionId: row.revisionId, status: row.entry.status }]),
      contextRevisionIds: group.rows.map(row => row.revisionId),
      status: evidence.length === 0 ? "not_observed" as const : evidence.some(item => item.identity === "unresolved") ? "identity_unresolved" as const :
        evidence.every(item => item.freshness === "stale") ? "stale_evidence" as const : "evidence_present" as const,
    };
  }).sort((a, b) => a.lessonDate.localeCompare(b.lessonDate) || a.studentId.localeCompare(b.studentId) || a.path.problem.id.localeCompare(b.path.problem.id));
}

export interface ViewPageOffsets { readonly wholeClass?: number; readonly sourceFacts?: number; readonly teacherPlans?: number; readonly questionAudit?: number; readonly unresolved?: number }
/** Build from an unfiltered view for the complete supplied-week selector list.
 * Placement remains a separately reviewed Sheet concern; no cell is repurposed.
 */
export function learningWeekSelectorOptions(view: LearningView): readonly { label: string; weekStart: string | null }[] {
  return immutableCopy([
    { label: "전체", weekStart: null },
    ...view.weeklyOverview.weeks.map(week => ({ label: `${week.weekStart}–${week.weekEnd}`, weekStart: week.weekStart })),
  ]);
}
export interface MainSheetProjectionCells {
  readonly cells: readonly LiteralCell[];
  readonly sections: readonly { key: keyof ViewPageOffsets; total: number; offset: number; shown: number; remaining: number }[];
}
/** Complete bounded projection clears obsolete auto-owned cells, never manual selectors or notes. */
export function renderLearningViewCells(view: LearningView, offsets: ViewPageOffsets = {}): MainSheetProjectionCells {
  if (view.layoutVersion !== LEARNING_VIEW_LAYOUT_VERSION || view.mode !== "read_only_projection") throw new Error("unsupported projection version");
  const values = new Map<string, LiteralValue>(LEARNING_VIEW_AUTO_RANGES.flatMap(range => cellsInLearningRange(range).map(cell => [cell, null] as const)));
  const set = (cell: string, value: LiteralValue) => { if (!values.has(cell)) throw new Error("renderer attempted an unowned cell"); values.set(cell, value); };
  const line = (row: number, cells: readonly LiteralValue[]) => cells.forEach((value, column) => set(`${String.fromCharCode(65 + column)}${row}`, value));
  set("A1", "Main Sheet 학습 검토 · 제안"); set("A2", `기준 ${view.filters.asOfDate} · ${view.filters.timeZone} · 조회 ${view.capturedAt}${view.filters.weekStart ? ` · 선택 주 ${view.filters.weekStart}–${localCalendarWeek(view.filters.weekStart).weekEnd}` : ""}`);
  line(3, ["월", null, null, "날짜", null, null, "수업시간", null, null, "학생", null, null, "교재 판본"]);
  line(5, ["대단원", null, null, "중단원", null, null, "소단원", null, null, "쪽", null, null, "문항"]);
  set("A8", `현재 자료 학생 ${view.wholeClass.length} · 원본 ${view.sourceFacts.length} · 계획 ${view.teacherPlans.length} · 미확인 ${view.unresolved.length}`);
  set("A9", view.sourceCoverage.state === "known" ? `원본 범위: ${view.sourceCoverage.value}` : `원본 범위 미확인: ${view.sourceCoverage.reason}`);
  const headers = ["구분", "날짜", "시간", "학생", "출처/작성", "교재 판본", "대단원", "중단원", "소단원", "쪽", "문항", "기록 상태", "정오/교정", "강사검사", "조회/수정시각", "근거/미확인"];
  [33, 55, 77, 119].forEach(row => line(row, headers));
  line(11, ["학생", "원본 기록", "강사 계획", "미확인", "오래된 원본", "학생 ID"]);
  const sections: { key: keyof ViewPageOffsets; total: number; offset: number; shown: number; remaining: number }[] = [];
  function section<T>(key: keyof ViewPageOffsets, data: readonly T[], start: number, capacity: number, cells: (item: T) => readonly LiteralValue[]): void {
    const offset = offsets[key] ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || (offset >= data.length && offset !== 0)) throw new Error("invalid section page offset");
    const page = data.slice(offset, offset + capacity);
    page.forEach((item, index) => line(start + index, cells(item)));
    sections.push({ key, total: data.length, offset, shown: page.length, remaining: Math.max(0, data.length - offset - page.length) });
  }
  section("wholeClass", view.wholeClass, 12, 20, row => [studentLabel(view, row.studentId), row.sourceCount, row.planCount, row.unresolvedCount, row.staleCount, row.studentId]);
  section("sourceFacts", view.sourceFacts, 34, 20, row => displayEntry(row, view));
  section("teacherPlans", view.teacherPlans, 56, 20, row => displayEntry(row, view));
  section("questionAudit", view.questionAudit, 78, 40, row => [
    "문항 감사", row.lessonDate, null, studentLabel(view, row.studentId), row.evidence.map(item => item.source.system).join(", ") || "문항 근거 미확인",
    view.catalog.editions.find(item => item.id === row.path.editionId)!.title, row.path.major?.title ?? "미확인", row.path.middle?.title ?? "미확인", row.path.minor?.title ?? "미확인",
    row.path.page?.printedLabel ?? "미확인", row.path.problem.printedLabel, row.status,
    row.evidence.map(item => `${knowledgeText(item.correctness)} / ${knowledgeText(item.correctionChecked)}`).join("; ") || "미확인",
    row.evidence.map(item => item.teacherInspection).join("; ") || "미확인",
    row.evidence.map(item => item.source.observedAt).join("; "),
    [...row.evidence.map(item => item.revisionId), ...row.plans.map(item => `${item.revisionId}:${item.status}`)].join("; "),
  ]);
  section("unresolved", view.unresolved, 120, 20, row => displayEntry(row, view));
  set("A141", "강사 고정 입력 · 명시적 기록 동작 필요");
  set("A142", "학생·수업 발생 ID·날짜·판본을 확인한 뒤 기록. 이 미리보기는 입력을 저장하지 않습니다.");
  sections.forEach((item, index) => set(`A${148 + index}`, `${item.key}: ${item.offset + (item.shown ? 1 : 0)}–${item.offset + item.shown} / ${item.total} · 다음 ${item.remaining}`));
  view.warnings.slice(0, 8).forEach((warning, index) => set(`A${153 + index}`, warning));
  return immutableCopy({ cells: [...values].map(([cell, value]) => ({ cell, value, valueKind: "literal" as const })), sections });
}
function knowledgeText(value: Knowledge<unknown>): string { return value.state === "known" ? String(value.value) : `미확인: ${value.reason}`; }
function studentLabel(view: LearningView, id: StudentId): string { return view.studentLabels.find(row => row.studentId === id)?.label ?? id; }
function displayEntry(row: LearningViewRow, view: LearningView): readonly LiteralValue[] {
  const entry = row.entry;
  const scope = entry.scope;
  const paths = [
    ...(scope.problemIds.state === "known" ? scope.problemIds.value.map(id => problemPath(view.catalog, id)) : []),
    ...(scope.pageIds.state === "known" ? scope.pageIds.value.map(id => pagePath(view.catalog, id)) : []),
    ...(scope.unitId.state === "known" ? [unitPath(view.catalog, scope.unitId.value)] : []),
  ];
  const unitLabel = (level: "majorUnitId" | "middleUnitId" | "minorUnitId") => {
    const ids = [...new Set(paths.map(path => path[level]).filter(Boolean))];
    return ids.map(id => view.catalog.units.find(unit => unit.id === id)!.title).join(", ") || "미확인";
  };
  const editionId = scope.editionId.state === "known" ? scope.editionId.value : null;
  const bookLabel = editionId ? view.catalog.editions.find(book => book.id === editionId)!.title : knowledgeText(scope.editionId);
  const reconciliation = view.planComparisons.find(item => item.entityId === row.entityId)?.result;
  return [
    row.period, entry.context.lessonDate, knowledgeText(entry.context.localStartTime), studentLabel(view, entry.context.studentId),
    entry.kind === "source_observation" ? `${entry.provenance.system}:${entry.sessionKind}` : `teacher:${entry.horizon}`,
    bookLabel, unitLabel("majorUnitId"), unitLabel("middleUnitId"), unitLabel("minorUnitId"),
    scope.pageIds.state === "known" ? scope.pageIds.value.map(id => view.catalog.pages.find(page => page.id === id)!.printedLabel).join(", ") : knowledgeText(scope.pageIds),
    scope.problemIds.state === "known" ? scope.problemIds.value.map(id => view.catalog.problems.find(problem => problem.id === id)!.printedLabel).join(", ") : knowledgeText(scope.problemIds),
    entry.kind === "teacher_plan" ? `${entry.purpose}:${entry.status} · ${reconciliation?.coverage ?? "unknown"}` : `${entry.activity}:${knowledgeText(entry.attendance)}`,
    entry.kind === "teacher_plan" ? "계획" : `${knowledgeText(entry.correctness)} / ${knowledgeText(entry.correctionChecked)}`,
    entry.kind === "source_observation" && entry.activity === "teacher_inspected" ? `강사관찰 · ${row.identity} · ${row.freshness}` : "미확인",
    entry.kind === "source_observation" ? entry.provenance.observedAt : row.recordedAt,
    `${row.revisionId}${row.issues.length ? ` · ${row.issues.join(", ")}` : ""}`,
  ];
}
