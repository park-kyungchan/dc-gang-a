# Park Main Sheet v2: local projection core

This is the first, pure Python slice for a date-first, optional-group, selected-student Main Sheet. It does not read academy records, load sessions, call a network service, write Sheets, save DayRecord, or send a parent report. All current test inputs are invented.

## API

Import `project_selection` and the typed records from `workbench_v2`. Call it with a `LessonKey(lesson_date, occurrence_id, student_id)`, `group_filter` (`None` or `"0"` means all groups), timezone-aware `as_of`, positive `max_age`, and date-scoped `roster` plus `day_records`. Optional batches are `courses`, `app_preparation`, `drafts`, `spt_activity`, `save_effects`, and `reports`. It returns one `Projection`; it never selects a replacement student.

```python
projection = project_selection(
    selection=key, group_filter=None, as_of=read_time,
    max_age=timedelta(hours=24), roster=roster_rows,
    day_records=day_record_rows, courses=course_rows,
    app_preparation=app_rows, drafts=draft_history,
    spt_activity=approved_spt_events, save_effects=save_audit,
    reports=report_evidence,
)
```

`LessonKey` joins only by opaque lesson occurrence and student IDs. The exact current LMS mapping for `occurrence_id` is still unverified; an adapter must establish it from source keys and must not synthesize it from date alone, especially for makeup lessons. The selected DayRecord also binds its `course_id`, `record_seq`, and `cm_seq`; a course or app row must match the same `LessonKey` and course ID. Course effective dates must cover the selected date. A selected student outside the date/group roster, a stale source snapshot, duplicate row, unverified app join, or foreign course/record/report ID raises `JoinError`. Other students in a date-scoped batch are filtered out. School grade is displayed separately from course/book level.

Every displayed source value is a `Fact(value, source, observed_at, state)`. Construct a known fact with `Fact.known(value, Source.X, observed_at)` or an unknown fact with `Fact.unknown(Source.X, reason)`. Known current-state facts older than `max_age` become `stale` with their value hidden. Missing course and app reads stay `unknown`; no assignment, submission, grade, correction, teacher check, or absence is inferred. `AppPreparation.join_verified=True` is an adapter assertion, not a discovery method: do not construct it from a teacher-site shell or an unproven native-app key.

`DAY_RECORD_FIELDS` enumerates exactly eight read-model fields: attendance, daily test, progress, homework, memo, homework rate, persistent student memo, and unit selection. `SaveReadback` is imported audit evidence with reviewer, times, effect ID, target record, and exact readback validation. It contains no save function. `Draft` is teacher or LLM text with revision, optional review, `supersedes_id`, and correction reason. Supply the retained predecessor with a correction; old revisions remain in `Projection.drafts`. An edited revision is unreviewed until explicitly reviewed again. `SptProjection` requires an approved event and receipt ID; raw phone taps are rejected.

`ReportEvidence` keeps current preview, LMS sent label, and independently verified delivery receipt as separate facts. A draft, matching LMS save readback, preview, or sent icon does not imply parent delivery. A receipt must match the selected `report_seq`. The default for an unread report is unknown for all three facts.

## Check

From this project directory: `py -3 -m unittest discover -s workbench_v2/tests -v`.

## Next integration step

`lms_read_adapter.py` is the local, I/O-free adapter for a reviewed DayRecord read and an optional selected-student `StudyCourse` read. It accepts the exact source operation, date, selected group, read time, page coverage, and parsed row keys. An `OccurrenceBinding` must independently link the selected occurrence to the exact `record_seq`. A date-valid course becomes a `CourseAssignment` only when its source key has a verified relation to the selected DayRecord `course_id`. Otherwise the adapter omits the course and the projection displays `unknown`. It derives membership only in the selected date/group response, not a complete current Park roster. The current live occurrence and course-key proofs remain unavailable, so the adapter has been exercised only with invented records.

Next, obtain the authenticated, source-reviewed read contracts and exact selected-student binding without persisting raw records. Keep app submission/grading and delivered-message receipt unknown until their selected-student read contracts are independently established. Feed the resulting projection to a reversible Main-tab preview and test date/group/student context before any cutover. LMS writes and final parent delivery remain separate reviewed workflows.
