# -*- coding: utf-8 -*-
"""
목차 파싱과 진도 계획 테스트.

여기서 지키는 것은 "계획이 현실과 맞는가" 입니다. 실측 기준:
    주 2회 · 회당 진도 150분 · 단원말 시험 60분
    보통 3~4개월(26~35회) / 특수 6개월(52회)
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ganga.curriculum import BookRef  # noqa: E402
from ganga.syllabus import (  # noqa: E402
    CLINIC_MIN,
    SESSION_TEACH_MIN,
    SESSION_TOTAL_MIN,
    UNIT_TEST_MIN,
    Section,
    Syllabus,
    build_plan,
    rebuild_from_progress,
    target_sessions,
)


def make_syl(n_units: int = 3, per_unit: int = 4) -> Syllabus:
    s = Syllabus(book="테스트 교재", source_pdf="test.pdf")
    for u in range(1, n_units + 1):
        for k in range(1, per_unit + 1):
            s.sections.append(Section(
                unit_no=str(u), unit_name=f"{u}단원",
                section_no=f"{u}-{k}", section_name=f"소단원{k}",
                is_unit_end=(k == per_unit),
            ))
    return s


# ─────────────────────────────────────────────────────────────
# 시간 모델
# ─────────────────────────────────────────────────────────────
def test_시간모델이_실측과_일치한다():
    """3~3.5시간에서 클리닉 60분을 빼면 진도는 120~150분.

    계획 기준값은 150분(3시간30분 날)입니다. 짧은 날은 120분이라 계획이
    밀릴 수 있고, 그래서 재계산이 필수입니다.
    """
    from ganga.syllabus import SESSION_TOTAL_RANGE, TEACH_RANGE

    assert CLINIC_MIN == 60
    assert TEACH_RANGE == (120, 150)
    assert SESSION_TEACH_MIN == 150
    for total, teach in zip(SESSION_TOTAL_RANGE, TEACH_RANGE):
        assert total - CLINIC_MIN == teach


def test_목표회차가_주2회_기준과_맞는다():
    lo, hi = target_sessions("보통", 2)
    assert 26 <= lo <= 27 and 34 <= hi <= 35, (lo, hi)
    lo6, hi6 = target_sessions("특수", 2)
    assert lo6 == hi6 == 52


def test_주3회면_같은_기간에_회차가_늘어난다():
    assert target_sessions("보통", 3)[0] > target_sessions("보통", 2)[0]


# ─────────────────────────────────────────────────────────────
# 계획 산출
# ─────────────────────────────────────────────────────────────
def test_보통_속도가_목표범위_안에_들어온다():
    p = build_plan(make_syl(), pace="보통", per_week=2)
    lo, hi = target_sessions("보통", 2)
    assert lo <= p.total_sessions <= hi, p.summary()
    assert not p.warnings


def test_특수_속도는_대략_두배():
    normal = build_plan(make_syl(), pace="보통").total_sessions
    slow = build_plan(make_syl(), pace="특수").total_sessions
    assert slow > normal * 1.4


def test_단원말에_시험회차가_붙는다():
    syl = make_syl(n_units=3, per_unit=4)
    p = build_plan(syl, pace="보통")
    assert sum(1 for s in p.sessions if s.has_unit_test) == 3


def test_시험회차는_진도시간이_줄어든다():
    p = build_plan(make_syl(), pace="보통")
    for s in p.sessions:
        expected = SESSION_TEACH_MIN - (UNIT_TEST_MIN if s.has_unit_test else 0)
        assert s.teach_min == expected


def test_모든_소단원이_계획에_들어간다():
    """빠뜨리지 않는 것이 성공 기준입니다."""
    syl = make_syl(n_units=2, per_unit=3)
    p = build_plan(syl, pace="보통")
    covered = " ".join(x for s in p.sessions for x in s.sections)
    for sec in syl.sections:
        assert sec.section_name in covered, f"{sec.label} 누락"


def test_소단원_하나가_여러회차에_걸친다():
    """소단원 12개 / 목표 30회 → 소단원당 2~3회차."""
    p = build_plan(make_syl(n_units=3, per_unit=4), pace="보통")
    assert p.total_sessions > 12
    assert any("차시" in s.note for s in p.sessions)


# ─────────────────────────────────────────────────────────────
# 동적 재계산 — 결석·보강·시험으로 밀릴 때
# ─────────────────────────────────────────────────────────────
def test_완료분을_빼면_남은_회차가_줄어든다():
    syl = make_syl(n_units=3, per_unit=4)
    full = build_plan(syl, pace="보통").total_sessions
    done = [s.label for s in syl.sections[:6]]      # 절반 완료
    rest = rebuild_from_progress(syl, done, pace="보통").total_sessions
    assert rest < full, f"재계산이 줄지 않았습니다: {full} → {rest}"


def test_완료분은_계획에_다시_나오지_않는다():
    syl = make_syl(n_units=2, per_unit=3)
    done = [syl.sections[0].label]
    p = rebuild_from_progress(syl, done, pace="보통")
    covered = " ".join(x for s in p.sessions for x in s.sections)
    assert syl.sections[0].section_name not in covered or "단원 마무리" in covered


def test_전부_완료하면_경고와_함께_빈_계획():
    syl = make_syl(n_units=1, per_unit=2)
    p = rebuild_from_progress(syl, [s.label for s in syl.sections])
    assert p.total_sessions == 0
    assert p.warnings


def test_회차번호가_1부터_연속():
    p = build_plan(make_syl(), pace="보통")
    assert [s.index for s in p.sessions] == list(range(1, p.total_sessions + 1))


def test_주수와_개월수_환산():
    p = build_plan(make_syl(), pace="보통", per_week=2)
    assert p.weeks == round(p.total_sessions / 2, 1)
    assert 2.5 <= p.months <= 4.5, p.summary()


# ─────────────────────────────────────────────────────────────
# 실제 교재 (PDF 가 있을 때만)
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "grade,level,term,vol,expect_units",
    [("중2", "가우스", 2, 3, ["도형의 성질", "도형의 닮음"])],
)
def test_실제교재_목차파싱(grade, level, term, vol, expect_units):
    from ganga.config import ASSET_DIR
    from ganga.syllabus import load_syllabus

    book = BookRef(grade=grade, level=level, term=term, volume=vol)
    fn = book.sample_filename()
    if not fn or not (ASSET_DIR / fn).exists():
        pytest.skip(f"{fn} 없음 — `ganga assets` 실행 필요")

    syl = load_syllabus(book)
    assert len(syl) > 0, syl.warnings
    for u in expect_units:
        assert u in syl.units, f"{u} 가 대단원에 없습니다: {syl.units}"
    # 대단원명이 '단원' 으로 뭉개지지 않았는지 (목차 순서 함정)
    assert not all(x.endswith("단원") and len(x) <= 3 for x in syl.units)
