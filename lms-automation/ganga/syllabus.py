# -*- coding: utf-8 -*-
"""
교재 목차 파싱과 진도 계획 산출.

교재 구조는 어디서 오나
    PDF 에 **내장 목차(TOC)** 가 들어 있습니다. `doc.get_toc()` 한 줄이면
    대단원/소단원 구조가 그대로 나옵니다. 텍스트를 정규식으로 긁을 필요가 없습니다.

    중요한 성질: **샘플교재(앞부분만 담긴 작은 PDF)에도 목차 제목은 전권 분량이
    다 들어 있습니다.** 뒤쪽 항목은 쪽번호가 1로 찍히지만 제목은 온전합니다.
    그래서 37쪽짜리 샘플로 3권 전체 커리큘럼을 알 수 있습니다.

    (이전에 "본문 PDF 는 텍스트 0자인 순수 이미지" 라고 적었던 것은 표지 한 장만
     보고 내린 잘못된 결론이었습니다. 본문에는 쪽당 200~1000자가 있습니다.)

수업 시간 모델 (선생님 실측)
    주 2회 · 회당 3~3.5시간
      - 클리닉(자습) 60분
      - **실제 진도 150분**  ← 계획의 기준 단위
    단원이 끝나면 시험 60분이 붙어 그 회차의 진도 시간은 90분으로 줄어듭니다.
    그 외에도 변수가 많으므로 계획은 **고정이 아니라 재계산 가능**해야 합니다.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .config import ASSET_DIR
from .curriculum import BookRef, canonical_section_key, section_key_collisions

# ─────────────────────────────────────────────────────────────
# 시간 모델
# ─────────────────────────────────────────────────────────────
#: 회당 총 수업시간 범위 (분). 3시간 ~ 3시간30분
SESSION_TOTAL_RANGE = (180, 210)

#: 클리닉(자습) 시간 — 진도에서 제외
CLINIC_MIN = 60

#: 회당 실제 진도 시간 범위. 총시간에서 클리닉을 뺀 값입니다.
#: 짧은 날 120분, 긴 날 150분.
TEACH_RANGE = (SESSION_TOTAL_RANGE[0] - CLINIC_MIN,
               SESSION_TOTAL_RANGE[1] - CLINIC_MIN)

#: 계획 수립의 기준값. 선생님 표현 "나머지 2시간 반이 실제 진도" 를 따릅니다.
#: (짧은 날은 120분이므로 계획이 빡빡할 수 있고, 그래서 재계산이 필요합니다.)
SESSION_TEACH_MIN = TEACH_RANGE[1]

#: 하위호환
SESSION_TOTAL_MIN = SESSION_TOTAL_RANGE[1]

#: 단원 종료 시 시험 시간. 그 회차는 진도가 그만큼 줄어듭니다.
UNIT_TEST_MIN = 60

#: 기본 주당 수업 횟수
DEFAULT_PER_WEEK = 2

#: 진도 속도별 총 개월 수
PACE_MONTHS = {"보통": (3, 4), "특수": (6, 6)}


@dataclass
class Section:
    """소단원 1개."""

    unit_no: str          # '1'  또는 'Ⅴ'
    unit_name: str        # '도형의 성질'
    section_no: str       # '1'  또는 '1-1'
    section_name: str     # '이등변삼각형의 성질'
    page: int | None = None
    #: 이 소단원이 대단원의 마지막인가 (끝나면 시험)
    is_unit_end: bool = False

    @property
    def label(self) -> str:
        return f"{self.unit_name} · {self.section_no} {self.section_name}"


@dataclass
class Syllabus:
    book: str
    source_pdf: str
    sections: list[Section] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.sections)

    @property
    def units(self) -> list[str]:
        seen: list[str] = []
        for s in self.sections:
            if s.unit_name and s.unit_name not in seen:
                seen.append(s.unit_name)
        return seen

    def to_dict(self) -> dict[str, Any]:
        return {"book": self.book, "source_pdf": self.source_pdf,
                "units": self.units, "section_count": len(self.sections),
                "sections": [asdict(s) for s in self.sections],
                "warnings": self.warnings}


# 목차에서 걸러낼 항목 (본문 소단원이 아닌 것)
_SKIP = re.compile(r"^(책갈피|정답|하브루타|\[|정답-)")

#: 대단원 구분자 — "1 대단원", "2 대단원". 소단원 묶음의 경계입니다.
_UNIT_BREAK = re.compile(r"^(\d+)\s*대단원$")

#: 초등 소단원 — "1-1 덧셈과 뺄셈/곱셈과 나눗셈이 섞여 있는 식 계산하기"
_ELEM_SEC = re.compile(r"^(\d+)-(\d+)\s+(.+)$")

#: 중등 소단원 — "1 이등변삼각형의 성질"
_MID_SEC = re.compile(r"^(\d+)\s+(.+)$")

#: 대단원 표제 — "Ⅴ. 도형의 성질"
_UNIT_HEAD = re.compile(r"^([ⅠⅡⅢⅣⅤⅥⅦⅧ]+)\.\s*(.+)$")

#: '1-1 기본' 처럼 같은 소단원의 하위 파트
_SUBPART = re.compile(r"^\d+(?:-\d+)?\s+(기본|질문|심화|응용)$")


def parse_toc(pdf: Path, book: BookRef) -> Syllabus:
    """PDF 내장 목차에서 소단원 목록을 뽑습니다."""
    try:
        import pymupdf
    except ImportError:  # pragma: no cover
        import fitz as pymupdf  # type: ignore[no-redef]

    syl = Syllabus(book=book.label(), source_pdf=pdf.name)
    doc = pymupdf.open(pdf)
    try:
        toc = doc.get_toc()
    finally:
        doc.close()

    if not toc:
        syl.warnings.append("PDF 에 내장 목차가 없습니다")
        return syl

    is_elem = book.school == "초등"

    # ⚠️ 목차 순서에 주의: 대단원 표제("Ⅴ. 도형의 성질")가 소단원보다 **뒤에**
    #    나옵니다. 표지 북마크라서 그렇습니다. 순차 처리하면 소단원이 이름을
    #    못 받아 전부 '단원' 으로 뭉개집니다. 그래서 먼저 훑어 모아둡니다.
    unit_names = [
        m.group(2).strip()
        for _l, t, _p in toc
        if (m := _UNIT_HEAD.match((t or "").strip()))
    ]

    unit_idx = 0
    cur_unit_no = ""

    def unit_label(i: int, fallback: str) -> str:
        return unit_names[i] if i < len(unit_names) else fallback

    for _lvl, title, page in toc:
        t = (title or "").strip()
        if not t or _SKIP.match(t) or _SUBPART.match(t) or _UNIT_HEAD.match(t):
            continue

        # "1 대단원" = 대단원 경계. 다음 소단원부터 다음 단원명을 씁니다.
        if _UNIT_BREAK.match(t):
            unit_idx += 1
            continue

        if is_elem:
            m = _ELEM_SEC.match(t)
            if not m:
                continue
            unit_no = m.group(1)
            sec_no, name = f"{unit_no}-{m.group(2)}", m.group(3)
            if unit_no != cur_unit_no:
                cur_unit_no = unit_no
        else:
            m = _MID_SEC.match(t)
            if not m:
                continue
            sec_no, name = m.group(1), m.group(2)
            unit_no = str(unit_idx + 1)

        syl.sections.append(Section(
            unit_no=unit_no,
            unit_name=unit_label(unit_idx, f"{unit_no}단원"),
            section_no=sec_no, section_name=name.strip(),
            page=page if page and page > 1 else None,
        ))

    # 대단원의 마지막 소단원에 시험 표시
    for i, s in enumerate(syl.sections):
        nxt = syl.sections[i + 1] if i + 1 < len(syl.sections) else None
        if nxt is None or nxt.unit_no != s.unit_no:
            s.is_unit_end = True

    if not syl.sections:
        syl.warnings.append("목차는 있으나 소단원을 하나도 인식하지 못했습니다")
    return syl


def load_syllabus(book: BookRef) -> Syllabus:
    fn = book.sample_filename()
    if not fn:
        return Syllabus(book=book.label(), source_pdf="",
                        warnings=["본문(샘플) 파일명을 만들 수 없습니다"])
    pdf = ASSET_DIR / fn
    if not pdf.exists():
        return Syllabus(book=book.label(), source_pdf=fn,
                        warnings=[f"{fn} 이 로컬에 없습니다. `ganga assets` 를 먼저 실행하세요"])
    return parse_toc(pdf, book)


# ─────────────────────────────────────────────────────────────
# 진도 계획
# ─────────────────────────────────────────────────────────────
@dataclass
class PlannedSession:
    """수업 1회차 계획."""

    index: int                  # 1부터
    sections: list[str] = field(default_factory=list)
    teach_min: int = SESSION_TEACH_MIN
    has_unit_test: bool = False
    note: str = ""


@dataclass
class Plan:
    book: str
    per_week: int
    pace: str
    total_sessions: int
    sessions: list[PlannedSession] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def weeks(self) -> float:
        return round(self.total_sessions / self.per_week, 1)

    @property
    def months(self) -> float:
        return round(self.weeks / 4.345, 1)

    def summary(self) -> str:
        n_test = sum(1 for s in self.sessions if s.has_unit_test)
        return (f"{self.book} · {self.pace} · 주 {self.per_week}회 → "
                f"{self.total_sessions}회 ({self.weeks}주 ≈ {self.months}개월), "
                f"단원시험 {n_test}회")

    def to_dict(self) -> dict[str, Any]:
        return {"book": self.book, "per_week": self.per_week, "pace": self.pace,
                "total_sessions": self.total_sessions, "weeks": self.weeks,
                "months": self.months, "warnings": self.warnings,
                "sessions": [asdict(s) for s in self.sessions]}


def target_sessions(pace: str = "보통", per_week: int = DEFAULT_PER_WEEK) -> tuple[int, int]:
    """진도 속도로부터 목표 회차 범위를 냅니다.

    보통 3~4개월 / 특수 6개월. 주 2회면 3개월≈26회, 4개월≈35회, 6개월≈52회.
    """
    lo_m, hi_m = PACE_MONTHS.get(pace, PACE_MONTHS["보통"])
    return (round(lo_m * 4.345 * per_week), round(hi_m * 4.345 * per_week))


def build_plan(
    syl: Syllabus,
    *,
    pace: str = "보통",
    per_week: int = DEFAULT_PER_WEEK,
    start_index: int = 1,
    done_sections: set[str] | None = None,
) -> Plan:
    """소단원을 회차에 배분합니다.

    `done_sections` 를 주면 **이미 나간 진도를 빼고 남은 것만** 다시 배분합니다.
    단원 끝 회차는 시험 60분이 붙어 진도 시간이 150 → 90분으로 줄어듭니다.
    즉 계획은 고정된 표가 아니라 **매번 다시 계산하는 것**입니다.

    `done_sections` 는 `canonical_section_key` 로 정규화해 대조합니다.
    선생님이 적은 소단원명("1.소인수분해")과 계획의 라벨("1. 소인수분해 (p.10~15)")
    이 공백·쪽수 표기 때문에 문자열로 어긋나 매칭이 통째로 실패하던 문제를
    막습니다. 저장된 원문은 손대지 않습니다 — 대조하는 순간에만 씁니다.
    """
    done = done_sections or set()
    plan = Plan(book=syl.book, per_week=per_week, pace=pace, total_sessions=0)

    if not done:
        # 나간 진도가 없으면 대조할 것도 없습니다. 정규화 경로를 아예 타지
        # 않게 해서 "진도 기록이 없을 때"의 동작을 이전과 완전히 같게 둡니다.
        remaining = list(syl.sections)
    elif (collisions := section_key_collisions(s.label for s in syl.sections)):
        # 정규화가 서로 다른 소단원을 같은 키로 뭉개면 그 소단원이 계획에서
        # **통째로 사라집니다.** 이 프로젝트의 실패 정의가 "빠뜨리는 것" 이므로
        # 충돌이 하나라도 있으면 정규화를 포기하고 원문 그대로 비교합니다.
        plan.warnings.append(
            "소단원 라벨 정규화가 충돌해 원문 비교로 되돌립니다: "
            + " / ".join(" = ".join(v) for v in collisions.values()))
        remaining = [s for s in syl.sections if s.label not in done]
    else:
        done_keys = {canonical_section_key(d) for d in done} - {""}
        remaining = [s for s in syl.sections
                     if canonical_section_key(s.label) not in done_keys]

    if not remaining:
        plan.warnings.append("남은 소단원이 없습니다 (전부 완료)")
        return plan

    lo, hi = target_sessions(pace, per_week)
    target = (lo + hi) // 2

    # 이미 나간 진도가 있으면 목표 회차도 남은 분량만큼 줄여야 합니다.
    # 고정 목표를 그대로 쓰면 소단원을 3개 끝내고도 "앞으로 30회" 라는
    # 이상한 답이 나옵니다.
    if done and syl.sections:
        ratio = len(remaining) / len(syl.sections)
        target = max(1, round(target * ratio))
        lo, hi = max(1, round(lo * ratio)), max(1, round(hi * ratio))

    # 소단원 수(11~12)보다 목표 회차(26~35)가 훨씬 많습니다.
    # 즉 **소단원 1개를 여러 회차에 걸쳐** 나갑니다. 회차당 소단원 수가 아니라
    # 소단원당 회차 수를 배분해야 합니다. (초기 구현이 이걸 거꾸로 잡았습니다.)
    n_units = sum(1 for s in remaining if s.is_unit_end)   # 단원시험 회차 수
    teach_slots = max(1, target - n_units)                  # 시험 전용 회차 제외
    base = teach_slots // len(remaining)
    extra = teach_slots % len(remaining)                     # 앞쪽 소단원에 1회씩 더

    idx = start_index
    for i, sec in enumerate(remaining):
        reps = base + (1 if i < extra else 0)
        for r in range(max(1, reps)):
            plan.sessions.append(PlannedSession(
                index=idx, sections=[sec.label],
                teach_min=SESSION_TEACH_MIN,
                note=f"{r + 1}/{max(1, reps)}차시" if reps > 1 else "",
            ))
            idx += 1
        if sec.is_unit_end:
            # 단원이 끝나면 시험 회차. 진도 시간이 150 → 90분으로 줄어듭니다.
            plan.sessions.append(PlannedSession(
                index=idx, sections=[f"{sec.unit_name} 단원 마무리"],
                teach_min=SESSION_TEACH_MIN - UNIT_TEST_MIN,
                has_unit_test=True, note="단원 마무리 + 시험 60분",
            ))
            idx += 1

    plan.total_sessions = len(plan.sessions)
    if not (lo <= plan.total_sessions <= hi):
        plan.warnings.append(
            f"산출 {plan.total_sessions}회가 목표 범위({lo}~{hi}회)를 벗어납니다"
        )
    return plan


def rebuild_from_progress(syl: Syllabus, done_labels: list[str], **kw) -> Plan:
    """실제 나간 진도를 반영해 남은 계획을 다시 짭니다.

    결석·보강·시험으로 일정이 밀려도 이 함수를 다시 부르면 됩니다.
    """
    return build_plan(syl, done_sections=set(done_labels), **kw)
