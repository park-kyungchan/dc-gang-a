# Main Sheet pilot backlog

Updated 2026-09-29. This is local planning material; no academy data or Sheet
cell has been changed by these items.

## Question-level page audit

**Owner request:** Start the 2026-09-30 Ruhan pilot at page level and gradually
track the exact questions on each page. The teacher confirmed five visible
states: inspected complete, student-reported complete, unfinished, unknown,
and partial progress. Inspected complete requires the teacher to confirm
wrong-answer correction. Students submit answers to the academy app and finish
the first wrong-answer pass as homework. A question still unclear after its
lecture video is starred and remains open for teacher attention.
The teacher selected a class-time handling flow: after addressing the starred
question, choose resolved, further explanation, or carry forward to the next
class. Preserve the original star and the later decision as separate events.

**Acceptance:** Bind a stable textbook edition, page number and question ID
from the actual academy textbook sample or verified physical edition. Record
assignment, attempt, backend grade, wrong-answer correction and teacher
inspection as separate append-only facts with source, occurrence and time.
Show which questions support a partial-page state. A partial page, app grade
or student report never marks the whole page inspected complete. Corrections
retain earlier evidence and an explicit superseded event ID. Do not derive
question IDs from a different edition's table of contents.

**Dependency:** Exact student textbook assignment and edition, full page/question
coverage, student/attempt joins and a durable teacher event writer. Two exact
Gauss sample PDFs now have visually checked TOC start pages in
`research/textbooks/book-catalog.json`; this does not bind either book to the
pilot student or supply a complete question map.

## In-class raw inbox and end-of-day cleanup

**Owner request:** As the teacher provides question-level observations in this
project session, append the original wording to the matching student's Main
Sheet DB immediately. Before leaving, remind the teacher to review and clean
up unresolved inputs for **all** students.

**Acceptance:** Each input has an immutable ID, student/lesson selector, source
channel, original text, received time and optional unresolved book/page/question
hints. An ambiguous selector blocks recording to a student DB and stays in an
explicit unassigned queue. Normalized events link back to the raw input and
preserve corrections. The end-of-day view lists every student with pending
raw inputs, starred questions, unverified corrections and missing page checks;
teacher review closes items individually. The teacher can open cleanup any
time; the usual 21:30-22:00 window and the last-class closeout surface
pending counts without auto-closing them. A production writer needs an exact
reviewed Sheet batch and readback before first use.

## Individual correctness adjustment

**Owner request:** Combine student-entered app grading and the teacher's
classroom judgment to refine each student's proposed quantity as history
grows. Task duration is excluded.

**Acceptance:** First interview the teacher with that student's exact app
attempts, page history and observed classroom level. Bind accuracy to student,
book or paper, assignment, attempt and grading revision; distinguish raw score
from teacher judgment. Store the reviewed policy and its evidence/version,
then show its effect on the proposed new-subunit count before approval. Missing
joins or an unreviewed policy leave accuracy weighting inactive.

**Dependency:** Verified app submission and grading read contracts, per-student
page history and an interview on what accuracy means for that student. The
current deterministic quantity calculator uses page status and measured
completed units only; it has no accuracy weight.
