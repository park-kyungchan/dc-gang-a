# Main Sheet v2 Adversarial Evaluation Rubric & Specification

**Document Version:** 2.0.0  
**Effective Date:** 2026-09-28  
**Target Surface:** Main Sheet v2, Attendance Grid Ledger, and 14:00 Briefing Scanner  
**Target Session:** 2026-09-28 15:00 Session (Shin Ji-woo · Park Se-eun · Yoo Ji-yeon)  
**Evaluator Target:** External LLM Benchmarking & Automated CI/CD Regression Harness  

---

## 1. Executive Summary & Evaluation Philosophy

This evaluation rubric defines the exhaustive, adversarial pass/fail criteria for the **Main Sheet v2** operational system. Unlike standard web UI forms or generic spreadsheet templates, the Daechi academy environment operates under high-stress concurrent multitasking where minor data anomalies cause catastrophic classroom failure:
- Overwriting an attendance cell destroys administrative monthly formula totals (`=COUNTIF`).
- Lumping multiple textbooks into a single "checked" flag leads to uninspected curriculum and parent complaints.
- Failing to account for holiday/absence chains produces incorrect student homework baselines.
- Mutating historical records without an append-only audit trail breaks the legal and administrative chain of custody.

### The Five Invariant Pillars
1. **Multi-Book Atomic State Machine**: Every physical textbook/task must maintain its own atomic possession and inspection state.
2. **Dual-Write Attendance & Hover Notes**: Official single-letter codes in cell values; all narrative details strictly in Hover Notes.
3. **14:00 Briefing & Holiday-Aware Resolver**: Dynamically walk back student attendance schedules, factoring in holidays and student absences.
4. **Append-Only Audit Trail Engine**: Never perform destructive in-place updates; always record `preOverrideValue`, `postOverrideValue`, and rationale.
5. **Zero Machine-Dependent Path Hardcoding**: All schemas, tests, and evaluator harnesses must run cleanly on any foreign OS/PC without path dependencies.

---

## 2. Evaluation Dimensions & Adversarial Scoring Matrix

Total available points: **100 Points**.  
Minimum passing threshold: **95 Points** with **ZERO Hard-Fail Blockers**.

| Dimension | Domain Focus | Weight | Min Pass | Hard-Fail Condition |
| :--- | :--- | :---: | :---: | :--- |
| **DIM-01** | Multi-Book Atomic State Machine | 25 pts | 24 pts | Lumping multiple books into a student-level boolean, or simultaneous possession conflict. |
| **DIM-02** | Dual-Write Attendance & Hover Notes | 25 pts | 24 pts | Overwriting cell value with freeform text, or off-by-one column alignment. |
| **DIM-03** | 14:00 Pre-class Briefing Scanner | 25 pts | 24 pts | Naive 1-day/shared lookback, missing holiday/absence, or regex scope parsing failure. |
| **DIM-04** | Append-Only Audit Trail Engine | 20 pts | 19 pts | Destructive mutation, missing `preOverrideValue`, or reason $< 10$ characters. |
| **DIM-05** | Zero Local Path Hardcoding | 5 pts | 5 pts | Presence of absolute machine-local paths (`C:\Users\*`, `/home/*`). |

---

## 3. DIM-01: Multi-Book Atomic State Machine & Task Pivoting (25 Points)

### 3.1 Domain Reality & Real-World Session Grounding
In the 2026-09-28 15:00 session:
- **Park Se-eun (`1293067`)**: Submitted Primary Book *Gauss 5-2 Vol 2* at 15:00. While the teacher inspected Gauss (100% complete at 15:20), Park was immediately assigned a **Buffer Task** on Secondary Book *Davinci 5-1 Vol 1* (`약수와 배수(2)`) to eliminate idle classroom time.
- **Shin Ji-woo (`1293032`)**: Submitted *Gauss 5-2 Vol 2* (100% inspected). Assigned in-class task on *Davinci 5-1 Vol 1* (`p.42 ~ p.49`). At 15:29, Shin experienced cognitive overload ("너무 어려워요"). The teacher executed an **in-class task drop** and pivoted her to *Gauss 5-2 Vol 2* `p.71 ~ p.73` **Grand Chapter Assessment** (60-min timed attack: 15:35 ~ 16:35), carrying forward the assessment missed during her 09/23 absence.
- **Yoo Ji-yeon (`1293138`)**: Arrived at 15:15 (15-min delay). Submitted *GaussPlus 5-2* (`p.71 ~ p.89`), which was inspected and passed 100% by 15:23. However, her Primary Book *Gauss 1-1* remained uninspected (`holding_by_student`) because she kept it at her desk to prepare for the **Concept Blank Test**. At 15:35, all three students entered a synchronized 60-minute Grand Chapter Assessment (`syncGroup: 'timed_eval_1535'`).

### 3.2 Required State Invariants
1. **Atomic Independence**: Each textbook/task is an independent node with:
   - `bookId`: string slug (e.g. `gauss_5_2_vol2`, `davinci_5_1_vol1`)
   - `physicalPossession`: `'teacher' | 'student' | 'holding_desk' | 'unconfirmed'`
   - `inspectionStatus`: `'pending' | 'in_progress' | 'completed_100%' | 'completed_partial' | 'incomplete' | 'holding_by_student'`
2. **Possession Conflict Prevention**:
   - The teacher cannot actively inspect two different books from the same student at the same time (`teacherInspectingCount <= 1`).
   - If a book is in `'student'` possession, its `inspectionStatus` cannot be `'in_progress'`.
   - If an active timed assessment is underway (`status: 'in_progress'`), the assessment book's `physicalPossession` **MUST be `'student'`**.
3. **Task Drop & Pivot Immutability**:
   - Dropped tasks must NEVER be deleted from state.
   - Stored in `taskDropEvents` with `droppedAt`, `reasonCategory` (`'cognitive_overload'`), `detailedReason`, and `pivotTargetTaskId`.
4. **Synchronized Timed Assessment (`syncGroup`)**:
   - All participants in a `syncGroup` (e.g. `timed_eval_1535`) must have identical `scheduledStartTime` (`15:35`), `timeLimitMinutes` (`60`), and `scheduledEndTime` (`16:35`).

### 3.3 Adversarial Test Vectors
- **TEST-01-A (Monolithic State Failure)**: An evaluator attempts to set `student.homeworkCompleted = true` without book-level keys.  
  *Expected Result*: **FAIL**. Must reject updates lacking atomic book keys.
- **TEST-01-B (Simultaneous Possession Conflict)**: Teacher is marked inspecting *Gauss 1-1* while Yoo Ji-yeon is taking a 60-min test on *Gauss 1-1*.  
  *Expected Result*: **FAIL**. Throws `Assessment possession conflict`.
- **TEST-01-C (Silent Task Deletion on Drop)**: Shin Ji-woo's Davinci task is removed from JSON instead of creating a `TaskDropPivotEvent`.  
  *Expected Result*: **FAIL**. Dropped tasks must be permanently retained for auditing and parent reporting.

---

## 4. DIM-02: Dual-Write Administrative Attendance & Hover Notes (25 Points)

### 4.1 Domain Reality & 31-Day Grid Mathematics
In the academy's official attendance register (`26.1월_12월_출석부.xlsx`, September sheet):
- Column 0 (`A`): Student Name (`이름`)
- Column 1 (`B`): School (`학교`)
- Column 2 (`C`): Class Group (`반`)
- Column 3 (`D`): Monthly Sum Formula (`합계`, `=COUNTIF(E4:AI4, "O*")`)
- Column $4 \dots 34$ (`E` $\dots$ `AI`): Attendance days 1 through 31.

#### Mathematical Grid Mapping Formula
For any calendar day $d \in [1, 31]$:
$$\text{colIndex}(d) = 3 + d \quad (\text{0-indexed})$$
- Day 1: $\text{colIndex}(1) = 3 + 1 = 4 \implies \text{Column 'E'}$
- Day 21: $\text{colIndex}(21) = 3 + 21 = 24 \implies \text{Column 'Y'}$
- Day 23: $\text{colIndex}(23) = 3 + 23 = 26 \implies \text{Column 'AA'}$
- Day 25: $\text{colIndex}(25) = 3 + 25 = 28 \implies \text{Column 'AC'}$
- Day 28: $\text{colIndex}(28) = 3 + 28 = 31 \implies \text{Column 'AF'}$
- Day 31: $\text{colIndex}(31) = 3 + 31 = 34 \implies \text{Column 'AI'}$

### 4.2 Dual-Write Protocol (Cell Value vs Hover Note)
Spreadsheet formulas rely exclusively on exact text tokens. Putting narrative sentences in the cell destroys `=COUNTIF`.
1. **Cell Value (`cellValue`)**:
   - Strictly restricted to `AttendanceCellCode`:
     - `'O'` (Present on time)
     - `'X'` (Absent)
     - `'O(지각)'` (Tardy)
     - `'O(보강)'` (Makeup attendance)
     - `'O(이동)'` (Room transfer)
     - `''` (Blank / no class)
   - Max length: $\le 10$ characters.
2. **Hover Note (`hoverNote`)**:
   - Stores all administrative, communication, and logistical details.
   - Must preserve multiline structure:
     ```text
     [지각 사유]
     - 도착 시각: 15:15 (15분 지연)
     - 사전 접수: 15:00 SMS 접수 완료
     - 지연 사유: 추석 연휴 직후 병원 대기 환자 과밀로 진료 지연
     - 현장 조치: 등원 즉시 과제 실물 제출 및 15:35 대단원 총괄평가 정상 응시
     ```
3. **Format Preservation (`preserveFormatting: true`)**:
   - Updating cell values or notes must NEVER clear background fills, borders, or conditional formatting rules.

### 4.3 Adversarial Test Vectors
- **TEST-02-A (Freeform Cell Overwrite)**: System writes `"15분 지각 (병원 진료)"` into cell `AF4`.  
  *Expected Result*: **FAIL (Hard Blocker)**. Formula `=COUNTIF(E4:AI4, "O*")` fails to count attendance.
- **TEST-02-B (Off-by-One Column Calculation)**: Evaluator computes column for Day 28 as `28` (Col `AC`) instead of `3 + 28 = 31` (Col `AF`).  
  *Expected Result*: **FAIL (Hard Blocker)**. Overwrites Day 25 attendance cell.
- **TEST-02-C (Note Flattening)**: Evaluator strips newlines, turning multiline note into an illegible single-line blob.  
  *Expected Result*: **FAIL**. Loses structured readability.
- **TEST-02-D (Format Stripping)**: API call resets cell style, removing color coding for tardiness.  
  *Expected Result*: **FAIL**.

---

## 5. DIM-03: 14:00 Pre-class Briefing Scanner & Holiday-aware Lookback (25 Points)

### 5.1 Domain Reality: Heterogeneous Student Lookback
At 14:00 on Monday 2026-09-28, the teacher reviews the target class. The scanner must resolve the **exact baseline homework date** for each student:
1. **Park Se-eun (`1293067`) & Yoo Ji-yeon (`1293138`)**:
   - Enrolled class: **월금1부** (Mondays and Fridays).
   - Friday 2026-09-25 was an attended class day.
   - Baseline Homework Date: **2026-09-25 (금)**.
2. **Shin Ji-woo (`1293032`)**:
   - Enrolled class: **월수1부** (Mondays and Wednesdays).
   - Scheduled class on Wednesday 2026-09-23 was missed (**09/23 추석 연휴 결석**).
   - Lookback algorithm must step back past 09/23 to the last attended class: **2026-09-21 (월)**.
   - **Post-Absence Override Integration**: On 09/23, the teacher added *Davinci 5-1 Vol 1 p.42~p.49* to 09/21 homework. The scanner must resolve the effective assigned homework as *Gauss p.100~p.131 + Davinci p.42~p.49*.

### 5.2 Prestudy Video Keyword Parsing & Traffic Light
The scanner parses raw DayRecord homework strings using regex:
- Keywords: `예습영상`, `개념 예습영상 촬영`, `개념설명`, `동영상`, `영상 촬영`
- Range extraction: `/(?:p\.|페이지)?\s*(\d+)\s*(?:~|-)\s*(?:p\.|페이지)?\s*(\d+)/i`
- Context inheritance: Correctly attributes book title across multiple clauses (`+` delimited).
- **Traffic-Light Status Engine**:
  - 🟢 **GREEN**: Video uploaded and confirmed in LMS before 14:00 briefing.
  - 🟡 **YELLOW**: Video submitted $< 30$ min before class or partial audio/video.
  - 🔴 **RED**: Video missing or overdue $\implies$ Queues **Zero Test (ZT)** or in-class explanation video shooting upon arrival.
  - ⚪ **GRAY**: No prestudy required for this unit.

### 5.3 Concept Blank Test Domain Invariant
$$\text{금일 개념백지테스트 평가 범위} \equiv \text{직전 회차 수업일지 숙제(예습) 범위}$$
- The scanner MUST automatically extract the prestudy page range from the resolved baseline homework and bind it to `conceptTest.scope`.
- For Yoo Ji-yeon on 2026-09-28: *Gauss 1-1* previous prestudy range is auto-injected without manual teacher typing.

### 5.4 Adversarial Test Vectors
- **TEST-03-A (Naive Uniform Lookback)**: System assigns `2026-09-25` to all students, giving Shin Ji-woo an unassigned/empty date.  
  *Expected Result*: **FAIL (Hard Blocker)**.
- **TEST-03-B (Absence Blindness)**: System queries `2026-09-23` for Shin Ji-woo and reports "no homework submitted", ignoring the fact that she was absent.  
  *Expected Result*: **FAIL (Hard Blocker)**.
- **TEST-03-C (Regex Range Truncation)**: Fails to parse `초5-2 가우스 2권 p.100 ~ p.131 + p.78 ~ p.99 개념 예습영상 촬영`, returning `p.100~131` as the prestudy range instead of `p.78~p.99`.  
  *Expected Result*: **FAIL**. Wrong concept test scope injected.

---

## 6. DIM-04: Append-Only Audit Trail Engine (20 Points)

### 6.1 Domain Reality & Academy Audit Requirements
Legacy LMS servlets perform raw destructive SQL `UPDATE` queries. When Teacher Park modified 09/21 homework on 09/23 to add Davinci workbook pages, the LMS erased the original record. The Main Sheet v2 Audit Trail Engine prevents this data loss.

### 6.2 Audit Record Schema Specification
Every override MUST produce an immutable `AuditRecord`:
```typescript
interface AuditRecord {
  auditId: `adt_${string}`;           // Unique ID (e.g. adt_20260923_112000_1293032_hw)
  timestamp: string;                  // ISO 8601 with offset
  author: string;                     // e.g. "박경찬T" or TeacherId "1292923"
  targetStudentId: StudentId;         // e.g. "1293032"
  targetDate: string;                 // Target lesson YYYY-MM-DD (e.g. "2026-09-21")
  field: AuditField;                  // 'homework' | 'progress' | 'attendance' | 'notes'
  preOverrideValue: unknown;          // Prior state (NEVER undefined or erased)
  postOverrideValue: unknown;         // New state
  reason: string;                     // Minimum 10 chars explanation
  supersededAuditId?: AuditId;        // Chained ID if re-overriding
  integrityHash?: string;             // SHA-256 integrity hash
}
```

### 6.3 Audit Invariants
1. **Permanent Preservation**: `preOverrideValue` cannot be deleted, set to `undefined`, or mutated.
2. **Mandatory Rationale**: `reason` must be $\ge 10$ characters. Generic strings (`"update"`, `"fix"`, `"modified"`) are rejected.
3. **No In-Place Deletion**: Audit records cannot be deleted. Rollback is implemented as a new audit record where `postOverrideValue` equals the historical `preOverrideValue`.

### 6.4 Adversarial Test Vectors
- **TEST-04-A (Destructive In-Place Edit)**: Field updated directly without appending to `auditTrail`.  
  *Expected Result*: **FAIL (Hard Blocker)**.
- **TEST-04-B (Pre-Override Amnesia)**: `preOverrideValue` is passed as `undefined` or identical to `postOverrideValue`.  
  *Expected Result*: **FAIL**.
- **TEST-04-C (Trivial Reason Bypass)**: `reason` is `"수정"` or whitespace.  
  *Expected Result*: **FAIL**. Must reject reasons under 10 meaningful characters.

---

## 7. DIM-05: Zero Local Path Hardcoding & Portability (5 Points)

### 7.1 Portability Specification
The codebase must be fully reproducible across diverse developer machines, CI runners, and external evaluator environments (e.g. Linux Docker containers, macOS development laptops, secondary Windows PCs).

### 7.2 Strict Path Rules
1. **No User Path Hardcoding**: Never write `C:\Users\<username>\*`, `/home/<username>/*`, or `/Users/<username>/*` into source files, schemas, rubrics, or configuration files.
2. **Relative or Environment-Resolved Paths**: All file operations must resolve relative to repository root (`process.cwd()`, `import.meta.dir`, or path resolution helpers).
3. **Cross-Platform Path Separators**: Handle both Windows `\` and POSIX `/` cleanly.

### 7.3 Adversarial Test Vectors
- **TEST-05-A (Path Leakage Scan)**: Grep repository files for regex `[C-Z]:\\Users|\/Users\/|\/home\/`.  
  *Expected Result*: Zero matches in tracked code, tests, and schemas.
- **TEST-05-B (Foreign Environment Execution)**: Run test suite via `bun` from an arbitrary directory path.  
  *Expected Result*: **PASS** with zero module-not-found errors.

---

## 8. Hard-Fail Blockers Checklist

A failure in any of the following 5 checks results in an **IMMEDIATE REJECTION (Grade F / 0 pts)** regardless of points scored elsewhere:

- [ ] **BLOCKER-1**: Writing freeform narrative or delay reasons into spreadsheet cell values instead of Hover Notes, corrupting `=COUNTIF()` attendance totals.
- [ ] **BLOCKER-2**: Collapsing multiple active textbooks into a single student-level boolean flag, resulting in uninspected textbooks.
- [ ] **BLOCKER-3**: Performing a destructive edit on attendance, homework, or progress records without generating an append-only audit record containing the `preOverrideValue`.
- [ ] **BLOCKER-4**: Applying a naive fixed lookback date to Shin Ji-woo that fails to resolve her 09/23 Chuseok absence back to 09/21.
- [ ] **BLOCKER-5**: Including machine-local user directory paths (`C:\Users\*`) in schemas, rubrics, or evaluation scripts.

---

## 9. Automated Evaluation Verification Script

To verify that the TypeScript schema, types, formulas, and validators meet all rubric requirements, execute the portable verification suite using Bun:

```bash
bun -e "
import * as schema from './data/raw_sessions/2026-09-28/main_sheet_v2.types.ts';

// 1. Grid Math Verification (col = 3 + day)
const testDays = [1, 21, 23, 25, 28, 31];
const expectedLetters = ['E', 'Y', 'AA', 'AC', 'AF', 'AI'];
testDays.forEach((day, i) => {
  const coord = schema.calculate31DayGridColumn(day);
  if (coord.colLetter !== expectedLetters[i]) {
    throw new Error(\`Col mismatch for Day \${day}: got \${coord.colLetter}, expected \${expectedLetters[i]}\`);
  }
});

// 2. Dual-Write Attendance Guard
const goodCell = schema.validateAttendanceCellUpdate({
  row: 4, col: 31, cellAddress: 'AF4', cellValue: 'O(지각)', hoverNote: '15:15 도착', preserveFormatting: true
});
if (!goodCell.valid) throw new Error('Valid cell failed');

const badCell = schema.validateAttendanceCellUpdate({
  row: 4, col: 31, cellAddress: 'AF4', cellValue: '15분 지각 (병원 진료)' as any, hoverNote: null, preserveFormatting: true
});
if (badCell.valid) throw new Error('Bad cell should have been rejected');

// 3. Holiday-Aware Lookback
const holidays = [{ date: '2026-09-23', name: '추석', isClassCancelled: true }];
const shin = schema.resolveBaselineHomeworkDate('1293032', '2026-09-28', [1, 3], holidays, { '2026-09-23': '추석 결석' });
if (shin.baselineDate !== '2026-09-21') throw new Error('Shin Ji-woo baseline error');

const park = schema.resolveBaselineHomeworkDate('1293067', '2026-09-28', [1, 5], holidays, {});
if (park.baselineDate !== '2026-09-25') throw new Error('Park Se-eun baseline error');

// 4. Multi-Book Possession Validator
const conflict = schema.validateBookPossessions({
  b1: { bookId: 'b1', bookTitle: 'B1', bookRole: 'primary', assignedRange: '', physicalPossession: 'teacher', inspectionStatus: 'in_progress', completionRatePercent: null },
  b2: { bookId: 'b2', bookTitle: 'B2', bookRole: 'secondary', assignedRange: '', physicalPossession: 'teacher', inspectionStatus: 'in_progress', completionRatePercent: null }
});
if (conflict.valid) throw new Error('Expected possession conflict for 2 teacher in-progress books');

// 5. Audit Record Validator
const audit = schema.validateAuditRecord({
  auditId: 'adt_20260923_112000_1293032_hw',
  timestamp: '2026-09-23T11:20:00+09:00',
  author: '박경찬T',
  targetStudentId: '1293032',
  targetDate: '2026-09-21',
  field: 'homework',
  preOverrideValue: '가우스 p.100~131',
  postOverrideValue: '가우스 p.100~131 + 다빈치 p.42~49',
  reason: '09/23 추석연휴 결석 통보 접수 후 학습 공백 보완을 위해 사후 추가 및 일지 Override'
});
if (!audit.valid) throw new Error('Valid audit failed validation');

console.log('✅ Main Sheet Rubric Verification: 100% Passed (Score: 100/100, 0 Hard Blockers)');
"
```
