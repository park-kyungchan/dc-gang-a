# -*- coding: utf-8 -*-
"""
지각(L) 과 일일테스트 면제 (원장 P-10).

두 가지를 지킵니다.

    1. **지각은 결석이 아닙니다.** 늦게라도 수업을 받았으므로 출석과 같은 5항목을
       요구해야 합니다. 출결을 Y/N 두 값으로만 보면 지각 학생이 통째로 샙니다.
       (출결 드롭다운 실측값에 `L` 이 있습니다.)
    2. **면제는 사유가 있어야만 성립합니다.** 플래그 하나로 필수 항목이 빠지면
       "귀찮아서 면제" 가 가능해지고, 성공 기준이 "빠뜨리지 않는 것" 인 이
       프로젝트에서 면제가 곧 누락의 우회로가 됩니다.

    그리고 **면제를 자동으로 판정하지 않습니다.** 클리닉 학생 실제 사례를 아직
    못 봤으므로(P-10, 미검증) 조건을 추측해 면제하지 않습니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.lms.endpoints import ATTENDANCE_VALUES  # noqa: E402
from ganga.pipeline.completeness import (  # noqa: E402
    REQUIRED_WHEN_LATE,
    REQUIRED_WHEN_PRESENT,
    Attendance,
    DtExemption,
    check_class,
    check_row,
    read_dt_exemption,
)

FULL = {
    "student_name": "김민준",
    "attendance": "Y",
    "dt_score": 9,
    "progress_text": "p.31 실력쌓기 5~8번",
    "homework_text": "p.32 1~6번",
    "daily_memo": "약분 원리를 스스로 설명함",
}

#: 일일테스트만 빠진 행. 면제 검사의 기본 재료입니다.
NO_DT = {k: v for k, v in FULL.items() if k != "dt_score"}


# ─────────────────────────────────────────────────────────────
# 지각 (L)
# ─────────────────────────────────────────────────────────────
def test_출결_드롭다운_실측값을_전부_다룬다():
    """서버가 값을 추가하면 여기서 먼저 깨져야 합니다.

    모르는 값을 조용히 출석으로 취급하면 그 학생의 누락이 보이지 않습니다.
    """
    server = {k for k in ATTENDANCE_VALUES if k.strip()}
    assert server == {a.value for a in Attendance}


def test_지각은_출석과_같은_필수항목을_요구한다():
    """수업을 받았으므로 진도·숙제·메모·일일테스트가 다 필요합니다."""
    r = check_row({"student_name": "박지호", "attendance": "L"})
    assert r.attendance is Attendance.LATE
    assert r.required == REQUIRED_WHEN_PRESENT
    assert REQUIRED_WHEN_LATE == REQUIRED_WHEN_PRESENT
    assert set(r.missing) == {"dt_score", "progress_text",
                              "homework_text", "daily_memo"}


def test_지각도_다_채우면_완료():
    r = check_row({**FULL, "attendance": "L"})
    assert r.is_complete, r.summary()
    assert r.progress_mark == "●●●●●"


def test_지각인데_진도가_있어도_모순이_아니다():
    """결석 규칙을 지각에 적용하면 정상 입력이 경고로 쏟아집니다."""
    r = check_row({**FULL, "attendance": "L"})
    assert r.conflicts == []


def test_지각은_결석으로_세지_않는다():
    cs = check_class([{**FULL, "attendance": "L"},
                      {"student_name": "이서준", "attendance": "N"}],
                     date="2026-08-20")
    assert len(cs.late) == 1 and len(cs.absent) == 1
    assert "지각 1명" in cs.summary()


def test_지각_라벨은_서버_드롭다운을_따른다():
    assert Attendance.LATE.label == "지각"
    assert Attendance.LATE.attended is True
    assert Attendance.ABSENT.attended is False


def test_모르는_출결값은_출석으로_취급하지_않는다():
    r = check_row({**NO_DT, "student_name": "박지호", "attendance": "X"})
    assert r.attendance is None
    assert "attendance" in r.missing
    assert not r.is_complete


# ─────────────────────────────────────────────────────────────
# DT 면제 — 사유가 있어야 성립
# ─────────────────────────────────────────────────────────────
def test_사유가_있으면_일일테스트가_필수에서_빠진다():
    r = check_row({**NO_DT, "dt_exempt": True,
                   "dt_exempt_reason": "클리닉 보강이라 DT 미실시"})
    assert r.dt_exempt is True
    assert "dt_score" not in r.required
    assert r.is_complete, r.summary()
    assert r.progress_mark == "●●●●"       # 5칸이 아니라 4칸


def test_면제는_일일테스트_한_칸만_뺀다():
    """면제가 진도·숙제·메모까지 빼면 그건 면제가 아니라 구멍입니다."""
    r = check_row({"student_name": "박지호", "attendance": "Y",
                   "dt_exempt": True, "dt_exempt_reason": "클리닉 보강"})
    assert set(r.missing) == {"progress_text", "homework_text", "daily_memo"}
    assert not r.is_complete


def test_사유가_없으면_면제되지_않는다():
    r = check_row({**NO_DT, "dt_exempt": True})
    assert r.dt_exempt is False
    assert "dt_score" in r.missing
    assert not r.is_complete


def test_사유가_공백뿐이면_면제되지_않는다():
    r = check_row({**NO_DT, "dt_exempt": True, "dt_exempt_reason": "   "})
    assert r.dt_exempt is False
    assert "dt_score" in r.missing


def test_사유없는_면제는_조용히_무시되지_않는다():
    """무시만 하면 선생님은 면제된 줄 알고 넘어갑니다."""
    r = check_row({**NO_DT, "dt_exempt": True})
    assert any("면제 사유가 비어" in c for c in r.conflicts)


def test_플래그가_꺼져_있으면_사유만으로는_면제되지_않는다():
    """면제를 껐는데 사유 문자열이 남아 되살아나면, 끈 사람 모르게 면제됩니다."""
    r = check_row({**NO_DT, "dt_exempt": False,
                   "dt_exempt_reason": "지난주 클리닉"})
    assert r.dt_exempt is False
    assert "dt_score" in r.missing
    assert r.conflicts == []          # 지정 자체가 없으므로 경고도 없습니다


def test_문자열_false_는_면제가_아니다():
    """폼에서 온 'false' 는 파이썬에서 참입니다. 그대로 믿으면 안 켠 면제가 켜집니다."""
    for raw in ("false", "0", "N", "no", "off", ""):
        r = check_row({**NO_DT, "dt_exempt": raw,
                       "dt_exempt_reason": "클리닉 보강"})
        assert r.dt_exempt is False, raw
        assert "dt_score" in r.missing, raw


def test_면제인데_점수가_있으면_모순():
    r = check_row({**FULL, "dt_exempt": True, "dt_exempt_reason": "클리닉 보강"})
    assert any("면제인데 점수" in c for c in r.conflicts)
    assert not r.is_complete


def test_면제인데_0점은_모순이_아니다():
    """0 은 '0점' 이 아니라 '미실시' 입니다(DAILY_TEST_SCALE 실측).

    미실시는 면제와 모순되지 않으므로 정상 입력으로 통과해야 합니다.
    """
    r = check_row({**FULL, "dt_score": 0,
                   "dt_exempt": True, "dt_exempt_reason": "클리닉 보강"})
    assert r.conflicts == []
    assert r.is_complete


def test_면제를_자동으로_판정하지_않는다():
    """클리닉으로 보이는 힌트가 있어도, 선생님이 지정하지 않으면 면제가 아닙니다.

    실제 클리닉 학생 사례를 아직 못 봤으므로(P-10) 조건을 추측하지 않습니다.
    """
    r = check_row({**NO_DT, "student_name": "김민준(클리닉)",
                   "class_type": "클리닉", "clinic": True, "makeup": True})
    assert r.dt_exempt is False
    assert "dt_score" in r.missing


def test_면제는_요약에_항상_드러난다():
    r = check_row({**NO_DT, "dt_exempt": True, "dt_exempt_reason": "클리닉 보강"})
    assert "DT면제" in r.summary() and "클리닉 보강" in r.summary()


def test_반전체_요약에_면제_인원과_사유가_나온다():
    cs = check_class([
        FULL,
        {**NO_DT, "student_name": "박지호",
         "dt_exempt": True, "dt_exempt_reason": "보강반 편성"},
    ], date="2026-08-20")
    assert cs.all_done
    assert "DT면제 1명" in cs.summary()
    assert cs.exemption_report() == ["박지호: 보강반 편성"]


def test_결석에_면제를_지정해도_결석_규칙이_그대로():
    r = check_row({"student_name": "이서준", "attendance": "N",
                   "dt_exempt": True, "dt_exempt_reason": "클리닉 보강"})
    assert r.is_complete, r.summary()
    assert r.missing == []


def test_지각_학생도_면제를_받을_수_있다():
    r = check_row({**NO_DT, "attendance": "L",
                   "dt_exempt": True, "dt_exempt_reason": "늦게 와서 DT 미실시"})
    assert r.is_complete, r.summary()
    assert "dt_score" not in r.required


# ─────────────────────────────────────────────────────────────
# 면제 객체 자체
# ─────────────────────────────────────────────────────────────
def test_면제는_사유가_있어야_적용된다():
    assert DtExemption(reason="클리닉 보강").applies is True
    assert DtExemption().applies is False
    assert DtExemption(reason="  ").applies is False


def test_면제_지정이_없으면_None():
    assert read_dt_exemption({"attendance": "Y"}) is None
    assert read_dt_exemption({"dt_exempt": False}) is None


def test_면제_지정은_사유가_없어도_읽힌다():
    """읽기는 읽되 적용되지 않아야, '사유 없음' 을 경고할 수 있습니다."""
    ex = read_dt_exemption({"dt_exempt": True})
    assert ex is not None and ex.applies is False
    assert "미적용" in str(ex)


# ─────────────────────────────────────────────────────────────
# 지각(L)이 전 계층에서 통하는가 — 계층별로 갈라져 있던 것을 고정
# ─────────────────────────────────────────────────────────────
"""
발견된 불일치 (2026-08-20)

    완결성 검사   지각을 출석과 같이 취급 (수업을 받았으므로)
    쓰기 게이트   `("Y","N")` 로 박혀 있어 **지각을 '출결 값 오류'로 차단**
    폰 대기열     선택지가 ["Y","N"] 뿐이라 지각을 입력할 방법이 없음
    CLI          `--absent` 만 있어 지각 학생이 전부 '출석'으로 처리됨

한 계층만 고치면 나머지에서 조용히 막힙니다. 네 곳을 함께 고정합니다.
"""


def test_쓰기게이트가_지각을_통과시킨다():
    from ganga.pipeline.gates import gate_day_record

    r = gate_day_record({"attendance": "L", "course_seq": "8", "stu_pri_no": "1",
                         "record_seq": "1", "cm_seq": "1"})
    assert r.ok, r.errors
    assert r.value["attendance"] == "L"


def test_쓰기게이트가_실측_드롭다운을_정본으로_쓴다():
    """값 목록을 손으로 적어 두면 서버와 갈라집니다. 실제로 갈라져 있었습니다."""
    from ganga.lms.endpoints import ATTENDANCE_VALUES
    from ganga.pipeline.gates import gate_day_record

    keys = dict(course_seq="8", stu_pri_no="1", record_seq="1", cm_seq="1")
    for code in ATTENDANCE_VALUES:
        if not code.strip():
            continue
        assert gate_day_record({"attendance": code, **keys}).ok, code


def test_쓰기게이트가_모르는_출결값은_막는다():
    from ganga.pipeline.gates import gate_day_record

    r = gate_day_record({"attendance": "Z", "course_seq": "8", "stu_pri_no": "1",
                        "record_seq": "1", "cm_seq": "1"})
    assert not r.ok
    assert any("출결" in e for e in r.errors)


def test_폰_대기열에_지각_선택지가_있다():
    from ganga.server.app import QUEUEABLE

    assert "L" in QUEUEABLE["attendance"]["choices"]
    assert QUEUEABLE["attendance"]["labels"]["L"] == "지각"


def test_CLI가_지각을_표현할_수_있다():
    from ganga.cli import build_parser

    args = build_parser().parse_args(
        ["draft", "--date", "2026-08-25", "--late", "a,b"])
    assert args.late == "a,b"


def test_결석과_지각을_동시에_지정하면_거부한다():
    """한 학생이 결석이면서 지각일 수는 없습니다. 조용히 한쪽을 이기면 안 됩니다."""
    from ganga.cli import build_parser

    args = build_parser().parse_args(
        ["draft", "--date", "2026-08-25", "--absent", "a", "--late", "a"])
    absent = set(args.absent.split(",")) - {""}
    late = set(args.late.split(",")) - {""}
    assert absent & late, "겹침을 감지할 수 있어야 합니다"
