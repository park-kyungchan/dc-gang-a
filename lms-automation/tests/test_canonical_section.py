# -*- coding: utf-8 -*-
"""
소단원 라벨 정규화 (제안 P-05).

여기서 지키는 것은 두 가지이고, 둘은 서로 반대 방향입니다.

  1. **붙일 것은 붙인다** — 표기만 다른 같은 소단원이 매칭에 실패하면 안 됩니다.
     "1. 소인수분해 (p.10~15)" 와 "1.소인수분해" 는 같은 것입니다.

  2. **가를 것은 가른다** — 의미가 다른 것을 같은 키로 뭉개면 안 됩니다.
     `단원평가` 와 `단원평가(선행)` 은 **다른 시험**입니다
     (`ganga/lms/endpoints.py` 의 EXAM_TYPES). 원래 제안대로 괄호를 통째로
     지웠다면 이 둘이 같은 키가 됩니다. 그래서 지우지 않았고, 이 파일이
     그 결정을 고정합니다.

그리고 세 번째, 지금 당장의 안전:

  3. **현재 교재에는 괄호 포함 소단원이 0건**이므로 이 기능은 지금 아무것도
     바꾸면 안 됩니다. 정규화 도입 전후로 매칭 결과가 동일한지 고정합니다.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ganga.curriculum import (  # noqa: E402
    canonical_section_key,
    section_key_collisions,
)
from ganga.syllabus import Section, Syllabus, build_plan  # noqa: E402

#: 실측 소단원명 (data/problem_index.db 의 lectures 테이블, 2026-08-20)
REAL_SECTIONS = ("이등변삼각형의 성질", "직각삼각형의 합동")


def make_syl(names: tuple[str, ...] = REAL_SECTIONS) -> Syllabus:
    s = Syllabus(book="테스트 교재", source_pdf="test.pdf")
    for i, name in enumerate(names, start=1):
        s.sections.append(Section(
            unit_no="1", unit_name="도형의 성질",
            section_no=str(i), section_name=name,
            is_unit_end=(i == len(names)),
        ))
    return s


def planned_labels(plan) -> set[str]:
    """계획에 실제로 배분된 소단원 라벨 (시험 회차 제외)."""
    return {x for s in plan.sessions for x in s.sections
            if not x.endswith("단원 마무리")}


# ─────────────────────────────────────────────────────────────
# 1. 붙일 것은 붙인다
# ─────────────────────────────────────────────────────────────
def test_쪽수표기와_공백만_다르면_같은_키():
    assert canonical_section_key("1. 소인수분해 (p.10~15)") == \
           canonical_section_key("1.소인수분해")


@pytest.mark.parametrize("label", [
    "1. 소인수분해 (p.10~15)",
    "1. 소인수분해 (p10-15)",
    "1. 소인수분해(10~15쪽)",
    "1. 소인수분해 (15p)",
    "1. 소인수분해 (pp.10~15)",
    "1. 소인수분해 (10~15페이지)",
    "1. 소인수분해 （p.10~15）",     # 전각 괄호
    "1. 소인수분해 (p.10～15)",       # 전각 물결
    "1) 소인수분해",
    "01. 소인수분해",
    "제1절 소인수분해",
    "(1) 소인수분해",
    "  1.  소인수분해  ",
])
def test_같은_소단원의_여러_표기가_한_키로_모인다(label):
    assert canonical_section_key(label) == "1소인수분해", label


# ─────────────────────────────────────────────────────────────
# 2. 가를 것은 가른다 — 이 파일의 핵심
# ─────────────────────────────────────────────────────────────
def test_의미있는_괄호는_지우지_않는다():
    """원래 제안(`re.sub(r"\\(.*?\\)", "", label)`)이 위험한 이유.

    괄호를 통째로 지우면 서로 다른 시험이 같은 키가 됩니다. 진도·시험을
    빠뜨리는 것이 이 프로젝트의 실패 정의이므로 여기서 막습니다.
    """
    assert canonical_section_key("단원평가(선행)") != canonical_section_key("단원평가")
    assert canonical_section_key("일일평가(선행)") != canonical_section_key("일일평가")
    assert canonical_section_key("단원평가(초등)") != canonical_section_key("단원평가(선행)")


def test_실제_시험명_전체가_서로_다른_키를_갖는다():
    """EXAM_TYPES 에 실재하는 이름들이 하나도 뭉개지지 않아야 합니다."""
    from ganga.lms.endpoints import EXAM_TYPES

    names = [n for v in EXAM_TYPES.values() for n in v]
    assert names, "EXAM_TYPES 가 비었습니다"
    assert section_key_collisions(names) == {}


@pytest.mark.parametrize("label", [
    "소인수분해(1~3)",        # 쪽수 표시가 없어 애매 → 보존
    "소인수분해(2015 개정)",   # 숫자는 있으나 쪽수 표시 없음 → 보존
    "소인수분해(2단원 p.10)",  # 쪽수 밖의 정보가 섞임 → 보존
    "소인수분해(3단계)",
    "소인수분해(심화)",
])
def test_애매한_괄호는_보존한다(label):
    """지우는 것은 되돌릴 수 없는 정보 손실이라 보존 쪽으로 기웁니다."""
    assert "(" in canonical_section_key(label), label


def test_번호는_표기만_정규화하고_값은_남긴다():
    """'1. 소인수분해' 와 '2. 소인수분해' 는 다른 소단원입니다."""
    assert canonical_section_key("1. 소인수분해") != canonical_section_key("2. 소인수분해")
    assert "1" in canonical_section_key("01) 소인수분해")


# ─────────────────────────────────────────────────────────────
# 3. 빈 값 안전
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bad", ["", "   ", None, 0, 123, [], {}])
def test_빈값과_비문자열이_안전하다(bad):
    assert canonical_section_key(bad) == ""


def test_빈_키는_충돌로_세지_않는다():
    """빈 라벨 여러 개가 '충돌' 로 잡히면 정규화가 늘 꺼집니다."""
    assert section_key_collisions(["", None, "   "]) == {}


# ─────────────────────────────────────────────────────────────
# 4. 충돌 검사 — 서로 다른 소단원을 뭉개지 않는가
# ─────────────────────────────────────────────────────────────
def test_실제_소단원명이_서로_충돌하지_않는다():
    assert section_key_collisions(REAL_SECTIONS) == {}
    assert canonical_section_key(REAL_SECTIONS[0]) != canonical_section_key(REAL_SECTIONS[1])


def test_실제_소단원_라벨도_충돌하지_않는다():
    syl = make_syl()
    assert section_key_collisions(s.label for s in syl.sections) == {}


def test_충돌이_있으면_찾아낸다():
    """검사기 자체가 동작하는지. (표기만 다른 같은 번호)"""
    got = section_key_collisions(["1. 소인수분해", "1) 소인수분해", "2. 소인수분해"])
    assert list(got) == ["1소인수분해"]
    assert len(got["1소인수분해"]) == 2


# ─────────────────────────────────────────────────────────────
# 5. 지금 당장은 아무것도 바뀌지 않아야 한다
# ─────────────────────────────────────────────────────────────
def test_현재_교재_목차에_괄호_포함_소단원이_0건():
    """전제 확인. 이게 깨지면 위 회귀 테스트들의 전제가 무너집니다."""
    from ganga.config import INDEX_DB

    if not INDEX_DB.exists():
        pytest.skip(f"{INDEX_DB.name} 없음 — `ganga index` 실행 필요")
    conn = sqlite3.connect(INDEX_DB)
    try:
        names = [r[0] for r in conn.execute(
            "SELECT DISTINCT section_name FROM lectures WHERE section_name IS NOT NULL")]
    finally:
        conn.close()
    assert names, "lectures 테이블에 소단원명이 없습니다"
    with_paren = [n for n in names if "(" in n or ")" in n or "（" in n or "）" in n]
    assert with_paren == [], f"괄호 포함 소단원이 생겼습니다: {with_paren}"
    assert section_key_collisions(names) == {}


@pytest.mark.parametrize("names", [
    REAL_SECTIONS,
    ("소단원1", "소단원2", "소단원3", "소단원4"),
    ("1-1 덧셈과 뺄셈", "1-2 곱셈과 나눗셈"),
])
def test_정규화_전후로_매칭_결과가_같다(names):
    """정규화 도입 전 동작(원문 정확 일치)과 결과가 동일한지 고정합니다.

    현재 라벨에는 쪽수 괄호도 표기 흔들림도 없으므로 결과가 달라지면
    그건 개선이 아니라 회귀입니다.
    """
    syl = make_syl(names)
    labels = [s.label for s in syl.sections]
    # 완료분의 모든 부분집합에 대해 확인 (빠뜨리는 조합이 없도록)
    for mask in range(1 << len(labels)):
        done = {lbl for i, lbl in enumerate(labels) if mask >> i & 1}
        expected = {lbl for lbl in labels if lbl not in done}   # 정규화 이전 로직
        plan = build_plan(syl, pace="보통", done_sections=done)
        assert planned_labels(plan) == expected, (done, plan.warnings)


def test_진도기록이_없으면_경고도_그대로_없다():
    """정규화 경로가 없던 경고를 새로 만들지 않는지."""
    plan = build_plan(make_syl(("소단원1", "소단원2", "소단원3", "소단원4")),
                      pace="보통", per_week=2)
    assert not plan.warnings, plan.warnings


def test_표기가_흔들린_기록도_매칭된다():
    """개선 자체의 확인 — 이전에는 매칭에 실패하던 입력."""
    syl = make_syl()
    done = {"도형의 성질·1 이등변삼각형의 성질 (p.10~15)"}   # 공백·쪽수가 다름
    plan = build_plan(syl, pace="보통", done_sections=done)
    assert syl.sections[0].label not in planned_labels(plan)
    assert syl.sections[1].label in planned_labels(plan)


def test_충돌하는_목차에서는_정규화를_포기하고_경고한다():
    """뭉개서 빠뜨리느니 예전 동작으로 되돌아갑니다. 애매하면 실패로 판정."""
    syl = make_syl()
    syl.sections[1].section_no = "1"          # 라벨이 1번과 같아지도록 조작
    syl.sections[1].section_name = "이등변삼각형의성질"
    done = {syl.sections[0].label}
    plan = build_plan(syl, pace="보통", done_sections=done)
    assert any("정규화가 충돌" in w for w in plan.warnings), plan.warnings
    # 원문 비교로 되돌아갔으므로 2번 소단원은 계획에 남아 있어야 합니다.
    assert syl.sections[1].label in planned_labels(plan)
