import {
  assertDate, assertTime, immutableCopy, requireText, validateRecord,
  type ContentScope, type EditionId, type LearningEntry, type SourceObservation, type StudentId, type TeacherPlan,
} from "./model";
import { currentRevisions, type LearningRevision } from "./revisions";
import { assertLearningTimeZone, assertWeekStart, weekStartForLocalDate } from "./calendar";

export interface LearningFilter {
  readonly month?: string;
  /** Monday date in the lesson's local calendar; independent of ISO week-year numbering. */
  readonly weekStart?: string;
  readonly day?: string;
  /** When provided, foreign-zone rows remain unresolved rather than being converted or dropped. */
  readonly timeZone?: string;
  readonly lessonTime?: string;
  readonly studentId?: StudentId;
  readonly editionId?: EditionId;
}

export type LearningFilterIssue = "lesson_time_zone_unresolved" | "lesson_time_unresolved" | "edition_filter_unresolved";
export interface LearningSelection<T extends LearningEntry> {
  readonly matched: readonly T[];
  readonly unresolved: readonly { entry: T; issues: readonly LearningFilterIssue[] }[];
}

/** AND filters use lesson-local fields. Unknown matches are retained separately. */
export function selectLearningEntries<T extends LearningEntry>(entries: readonly T[], filter: LearningFilter): LearningSelection<T> {
  if (filter.month !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(filter.month)) throw new Error("invalid month filter");
  if (filter.weekStart !== undefined) assertWeekStart(filter.weekStart);
  if (filter.day !== undefined) assertDate(filter.day);
  if (filter.timeZone !== undefined) assertLearningTimeZone(filter.timeZone);
  if (filter.lessonTime !== undefined) assertTime(filter.lessonTime);
  if (filter.studentId !== undefined) requireText(filter.studentId, "student filter");
  if (filter.editionId !== undefined) requireText(filter.editionId, "edition filter");
  for (const entry of entries) validateRecord(entry);
  const matched: T[] = [];
  const unresolved: Array<{ entry: T; issues: LearningFilterIssue[] }> = [];
  for (const entry of entries) {
    const { context, scope } = entry;
    if (filter.studentId !== undefined && context.studentId !== filter.studentId) continue;
    if (filter.editionId !== undefined && scope.editionId.state === "known" && scope.editionId.value !== filter.editionId) continue;
    const issues: LearningFilterIssue[] = [];
    if (filter.editionId !== undefined && scope.editionId.state === "unknown") issues.push("edition_filter_unresolved");
    if (filter.timeZone !== undefined && context.timeZone !== filter.timeZone) {
      // Calendar and wall-clock comparisons are not meaningful across unconverted zones.
      // Keep this candidate even when its foreign local date lies outside the requested week.
      issues.push("lesson_time_zone_unresolved");
    } else {
      if ((filter.month !== undefined && !context.lessonDate.startsWith(`${filter.month}-`)) ||
        (filter.weekStart !== undefined && weekStartForLocalDate(context.lessonDate) !== filter.weekStart) ||
        (filter.day !== undefined && context.lessonDate !== filter.day)) continue;
      if (filter.lessonTime !== undefined) {
        if (context.localStartTime.state === "unknown") issues.push("lesson_time_unresolved");
        else if (context.localStartTime.value !== filter.lessonTime) continue;
      }
    }
    if (issues.length) unresolved.push({ entry, issues }); else matched.push(entry);
  }
  return immutableCopy({ matched, unresolved });
}

/** Compatibility wrapper: exact matches only. Use selectLearningEntries to retain unresolved rows. */
export function filterLearningEntries<T extends LearningEntry>(entries: readonly T[], filter: LearningFilter): readonly T[] {
  return selectLearningEntries(entries, filter).matched;
}

export function projectLearningTimeline(history: readonly LearningRevision[], filter: LearningFilter = {}) {
  const revisions = currentRevisions(history).filter(row => row.payload.kind !== "book_assignment");
  // Keep the envelope paired with its entity even when two payloads are identical.
  filterLearningEntries([], filter);
  return immutableCopy(revisions.filter(row => filterLearningEntries([row.payload as LearningEntry], filter).length > 0)
    .map(row => ({
    revisionId: row.revisionId,
    entityId: row.entityId,
    entry: row.payload as LearningEntry,
  })).sort((a, b) =>
    a.entry.context.lessonDate.localeCompare(b.entry.context.lessonDate) ||
    timeOf(a.entry).localeCompare(timeOf(b.entry)) || a.entityId.localeCompare(b.entityId)));
}

export interface Reconciliation {
  readonly coverage: "unknown" | "not_observed" | "partially_observed" | "fully_observed" | "conflict";
  readonly completion: "not_established" | "reported_only" | "teacher_inspected";
  readonly plannedTargets: readonly string[];
  /** Absence of evidence is not proof that work was not done. */
  readonly notObservedTargets: readonly string[];
  readonly extraObservedTargets: readonly string[];
  readonly matchedObservationIndexes: readonly number[];
  readonly excludedObservationIndexes: readonly number[];
  readonly reason: string;
}

/** Does not compute correctness, mastery, pace or official attendance from a plan. */
export function reconcilePlan(plan: TeacherPlan, observations: readonly SourceObservation[]): Reconciliation {
  validateRecord(plan);
  observations.forEach(validateRecord);
  const targets = concreteTargets(plan.scope);
  const empty = (reason: string): Reconciliation => immutableCopy({
    coverage: "unknown", completion: "not_established", plannedTargets: targets.keys,
    notObservedTargets: targets.keys, extraObservedTargets: [], matchedObservationIndexes: [],
    excludedObservationIndexes: observations.map((_, i) => i), reason,
  });
  if (plan.status !== "approved") return empty("Only an approved teacher plan can be reconciled; it is still not a source fact.");
  if (plan.context.occurrenceId.state !== "known" || plan.scope.editionId.state !== "known" || targets.kind === "unknown") {
    return empty("Exact lesson occurrence, edition, and explicit page or problem targets are required.");
  }
  const occurrenceId = plan.context.occurrenceId.value;
  const editionId = plan.scope.editionId.value;
  const matched: number[] = [];
  const excluded: number[] = [];
  observations.forEach((observation, index) => {
    const exact = observation.exactBinding.state === "known" && observation.context.occurrenceId.state === "known" &&
      observation.context.studentId === plan.context.studentId && observation.context.lessonDate === plan.context.lessonDate &&
      observation.context.occurrenceId.value === occurrenceId && observation.scope.editionId.state === "known" &&
      observation.scope.editionId.value === editionId &&
      observation.sessionKind === (plan.purpose === "makeup" ? "makeup" : "lesson");
    (exact ? matched : excluded).push(index);
  });
  const covered = new Set<string>();
  const reported = new Set<string>();
  const inspected = new Set<string>();
  const attendance = new Set<string>();
  for (const index of matched) {
    const observation = observations[index];
    if (observation.attendance.state === "known") attendance.add(observation.attendance.value);
    // Resolve the observation independently: a question's page is context, not
    // evidence that every question on that page was observed or inspected.
    const actual = concreteTargets(observation.scope);
    if (observation.activity === "assigned") continue; // Assigned is not attempted work.
    for (const key of actual.keys) {
      covered.add(key);
      if (observation.activity === "reported_complete" || observation.activity === "teacher_inspected") reported.add(key);
      if (observation.activity === "teacher_inspected" && observation.correctionChecked.state === "known" &&
        observation.correctionChecked.value &&
        // One scalar correction flag cannot certify each item in a question set.
        (actual.kind !== "problem" || actual.keys.length === 1)) inspected.add(key);
    }
  }
  const missing = targets.keys.filter(key => !covered.has(key));
  const conflicting = attendance.size > 1 || (covered.size > 0 && (attendance.has("cancelled") || attendance.has("absent")));
  return immutableCopy({
    coverage: conflicting ? "conflict" : missing.length === 0 ? "fully_observed" :
      missing.length === targets.keys.length ? "not_observed" : "partially_observed",
    completion: conflicting ? "not_established" : targets.keys.every(key => inspected.has(key)) ? "teacher_inspected" :
      targets.keys.every(key => reported.has(key)) ? "reported_only" : "not_established",
    plannedTargets: targets.keys, notObservedTargets: missing,
    extraObservedTargets: [...covered].filter(key => !targets.keys.includes(key)).sort(),
    matchedObservationIndexes: matched, excludedObservationIndexes: excluded,
    reason: conflicting ? "Conflicting attendance/work evidence requires review; no source wins implicitly." :
      "Coverage describes supplied evidence only. Missing work, correctness, and mastery are not inferred.",
  });
}

function timeOf(entry: LearningEntry): string { return entry.context.localStartTime.state === "known" ? entry.context.localStartTime.value : "99:99"; }
function concreteTargets(scope: ContentScope) {
  if (scope.problemIds.state === "known" && scope.problemIds.value.length) {
    return { kind: "problem" as const, keys: scope.problemIds.value.map(id => `problem:${id}`) };
  }
  if (scope.pageIds.state === "known" && scope.pageIds.value.length) {
    return { kind: "page" as const, keys: scope.pageIds.value.map(id => `page:${id}`) };
  }
  return { kind: "unknown" as const, keys: [] as string[] };
}
