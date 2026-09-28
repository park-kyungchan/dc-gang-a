"""
Automated Python Verification Script for Main Sheet v2 Rubric & Schema
Zero Local Path Hardcoding - Runs on any Python 3.10+ standard library without external dependencies.
"""

import sys
import re
import json
from datetime import datetime, date, timedelta

# ============================================================================
# DIM-01: Multi-Book Simultaneous Possession Validation
# ============================================================================
def validate_book_possessions(books: dict, active_assessment: dict | None = None) -> tuple[bool, list[str]]:
    errors = []
    teacher_inspecting_count = 0
    for key, book in books.items():
        if book.get('physicalPossession') == 'teacher' and book.get('inspectionStatus') == 'in_progress':
            teacher_inspecting_count += 1
        if book.get('physicalPossession') == 'student' and book.get('inspectionStatus') == 'in_progress':
            errors.append(f"Conflict on book '{key}': Cannot be under active teacher inspection while in student possession.")

    if teacher_inspecting_count > 1:
        errors.append(f"Simultaneous possession conflict: Teacher cannot actively inspect {teacher_inspecting_count} books at the same instant for one student.")

    if active_assessment and active_assessment.get('status') == 'in_progress':
        if active_assessment.get('physicalPossession') != 'student':
            errors.append(f"Assessment possession conflict: Student is solving '{active_assessment.get('assessmentName')}', book must be in student possession.")

    return len(errors) == 0, errors

# ============================================================================
# DIM-02: 31-Day Attendance Grid & Hover Note Separation
# ============================================================================
def calculate_31day_grid_column(day: int, row_index: int = 4) -> dict:
    if day < 1 or day > 31:
        raise ValueError(f"Invalid day {day}")
    col_idx = 3 + day  # 0-indexed

    temp = col_idx
    col_letter = ""
    while temp >= 0:
        col_letter = chr((temp % 26) + ord('A')) + col_letter
        temp = (temp // 26) - 1

    return {
        "day": day,
        "colIndex": col_idx,
        "colLetter": col_letter,
        "cellAddress": f"{col_letter}{row_index}"
    }

def validate_attendance_cell_update(payload: dict) -> tuple[bool, list[str]]:
    errors = []
    allowed_codes = {'O', 'X', 'O(지각)', 'O(보강)', 'O(이동)', ''}
    val = payload.get("cellValue", "")

    if val not in allowed_codes:
        errors.append(f"Invalid cellValue '{val}'. Must be strictly one of {allowed_codes}.")
    if len(val) > 10:
        errors.append(f"Cell value exceeds 10 chars: '{val}'. Destroys formula.")
    if not payload.get("preserveFormatting", False):
        errors.append("preserveFormatting must be True.")

    return len(errors) == 0, errors

# ============================================================================
# DIM-03: Holiday-Aware Lookback Resolver
# ============================================================================
def resolve_baseline_homework_date(
    student_id: str,
    target_date_str: str,
    enrolled_days_of_week: list[int],
    holidays: list[dict],
    absence_history: dict[str, str]
) -> dict:
    target_dt = datetime.strptime(target_date_str, "%Y-%m-%d").date()
    holiday_dates = {h['date'] for h in holidays if h.get('isClassCancelled', False)}

    curr = target_dt
    resolved_date = None
    holiday_intervened = False
    absence_intervened = False

    for _ in range(21):
        curr -= timedelta(days=1)
        date_str = curr.strftime("%Y-%m-%d")
        day_of_week = curr.isoweekday()  # 1: Mon, ..., 7: Sun

        is_scheduled = day_of_week in enrolled_days_of_week
        is_holiday = date_str in holiday_dates
        is_absent = date_str in absence_history

        if is_holiday:
            holiday_intervened = True
        if is_absent:
            absence_intervened = True

        if is_scheduled and not is_holiday and not is_absent:
            resolved_date = date_str
            break

    if not resolved_date:
        raise RuntimeError(f"Could not resolve baseline within 21 days for {student_id}")

    return {
        "studentId": student_id,
        "baselineDate": resolved_date,
        "holidayIntervened": holiday_intervened,
        "absenceIntervened": absence_intervened
    }

# ============================================================================
# DIM-04: Append-Only Audit Trail Validator
# ============================================================================
def validate_audit_record(rec: dict) -> tuple[bool, list[str]]:
    errors = []
    if not rec.get("auditId", "").startswith("adt_"):
        errors.append("Invalid auditId")
    if not rec.get("author"):
        errors.append("Missing author")
    if "preOverrideValue" not in rec or rec["preOverrideValue"] is None and rec.get("preOverrideValue") is None:
        pass
    if "preOverrideValue" not in rec:
        errors.append("Missing preOverrideValue")
    if "postOverrideValue" not in rec:
        errors.append("Missing postOverrideValue")
    reason = rec.get("reason", "")
    if len(reason.strip()) < 10:
        errors.append(f"Reason must be >= 10 chars, got '{reason}'")

    return len(errors) == 0, errors

# ============================================================================
# RUNNER
# ============================================================================
def main():
    print("=== Python Portable Verification for Main Sheet v2 ===")

    # 1. Test Multi-Book Possession
    ok, errs = validate_book_possessions({
        'b1': {'physicalPossession': 'teacher', 'inspectionStatus': 'in_progress'},
        'b2': {'physicalPossession': 'teacher', 'inspectionStatus': 'in_progress'},
    })
    assert not ok, "Simultaneous teacher inspection should fail"
    print("  [PASS] DIM-01: Multi-book possession conflict caught.")

    # 2. Test Grid Columns
    test_cases = [(1, 4, 'E'), (21, 24, 'Y'), (23, 26, 'AA'), (25, 28, 'AC'), (28, 31, 'AF'), (31, 34, 'AI')]
    for d, exp_idx, exp_let in test_cases:
        coord = calculate_31day_grid_column(d)
        assert coord['colIndex'] == exp_idx and coord['colLetter'] == exp_let, f"Mismatch on Day {d}"
    print("  [PASS] DIM-02: 31-day column mapping verified.")

    # Test Cell Value Protection
    good_cell, _ = validate_attendance_cell_update({
        "cellValue": "O(지각)", "preserveFormatting": True
    })
    bad_cell, _ = validate_attendance_cell_update({
        "cellValue": "15분 지각 (병원 진료)", "preserveFormatting": True
    })
    assert good_cell and not bad_cell, "Cell value validation error"
    print("  [PASS] DIM-02: Cell value guard prevents freeform formula corruption.")

    # 3. Test Holiday-Aware Lookback
    holidays = [{'date': '2026-09-23', 'isClassCancelled': True}]
    shin = resolve_baseline_homework_date('1293032', '2026-09-28', [1, 3], holidays, {'2026-09-23': '추석'})
    assert shin['baselineDate'] == '2026-09-21' and shin['absenceIntervened'], "Shin Ji-woo lookback error"
    park = resolve_baseline_homework_date('1293067', '2026-09-28', [1, 5], holidays, {})
    assert park['baselineDate'] == '2026-09-25', "Park Se-eun lookback error"
    print(f"  [PASS] DIM-03: Shin Ji-woo walked back to {shin['baselineDate']}, Park Se-eun to {park['baselineDate']}.")

    # 4. Test Audit Record
    valid_audit, _ = validate_audit_record({
        "auditId": "adt_20260923_112000_1293032_hw",
        "author": "박경찬T",
        "preOverrideValue": "가우스 p.100~131",
        "postOverrideValue": "가우스 p.100~131 + 다빈치 p.42~49",
        "reason": "09/23 추석연휴 결석 통보 접수 후 학습 공백 보완을 위해 사후 추가 및 일지 Override"
    })
    short_audit, _ = validate_audit_record({
        "auditId": "adt_1", "author": "T", "preOverrideValue": "a", "postOverrideValue": "b", "reason": "수정"
    })
    assert valid_audit and not short_audit, "Audit validation error"
    print("  [PASS] DIM-04: Audit record validation verified.")

    print("\n[ALL PYTHON INVARIANT CHECKS PASSED SUCCESSFULLY (100%)]\n")

if __name__ == '__main__':
    main()
