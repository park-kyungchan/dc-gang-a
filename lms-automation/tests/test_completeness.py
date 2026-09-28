# -*- coding: utf-8 -*-
"""
완결성·정합성 게이트 테스트.

성공 기준이 "빠뜨리지 않는 것" 이므로 여기 테스트가 가장 중요합니다.
특히 **누락을 놓치는 것**(false negative)이 가장 위험한 실패입니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.pipeline.completeness import (  # noqa: E402
    Attendance,
    check_class,
    check_row,
    clinic_targets,
    judge_dt,
)

FULL = {
    "student_name": "김민준",
    "attendance": "Y",
    "dt_score": 9,
    "progress_text": "p.31 실력쌓기 5~8번",
    "homework_text": "p.32 1~6번",
    "daily_memo": "약분 원리를 스스로 설명함",
}


# ─────────────────────────────────────────────────────────────
# 1층 완결성
# ─────────────────────────────────────────────────────────────
def test_다_채우면_완료():
    r = check_row(FULL)
    assert r.is_complete, r.summary()
    assert r.missing == []
    assert r.progress_mark == "●●●●●"


@pytest.mark.parametrize(
    "drop", ["dt_score", "progress_text", "homework_text", "daily_memo"])
def test_하나라도_빠지면_잡아낸다(drop):
    p = {k: v for k, v in FULL.items() if k != drop}
    r = check_row(p)
    assert not r.is_complete
    assert drop in r.missing


def test_빈문자열은_채운것이_아니다():
    r = check_row({**FULL, "progress_text": "   "})
    assert "progress_text" in r.missing


def test_점수_0은_채운것으로_본다():
    """0점은 유효한 입력입니다. falsy 판정을 쓰면 0점이 '미입력'이 됩니다."""
    r = check_row({**FULL, "dt_score": 0})
    assert r.filled["dt_score"] is True
    assert "dt_score" not in r.missing
    assert r.is_complete


def test_출결이_없으면_먼저_정하라고_한다():
    p = {k: v for k, v in FULL.items() if k != "attendance"}
    r = check_row(p)
    assert not r.is_complete
    assert "attendance" in r.missing
    assert any("출결을 먼저" in c for c in r.conflicts)


def test_진행표시가_채운만큼_늘어난다():
    assert check_row({"attendance": "Y", "student_name": "가"}).progress_mark == "●○○○○"
    assert check_row({**FULL, "daily_memo": ""}).progress_mark == "●●●●○"


# ─────────────────────────────────────────────────────────────
# 결석 — 필수 항목이 달라진다
# ─────────────────────────────────────────────────────────────
def test_결석은_출결만_있으면_완료():
    r = check_row({"student_name": "이서준", "attendance": "N"})
    assert r.attendance is Attendance.ABSENT
    assert r.is_complete, r.summary()
    assert r.missing == []


def test_결석인데_진도가_있으면_모순():
    r = check_row({"student_name": "이서준", "attendance": "N",
                   "progress_text": "p.31 완료"})
    assert not r.is_complete
    assert any("결석인데" in c for c in r.conflicts)


def test_결석인데_DT점수가_있으면_모순():
    r = check_row({"student_name": "이서준", "attendance": "N", "dt_score": 8})
    assert any("결석인데" in c for c in r.conflicts)


def test_결석은_진도_미입력을_누락으로_보지_않는다():
    """결석 학생에게 진도를 요구하면 잘못된 경고가 쏟아집니다."""
    r = check_row({"student_name": "이서준", "attendance": "N"})
    assert "progress_text" not in r.missing
    assert "dt_score" not in r.missing


# ─────────────────────────────────────────────────────────────
# 2층 정합성
# ─────────────────────────────────────────────────────────────
def test_점수_범위_초과를_잡는다():
    assert any("허용 범위" in c for c in check_row({**FULL, "dt_score": 99}).conflicts)
    assert any("허용 범위" in c for c in check_row({**FULL, "hw_rate": 9}).conflicts)


def test_숫자가_아닌_점수를_잡는다():
    r = check_row({**FULL, "dt_score": "잘함"})
    assert any("숫자로 읽을 수 없" in c for c in r.conflicts)


def test_길이초과는_차단이_아니라_참고정보다():
    """예전엔 "서버가 잘라냅니다" 라며 전송을 막았습니다. **사실이 아닙니다.**

    서버는 자르지 않습니다(실측: 250자 그대로 저장). 자르던 것은 우리
    게이트였고 그것도 없앴습니다. 없는 위험을 근거로 선생님이 길게 쓴
    메모를 못 보내게 하고 있었습니다.
    """
    r = check_row({**FULL, "progress_text": "가" * 250})
    assert not r.conflicts, f"길이 때문에 전송이 막힙니다: {r.conflicts}"
    assert r.is_complete
    assert any("화면 기준" in n for n in r.notes)


def test_짧으면_참고정보도_없다():
    r = check_row({**FULL, "progress_text": "이등변삼각형의 성질"})
    assert not r.notes
    assert r.is_complete


def test_아무리_길어도_완결_판정을_막지_않는다():
    for n in (200, 201, 1000):
        assert check_row({**FULL, "progress_text": "가" * n}).is_complete, n


# ─────────────────────────────────────────────────────────────
# 반 전체
# ─────────────────────────────────────────────────────────────
def test_반전체_요약():
    cs = check_class([
        FULL,
        {"student_name": "이서준", "attendance": "N"},
        {"student_name": "박지호", "attendance": "Y", "dt_score": 7},
    ], date="2026-08-20")
    assert cs.total == 3
    assert cs.complete == 2
    assert len(cs.incomplete) == 1
    assert len(cs.absent) == 1
    assert not cs.all_done
    assert "2/3 완료" in cs.summary()
    assert "결석 1명" in cs.summary()


def test_전원완료면_all_done():
    cs = check_class([FULL, {"student_name": "이서준", "attendance": "N"}])
    assert cs.all_done


def test_학생이_없으면_all_done이_아니다():
    """행이 0개인 것을 '다 했다'로 보면 안 됩니다."""
    assert not check_class([], date="2026-08-20").all_done


def test_미완_보고서에_이름과_누락항목이_나온다():
    cs = check_class([{"student_name": "박지호", "attendance": "Y", "dt_score": 7}])
    rep = cs.missing_report()
    assert len(rep) == 1
    assert "박지호" in rep[0]
    assert "진도" in rep[0] and "숙제" in rep[0]


# ─────────────────────────────────────────────────────────────
# DT 판정 — 기준점은 사용자가 정한다
# ─────────────────────────────────────────────────────────────
def test_기준점은_하드코딩되어_있지_않다():
    """회차마다 문항수·난이도가 달라 기준이 바뀝니다."""
    scores = {"김민준": 8, "이서준": 7}
    strict = judge_dt(scores, threshold=9)
    loose = judge_dt(scores, threshold=7)
    assert [r.passed for r in strict] == [False, False]
    assert [r.passed for r in loose] == [True, True]


def test_기준점_미달은_ZT_클리닉_대상():
    rs = judge_dt({"김민준": 9, "이서준": 6, "박지호": 8}, threshold=8)
    assert clinic_targets(rs) == ["이서준"]


def test_기준점과_같으면_통과():
    assert judge_dt({"가": 8}, threshold=8)[0].passed


def test_백분율_환산():
    r = judge_dt({"가": 8}, threshold=8)[0]
    assert r.percent == 80


def test_범위밖_기준점은_예외():
    with pytest.raises(ValueError):
        judge_dt({"가": 5}, threshold=11)
    with pytest.raises(ValueError):
        judge_dt({"가": 5}, threshold=-1)


def test_점수는_범위로_클램프된다():
    assert judge_dt({"가": 99}, threshold=8)[0].score == 10


def test_숫자가_아닌_점수는_제외된다():
    """조용히 0점으로 만들지 않고 아예 빼서, 나중에 누락으로 드러나게 합니다."""
    rs = judge_dt({"가": 8, "나": "미응시"}, threshold=8)
    assert [r.student for r in rs] == ["가"]


def test_요약문():
    assert "Fail → ZT 클리닉" in judge_dt({"가": 5}, threshold=8)[0].summary()
    assert "Pass" in judge_dt({"가": 9}, threshold=8)[0].summary()
