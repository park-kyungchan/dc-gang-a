import {
  assertDate, canonicalJson, immutableCopy,
  type EditionId, type EntityId, type Knowledge, type LearningEntry,
  type RevisionId, type StudentId,
} from "./model";
import { assertLearningTimeZone, localCalendarWeek, weekStartForLocalDate } from "./calendar";
import { selectLearningEntries, type LearningFilter, type LearningFilterIssue } from "./reconciliation";
import { currentRevisions, type LearningRevision } from "./revisions";

export interface WeeklyLearningRow {
  readonly entityId: EntityId;
  readonly revisionId: RevisionId;
  readonly recordedAt: string;
  readonly entry: LearningEntry;
}
export interface WeeklyEditionGroup {
  readonly editionKey: string;
  readonly editionId: Knowledge<EditionId>;
  readonly sourceFacts: readonly WeeklyLearningRow[];
  readonly teacherPlans: readonly WeeklyLearningRow[];
}
export interface WeeklyLessonGroup {
  readonly lessonKey: string;
  readonly studentId: StudentId;
  readonly lessonDate: string;
  /** Planning compatibility lane, not an assertion that a planned lesson happened. */
  readonly sessionKind: "lesson" | "makeup";
  readonly occurrenceId: Knowledge<string>;
  /** Unverified source joins stay isolated by entity, even with a known-looking occurrence ID. */
  readonly binding: "explicit_occurrence" | "unresolved_source_or_occurrence";
  readonly editions: readonly WeeklyEditionGroup[];
}
export interface LearningWeekGroup {
  readonly weekKey: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly startsOn: "monday";
  readonly timeZone: string;
  /** Calendar position only. This is never completion, attendance, or a plan-status transition. */
  readonly period: "historical" | "current" | "future";
  readonly lessons: readonly WeeklyLessonGroup[];
}
export interface WeeklyLearningProjection {
  readonly asOfDate: string;
  readonly timeZone: string;
  readonly currentWeekStart: string;
  readonly startsOn: "monday";
  readonly weeks: readonly LearningWeekGroup[];
  /** Foreign-zone or unknown filter matches receive no guessed week or temporal period. */
  readonly unresolved: readonly (WeeklyLearningRow & { readonly issues: readonly LearningFilterIssue[] })[];
}
export interface WeeklyLearningQuery extends LearningFilter {
  readonly asOfDate: string;
  readonly timeZone: string;
}

/**
 * Latest audit envelopes grouped week -> exact lesson -> textbook edition.
 * Original ContentScope IDs remain the bridge into the shared major/middle/minor,
 * page and question catalog. No source fact or teacher plan is flattened away.
 */
export function projectLearningWeeks(history: readonly LearningRevision[], query: WeeklyLearningQuery): WeeklyLearningProjection {
  assertDate(query.asOfDate);
  assertLearningTimeZone(query.timeZone);
  const { asOfDate, ...filter } = query;
  selectLearningEntries([], filter); // Validate empty queries and Monday selectors too.
  const currentWeekStart = weekStartForLocalDate(asOfDate);
  const unresolved: Array<WeeklyLearningRow & { issues: readonly LearningFilterIssue[] }> = [];
  type MutableEdition = { editionKey: string; editionId: Knowledge<EditionId>; sourceFacts: WeeklyLearningRow[]; teacherPlans: WeeklyLearningRow[] };
  type MutableLesson = Omit<WeeklyLessonGroup, "editions"> & { editions: Map<string, MutableEdition> };
  type MutableWeek = Omit<LearningWeekGroup, "lessons"> & { lessons: Map<string, MutableLesson> };
  const weeks = new Map<string, MutableWeek>();
  for (const revision of currentRevisions(history)) {
    if (revision.payload.kind === "book_assignment") continue;
    const entry = revision.payload;
    const row: WeeklyLearningRow = { entityId: revision.entityId, revisionId: revision.revisionId, recordedAt: revision.recordedAt, entry };
    const selection = selectLearningEntries([entry], filter);
    if (selection.unresolved.length) {
      unresolved.push({ ...row, issues: selection.unresolved[0]!.issues });
      continue;
    }
    if (!selection.matched.length) continue;
    const localWeek = localCalendarWeek(entry.context.lessonDate);
    const weekKey = canonicalJson([query.timeZone, localWeek.weekStart]);
    const week = weeks.get(weekKey) ?? {
      ...localWeek, weekKey, timeZone: query.timeZone,
      period: localWeek.weekStart < currentWeekStart ? "historical" : localWeek.weekStart === currentWeekStart ? "current" : "future",
      lessons: new Map<string, MutableLesson>(),
    } satisfies MutableWeek;
    weeks.set(weekKey, week);
    const occurrence = entry.context.occurrenceId;
    const sessionKind = entry.kind === "source_observation" ? entry.sessionKind : entry.purpose === "makeup" ? "makeup" : "lesson";
    const exact = occurrence.state === "known" && (entry.kind === "teacher_plan" || entry.exactBinding.state === "known");
    const lessonKey = canonicalJson([weekKey, entry.context.studentId, entry.context.lessonDate, sessionKind,
      exact && occurrence.state === "known" ? ["occurrence", occurrence.value] : ["unresolved", revision.entityId]]);
    const lesson = week.lessons.get(lessonKey) ?? {
      lessonKey, studentId: entry.context.studentId, lessonDate: entry.context.lessonDate, sessionKind,
      occurrenceId: occurrence, binding: exact ? "explicit_occurrence" : "unresolved_source_or_occurrence",
      editions: new Map<string, MutableEdition>(),
    } satisfies MutableLesson;
    week.lessons.set(lessonKey, lesson);
    const editionId = entry.scope.editionId;
    const editionKey = canonicalJson([lessonKey, editionId.state === "known" ? ["edition", editionId.value] : ["unresolved", revision.entityId]]);
    const edition = lesson.editions.get(editionKey) ?? { editionKey, editionId, sourceFacts: [], teacherPlans: [] } satisfies MutableEdition;
    lesson.editions.set(editionKey, edition);
    if (entry.kind === "source_observation") edition.sourceFacts.push(row); else edition.teacherPlans.push(row);
  }
  // Opaque keys use code-point order, independent of host locale or ICU collation.
  const compareKeys = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  const sortRows = (a: WeeklyLearningRow, b: WeeklyLearningRow) => compareKeys(a.entityId, b.entityId);
  return immutableCopy({
    asOfDate, timeZone: query.timeZone, currentWeekStart, startsOn: "monday",
    weeks: [...weeks.values()].sort((a, b) => compareKeys(a.weekStart, b.weekStart)).map(week => ({
      ...week,
      lessons: [...week.lessons.values()].sort((a, b) => compareKeys(a.lessonDate, b.lessonDate) || compareKeys(a.studentId, b.studentId) || compareKeys(a.lessonKey, b.lessonKey))
        .map(lesson => ({
          ...lesson,
          editions: [...lesson.editions.values()].sort((a, b) => compareKeys(a.editionKey, b.editionKey)).map(edition => ({
            ...edition, sourceFacts: edition.sourceFacts.sort(sortRows), teacherPlans: edition.teacherPlans.sort(sortRows),
          })),
        })),
    })),
    unresolved: unresolved.sort(sortRows),
  });
}
