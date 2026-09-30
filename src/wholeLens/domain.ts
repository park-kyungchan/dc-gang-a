/**
 * Small, pure TypeScript port of the date-first class-summary contract from
 * workbench_v2/class_overview.py. Inputs are already reviewed reads. This
 * module performs no LMS, Sheet, SPT, credential, filesystem, or network I/O.
 *
 * `observedCount` counts supplied roster rows; it does not certify all students
 * or groups were returned. A caller must supply independently verified
 * coverage. Missing coverage and app evidence remain unknown.
 */

export const Source = {
  LMS_ROSTER: "lms_roster",
  LMS_DAY_RECORD: "lms_day_record",
  LMS_COURSE: "lms_course",
  PRESTUDY_APP: "prestudy_app",
} as const;
export type Source = (typeof Source)[keyof typeof Source];

export const FactState = { KNOWN: "known", UNKNOWN: "unknown", STALE: "stale" } as const;
export type FactState = (typeof FactState)[keyof typeof FactState];

export type Fact<T> =
  | Readonly<{ state: typeof FactState.KNOWN; source: Source; value: T; observedAt: Instant }>
  | Readonly<{ state: typeof FactState.UNKNOWN | typeof FactState.STALE; source: Source; reason: string; observedAt?: Instant }>;

export type LessonDate = string;
export type Instant = string;
/** Positive age bound in microseconds, matching Python timedelta precision. */
export type MaxAgeMicros = bigint;

export class JoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JoinError";
  }
}

export function factKnown<T>(value: T, source: Source, observedAt: Instant): Fact<T> {
  assertSource(source);
  instantMicros(observedAt, "observedAt");
  if (value === null || value === undefined) throw new TypeError("known facts need a value and observedAt");
  return Object.freeze({ state: FactState.KNOWN, source, value, observedAt });
}

export function factUnknown<T>(source: Source, reason = "not observed"): Fact<T> {
  assertSource(source);
  if (!reason) throw new TypeError("unknown/stale facts need a reason");
  return Object.freeze({ state: FactState.UNKNOWN, source, reason });
}

export const DayRecordField = {
  ATTENDANCE: "attendance",
  DAILY_TEST: "daily_test",
  PROGRESS: "progress",
  HOMEWORK: "homework",
  MEMO: "memo",
  HOMEWORK_RATE: "homework_rate",
  STUDENT_MEMO: "student_memo",
  UNIT_SELECTION: "unit_selection",
} as const;
export type DayRecordField = (typeof DayRecordField)[keyof typeof DayRecordField];
export const DAY_RECORD_FIELDS = Object.freeze(Object.values(DayRecordField)) as readonly DayRecordField[];

export const APP_FIELDS = Object.freeze([
  "video_uploaded",
  "video_teacher_checked",
  "required_examples_assigned",
  "required_examples_submitted",
  "required_examples_auto_graded",
  "required_examples_corrected",
  "type_practice_assigned",
  "type_practice_submitted",
  "type_practice_auto_graded",
  "type_practice_corrected",
  "teacher_follow_up",
] as const);
export type AppField = (typeof APP_FIELDS)[number];

export type LessonKey = Readonly<{
  lessonDate: LessonDate;
  occurrenceId: string;
  studentId: string;
}>;
export type RosterEntry = Readonly<{
  key: LessonKey;
  groupId: string;
  schoolGrade: Fact<string>;
  observedAt: Instant;
}>;
export type DayRecordSnapshot = Readonly<{
  key: LessonKey;
  courseId: string;
  recordSeq: string;
  cmSeq: string;
  fields: Readonly<Partial<Record<DayRecordField, Fact<unknown>>>>;
  observedAt: Instant;
}>;
export type CourseAssignment = Readonly<{
  key: LessonKey;
  courseId: string;
  book: Fact<string>;
  version: Fact<string>;
  unit: Fact<string>;
  effectiveFrom: LessonDate;
  effectiveUntil?: LessonDate | null;
  observedAt: Instant;
}>;
export type AppPreparation = Readonly<{
  key: LessonKey;
  courseId: string;
  joinVerified: boolean;
  fields: Readonly<Record<string, Fact<unknown>>>;
  observedAt: Instant;
}>;

export const SelectionState = {
  NONE: "none",
  IN_SCOPE: "in_scope",
  OUT_OF_GROUP: "out_of_group",
  NOT_IN_LESSON: "not_in_lesson",
} as const;
export type SelectionState = (typeof SelectionState)[keyof typeof SelectionState];

export type PreparationRow = Readonly<{
  key: LessonKey;
  groupId: string;
  schoolGrade: Fact<string>;
  book: Fact<string>;
  courseVersion: Fact<string>;
  unit: Fact<string>;
  preparation: Readonly<Record<AppField, Fact<unknown>>>;
}>;

export type ClassOverview = Readonly<{
  lessonDate: LessonDate;
  occurrenceId: string;
  groupFilter: string | null;
  /** Supplied row count only; this is not a complete-roster claim. */
  observedCount: number;
  coverage: Fact<boolean>;
  rows: readonly PreparationRow[];
  selectionState: SelectionState;
  /** Set only for an in-scope selection; detail projection is a later slice. */
  selectedStudentId: string | null;
}>;

export function projectClassOverview(input: {
  lessonDate: LessonDate;
  occurrenceId: string;
  groupFilter: string | null;
  selectedStudentId: string | null;
  asOf: Instant;
  maxAgeMicros: MaxAgeMicros;
  roster: readonly RosterEntry[];
  dayRecords: readonly DayRecordSnapshot[];
  courses?: readonly CourseAssignment[];
  appPreparation?: readonly AppPreparation[];
  coverage?: Fact<boolean> | null;
}): ClassOverview {
  const {
    lessonDate, occurrenceId, groupFilter, selectedStudentId, asOf, maxAgeMicros,
    roster, dayRecords, courses = [], appPreparation = [], coverage: suppliedCoverage,
  } = input;

  assertDate(lessonDate, "lessonDate");
  assertId(occurrenceId, "occurrence_id");
  instantMicros(asOf, "as_of");
  assertMaxAge(maxAgeMicros);
  assertGroupFilter(groupFilter);
  if (roster.length > 50 || dayRecords.length > 50) {
    throw new JoinError("lesson read exceeds bounded class size");
  }
  for (const [label, batch] of [["roster", roster], ["DayRecord", dayRecords],
    ["course", courses], ["app", appPreparation]] as const) {
    if (batch.some((row) => row.key.lessonDate !== lessonDate || row.key.occurrenceId !== occurrenceId)) {
      throw new JoinError(`${label} contains a foreign lesson occurrence`);
    }
  }
  assertUnique(roster.map((row) => keyToken(row.key)), "duplicate lesson roster entry");
  if (roster.some((row) => row.groupId === "0")) {
    throw new JoinError("all-groups is a filter, not a student's group");
  }

  const initialCoverage = suppliedCoverage ??
    factUnknown<boolean>(Source.LMS_DAY_RECORD, "date/group row coverage not verified");
  assertFact(initialCoverage);
  if (initialCoverage.source !== Source.LMS_DAY_RECORD) throw new JoinError("coverage has the wrong source");
  const coverage = factAt(initialCoverage, asOf, maxAgeMicros);

  const visible = roster.filter((row) =>
    groupFilter === null || groupFilter === "0" || row.groupId === groupFilter);
  const rows = visible.map((member) => projectPreparationRow({
    member, lessonDate, occurrenceId, groupFilter, asOf, maxAgeMicros,
    roster, dayRecords, courses, appPreparation,
  }));

  let selectionState: SelectionState = SelectionState.NONE;
  let scopedStudentId: string | null = null;
  if (selectedStudentId !== null) {
    assertId(selectedStudentId, "student_id");
    const selectedKey = { lessonDate, occurrenceId, studentId: selectedStudentId };
    if (!roster.some((row) => sameKey(row.key, selectedKey))) {
      selectionState = SelectionState.NOT_IN_LESSON;
    } else if (!visible.some((row) => sameKey(row.key, selectedKey))) {
      selectionState = SelectionState.OUT_OF_GROUP;
    } else {
      selectionState = SelectionState.IN_SCOPE;
      scopedStudentId = selectedStudentId;
    }
  }

  return Object.freeze({
    lessonDate, occurrenceId, groupFilter, observedCount: rows.length, coverage,
    rows: Object.freeze(rows), selectionState, selectedStudentId: scopedStudentId,
  });
}

function projectPreparationRow(input: {
  member: RosterEntry;
  lessonDate: LessonDate;
  occurrenceId: string;
  groupFilter: string | null;
  asOf: Instant;
  maxAgeMicros: MaxAgeMicros;
  roster: readonly RosterEntry[];
  dayRecords: readonly DayRecordSnapshot[];
  courses: readonly CourseAssignment[];
  appPreparation: readonly AppPreparation[];
}): PreparationRow {
  const { member, lessonDate, occurrenceId, groupFilter, asOf, maxAgeMicros,
    roster, dayRecords, courses, appPreparation } = input;
  assertKey(member.key);
  assertId(member.groupId, "group_id");
  if (member.groupId === "0") throw new JoinError("all-groups is a filter, not a student's group");
  if (groupFilter !== null && groupFilter !== "0" && member.groupId !== groupFilter) {
    throw new JoinError("selected student is outside the selected group");
  }
  assertCurrent(member.observedAt, asOf, maxAgeMicros, "roster");
  assertFactSource(member.schoolGrade, Source.LMS_ROSTER, "school grade");

  const day = one(dayRecords, member.key, "DayRecord row");
  if (!day) throw new JoinError("selected student has no verified DayRecord row");
  assertCurrent(day.observedAt, asOf, maxAgeMicros, "DayRecord");
  assertId(day.courseId, "course_id");
  assertId(day.recordSeq, "record_seq");
  assertId(day.cmSeq, "cm_seq");
  assertExactKeys(day.fields, DAY_RECORD_FIELDS, "DayRecord must carry exactly the eight authorized fields");
  for (const field of DAY_RECORD_FIELDS) {
    assertFactSource(day.fields[field]!, Source.LMS_DAY_RECORD, field);
  }

  const course = one(courses, member.key, "course assignment");
  let book: Fact<string> = factUnknown(Source.LMS_COURSE, "course assignment not verified");
  let version: Fact<string> = factUnknown(Source.LMS_COURSE, "course assignment not verified");
  let unit: Fact<string> = factUnknown(Source.LMS_COURSE, "course assignment not verified");
  if (course) {
    assertCurrent(course.observedAt, asOf, maxAgeMicros, "course");
    assertDate(course.effectiveFrom, "course.effectiveFrom");
    if (course.effectiveUntil != null) assertDate(course.effectiveUntil, "course.effectiveUntil");
    if (course.courseId !== day.courseId || course.effectiveFrom > lessonDate ||
        (course.effectiveUntil != null && lessonDate > course.effectiveUntil)) {
      throw new JoinError("course ID or effective date does not match selected DayRecord");
    }
    assertFactSource(course.book, Source.LMS_COURSE, "book");
    assertFactSource(course.version, Source.LMS_COURSE, "version");
    assertFactSource(course.unit, Source.LMS_COURSE, "unit");
    book = factAt(course.book, asOf, maxAgeMicros);
    version = factAt(course.version, asOf, maxAgeMicros);
    unit = factAt(course.unit, asOf, maxAgeMicros);
  }

  const app = one(appPreparation, member.key, "app preparation");
  if (app) {
    assertCurrent(app.observedAt, asOf, maxAgeMicros, "app preparation");
    if (!app.joinVerified || app.courseId !== day.courseId) {
      throw new JoinError("app student/course join is unverified or foreign");
    }
    for (const [field, fact] of Object.entries(app.fields)) {
      if (!(APP_FIELDS as readonly string[]).includes(field)) throw new JoinError("unexpected app preparation field");
      assertFactSource(fact, Source.PRESTUDY_APP, field);
    }
  }
  const preparation = Object.fromEntries(APP_FIELDS.map((field) => {
    const fact = app?.fields[field];
    return [field, fact ? factAt(fact, asOf, maxAgeMicros)
      : factUnknown(Source.PRESTUDY_APP, "selected-student app read unavailable")];
  })) as Record<AppField, Fact<unknown>>;

  return Object.freeze({
    key: member.key,
    groupId: member.groupId,
    schoolGrade: factAt(member.schoolGrade, asOf, maxAgeMicros),
    book,
    courseVersion: version,
    unit,
    preparation: Object.freeze(preparation),
  });
}

function assertMaxAge(value: MaxAgeMicros): void {
  if (typeof value !== "bigint" || value <= 0n) throw new TypeError("max_age must be positive");
}

function assertGroupFilter(value: string | null): void {
  if (value !== null && value !== "0") assertId(value, "group_filter");
}

function assertKey(key: LessonKey): void {
  assertDate(key.lessonDate, "lesson_date");
  assertId(key.occurrenceId, "occurrence_id");
  assertId(key.studentId, "student_id");
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a nonempty opaque ID`);
  }
}

function assertDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError(`${label} must be an ISO calendar date`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) throw new TypeError(`${label} is invalid`);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError(`${label} is invalid`);
  }
}

function instantMicros(value: string, label = "timestamp"): bigint {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) throw new TypeError(`${label} must include a timezone offset`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = "", zone] = match;
  assertDate(`${yearText}-${monthText}-${dayText}`, label);
  const local = new Date(0);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  local.setUTCHours(Number(hourText), Number(minuteText), Number(secondText), 0);
  const fractionMicros = BigInt(fractionText.padEnd(6, "0") || "0");
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const sign = zone[0] === "+" ? 1 : -1;
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  }
  return BigInt(local.getTime()) * 1000n + fractionMicros - BigInt(offsetMinutes) * 60_000_000n;
}

function assertSource(value: unknown): asserts value is Source {
  if (!Object.values(Source).includes(value as Source)) throw new TypeError("unknown fact source");
}

function assertFact<T>(fact: Fact<T>): void {
  if (!fact || typeof fact !== "object") throw new TypeError("fact must be an object");
  assertSource(fact.source);
  if (fact.state === FactState.KNOWN) {
    if (fact.value === null || fact.value === undefined || fact.observedAt == null) {
      throw new TypeError("known facts need a value and observedAt");
    }
    instantMicros(fact.observedAt, "observed_at");
  } else if (fact.state === FactState.UNKNOWN || fact.state === FactState.STALE) {
    if ((fact as { value?: unknown }).value != null || !fact.reason) {
      throw new TypeError("unknown/stale facts need a reason and cannot expose a value");
    }
    if (fact.observedAt != null) instantMicros(fact.observedAt, "observed_at");
  } else {
    throw new TypeError("unknown fact state");
  }
}

function factAt<T>(fact: Fact<T>, asOf: Instant, maxAgeMicros: MaxAgeMicros): Fact<T> {
  assertFact(fact);
  const reference = instantMicros(asOf, "as_of");
  if (fact.observedAt != null) {
    const observed = instantMicros(fact.observedAt, "observed_at");
    if (observed > reference) throw new JoinError("source observation is later than projection time");
    if (fact.state === FactState.KNOWN && reference - observed > maxAgeMicros) {
      return Object.freeze({ state: FactState.STALE, source: fact.source,
        observedAt: fact.observedAt, reason: "source value older than max_age" });
    }
  }
  return fact;
}

function assertFactSource<T>(fact: Fact<T>, expected: Source, label: string): void {
  assertFact(fact);
  if (fact.source !== expected) throw new JoinError(`${label} has the wrong source`);
}

function assertCurrent(observedAt: Instant, asOf: Instant, maxAgeMicros: MaxAgeMicros, label: string): void {
  const observed = instantMicros(observedAt, `${label}.observed_at`);
  const reference = instantMicros(asOf, "as_of");
  if (observed > reference || reference - observed > maxAgeMicros) {
    throw new JoinError(`${label} snapshot is stale or from the future`);
  }
}

function sameKey(left: LessonKey, right: LessonKey): boolean {
  return left.lessonDate === right.lessonDate && left.occurrenceId === right.occurrenceId &&
    left.studentId === right.studentId;
}

function keyToken(key: LessonKey): string {
  return JSON.stringify([key.lessonDate, key.occurrenceId, key.studentId]);
}

function one<T extends { key: LessonKey }>(rows: readonly T[], key: LessonKey, label: string): T | undefined {
  const matches = rows.filter((row) => sameKey(row.key, key));
  if (matches.length > 1) throw new JoinError(`ambiguous ${label} for selected lesson/student`);
  return matches[0];
}

function assertExactKeys(record: object, expected: readonly string[], message: string): void {
  const actual = Object.keys(record);
  if (actual.length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    throw new JoinError(message);
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new JoinError(message);
}
