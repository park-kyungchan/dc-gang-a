# -*- coding: utf-8 -*-
"""
교재 체계와 난이도 별칭.

강의하는아이들은 같은 난이도를 두 가지 이름으로 부릅니다.

    중등에서 쓰는 시리즈명  ↔  초등에서 쓰는 난이도명
        시그마              ↔      기본
        가우스              ↔      발전
        다빈치              ↔      심화
        오일러              ↔      최상위
        파스칼              ↔      (대응 없음)

그래서 "초5-1 가우스" 라고 말해도 서버에서는 "초5 발전" 으로 찾아야 합니다.
이 모듈이 그 변환을 담당합니다.

⚠️ 파일명과의 충돌
    초등부 **개념연산** 의 실제 파일명은 `g{n}_sigma_answer.pdf` 입니다.
    즉 파일명의 `sigma` 는 '개념연산' 이고, 난이도 별칭의 '시그마' 는 '기본'
    입니다. 둘이 어긋납니다. 이 모듈은 **파일명을 정본**으로 삼고, 별칭은
    검색 편의를 위한 층으로만 씁니다.
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

#: 시리즈명 → 초등 난이도명 (사용자 지정)
SERIES_TO_LEVEL: dict[str, str] = {
    "시그마": "기본",
    "가우스": "발전",
    "다빈치": "심화",
    "오일러": "최상위",
}

#: 역방향
LEVEL_TO_SERIES: dict[str, str] = {v: k for k, v in SERIES_TO_LEVEL.items()}

#: 난이도명 → 파일명 조각 (실측 정본)
LEVEL_TO_SLUG: dict[str, str] = {
    "기본": "basic",
    "발전": "develop",
    "심화": "ability",
    "최상위": "highest",
    "개념연산": "sigma",        # ⚠️ 별칭 '시그마'(=기본) 와 다름
    "단원마무리 하부르타": "basic_havruta",
}

#: 중등 시리즈명 → 파일명 조각 (중등은 시리즈명이 그대로 파일명)
SERIES_TO_SLUG: dict[str, str] = {
    "시그마": "sigma",
    "가우스": "gauss",
    "다빈치": "davinci",
    "오일러": "euler",
    "파스칼": "pascal",
    "가우스플러스": "gaussplus",
    "내신대비": "excellent",
}


def canonical_level(name: str, *, school: str = "초등") -> str:
    """사용자가 부르는 이름을 서버 표기로 바꿉니다.

    >>> canonical_level("가우스", school="초등")
    '발전'
    >>> canonical_level("가우스", school="중등")
    '가우스'
    """
    name = (name or "").strip()
    if school.startswith("초"):
        return SERIES_TO_LEVEL.get(name, name)
    return name


def aliases_for(name: str) -> set[str]:
    """검색용 별칭 집합. '발전' 을 찾을 때 '가우스' 로도 걸리게."""
    name = (name or "").strip()
    out = {name}
    if name in SERIES_TO_LEVEL:
        out.add(SERIES_TO_LEVEL[name])
    if name in LEVEL_TO_SERIES:
        out.add(LEVEL_TO_SERIES[name])
    return {a for a in out if a}


# ─────────────────────────────────────────────────────────────
# 소단원 라벨 정규화
# ─────────────────────────────────────────────────────────────
# 진도 계획의 소단원명과 실제 기록한 소단원명이 문자열로 정확히 일치하지 않아
# 매칭이 실패하는 일이 있습니다. ("1. 소인수분해 (p.10~15)" 와 "1.소인수분해")
# 여기서 비교용 키를 만듭니다. **원문을 고쳐 저장하지는 않습니다** — 선생님이
# 적은 문장이 기록의 정본이고, 정규화는 비교하는 순간에만 씁니다.
#
# ⚠️ 괄호를 통째로 지우지 않는 이유 (이 함수의 핵심 판단)
#     원래 제안은 `re.sub(r"\(.*?\)", "", label)` 로 괄호를 전부 지우라고
#     했지만, 교재 체계에는 **의미를 담은 괄호**가 실재합니다.
#     `ganga/lms/endpoints.py` 의 EXAM_TYPES 를 보세요.
#         단원평가 / 단원평가(선행) / 단원평가(초등)
#         일일평가 / 일일평가(선행)
#     이것들은 서로 다른 시험입니다. 괄호를 통째로 지우면 전부 같은 키가 되어
#     **다른 시험을 같은 것으로 뭉갭니다.** 진도를 빠뜨리는 것이 이 프로젝트의
#     실패 정의이므로, 지우는 쪽이 아니라 남기는 쪽으로 기울입니다.
#
#     그래서 "쪽수 표기가 확실한 괄호"만 지웁니다. 판단 기준은 아래 3개를
#     **전부** 만족하는가 입니다.
#         ① 괄호 안에 숫자가 있다
#         ② 쪽수 표시(p / pp / 쪽 / 페이지)가 있다
#         ③ 나머지가 숫자와 구분자(. , ~ -)뿐이다
#     하나라도 어긋나면 애매한 것으로 보고 **보존**합니다.
#     예: "(선행)" 은 ①에서 탈락, "(2015 개정)" 은 ②에서 탈락,
#         "(2단원 p.10)" 은 ③에서 탈락 → 셋 다 보존.

#: 전각 괄호·물결. 지우는 게 아니라 ASCII 로 **바꾸기만** 합니다.
#: (unicodedata.NFKC 를 쓰지 않은 이유: NFKC 는 대단원 표제에 쓰는 로마숫자
#:  'Ⅴ' 를 라틴 'V' 로 바꾸는 등 부작용 범위가 너무 넓습니다. 실측하지 않은
#:  변환을 통째로 켜는 대신 필요한 문자만 명시합니다.)
_CHAR_MAP = str.maketrans({
    "（": "(", "）": ")",
    "～": "~", "〜": "~",
    "–": "-", "—": "-", "−": "-",
})

#: 가장 안쪽 괄호 한 쌍. 중첩 괄호는 실재하지 않아 다루지 않습니다.
_PAREN = re.compile(r"\(([^()]*)\)")

#: 쪽수 표시. 'p' 'p.' 'pp.' '쪽' '페이지'
_PAGE_MARK = re.compile(r"pp?\.?|쪽|페이지", re.IGNORECASE)

#: 숫자와 구분자만 남았는가
_ONLY_SEP = re.compile(r"[\s0-9.,~\-]*")

#: "제1절", "제 2 장" → "1", "2"
_LEAD_JE = re.compile(r"^\s*제\s*0*(\d+)\s*[절장과편]\s*")

#: "(1) 소인수분해" → "1 소인수분해"
_LEAD_PAREN = re.compile(r"^\s*\(\s*0*(\d+)\s*\)\s*")

#: "1." "01." "1)" "1、" → "1"
#: 뒤에 숫자가 오면(예: "1.5 배") 번호 표기가 아니므로 건드리지 않습니다.
_LEAD_DOT = re.compile(r"^\s*0*(\d+)\s*[.．。、)]\s*(?!\d)")

_WS = re.compile(r"\s+")


def _is_page_note(inner: str) -> bool:
    """괄호 안 문자열이 '쪽수 표기가 확실한가'. 애매하면 False(=보존)."""
    s = inner.strip()
    if not s or not re.search(r"\d", s):
        return False                    # ① 숫자 없음 → "(선행)" 같은 의미 괄호
    if not _PAGE_MARK.search(s):
        return False                    # ② 쪽수 표시 없음 → "(1~3)" 은 애매 → 보존
    # ③ 쪽수 표시를 걷어내고 숫자·구분자만 남는가
    return _ONLY_SEP.fullmatch(_PAGE_MARK.sub("", s)) is not None


def _strip_page_parens(text: str) -> str:
    return _PAREN.sub(lambda m: "" if _is_page_note(m.group(1)) else m.group(0), text)


def _normalize_leading_number(text: str) -> str:
    """앞머리 번호 표기를 숫자만 남깁니다. 번호 자체는 **지우지 않습니다.**

    '1. 소인수분해' 와 '2. 소인수분해' 는 다른 소단원이므로 번호를 버리면
    안 됩니다. 버리는 것은 표기 방식(`.` `)` `제…절`, 앞자리 0)뿐입니다.
    """
    for rx in (_LEAD_JE, _LEAD_PAREN, _LEAD_DOT):
        m = rx.match(text)
        if m:
            return m.group(1) + text[m.end():]
    return text


def canonical_section_key(label: str | None) -> str:
    """소단원 라벨을 비교용 키로 바꿉니다. 매칭할 때만 쓰는 값입니다.

    >>> canonical_section_key("1. 소인수분해 (p.10~15)")
    '1소인수분해'
    >>> canonical_section_key("1.소인수분해")
    '1소인수분해'
    >>> canonical_section_key("단원평가(선행)") == canonical_section_key("단원평가")
    False
    >>> canonical_section_key(None)
    ''
    """
    if not isinstance(label, str):
        return ""                       # None 도, 실수로 들어온 숫자도 여기서 걸림
    s = label.translate(_CHAR_MAP)
    s = _strip_page_parens(s)
    s = _normalize_leading_number(s)
    return _WS.sub("", s)


def section_key_collisions(labels: Iterable[str | None]) -> dict[str, list[str]]:
    """정규화가 **서로 다른 소단원을 같은 키로 뭉개는지** 검사합니다.

    뭉개지면 그 소단원은 계획에서 통째로 사라집니다. 이 프로젝트의 실패 정의가
    "빠뜨리는 것" 이므로, 정규화를 쓰는 쪽은 먼저 이걸 확인하고 충돌이 있으면
    정규화를 포기해야 합니다. 반환값은 {키: [원문들]} 이며 충돌 없으면 빈 dict.
    """
    buckets: dict[str, list[str]] = {}
    for raw in labels:
        key = canonical_section_key(raw)
        if not key:
            continue
        seen = buckets.setdefault(key, [])
        if raw not in seen:
            seen.append(raw)
    return {k: v for k, v in buckets.items() if len(v) > 1}


def grade_to_file_number(grade: str) -> int | None:
    """'초5' → 5, '중2' → 8 (중등은 초6 다음부터 이어짐)."""
    g = (grade or "").strip()
    try:
        if g.startswith("초"):
            return int(g[1:])
        if g.startswith("중"):
            return int(g[1:]) + 6
    except ValueError:
        return None
    return None


@dataclass(frozen=True)
class BookRef:
    """교재 1권을 특정하는 참조."""

    grade: str          # 초5 / 중2
    level: str          # 발전 / 가우스 …  (사용자 표기 그대로 받아도 됨)
    term: int | None = None    # 학기 1/2
    volume: int | None = None  # 권

    @property
    def school(self) -> str:
        return "중등" if self.grade.startswith("중") else "초등"

    @property
    def canonical_level(self) -> str:
        return canonical_level(self.level, school=self.school)

    @property
    def slug(self) -> str:
        """파일명 조각. 초등은 난이도 슬러그, 중등은 시리즈 슬러그."""
        if self.school == "중등":
            return SERIES_TO_SLUG.get(self.level, self.level)
        return LEVEL_TO_SLUG.get(self.canonical_level, self.canonical_level)

    def answer_filename(self) -> str | None:
        """합본 정답지 파일명."""
        n = grade_to_file_number(self.grade)
        return f"g{n}_{self.slug}_answer.pdf" if n else None

    def sample_filename(self) -> str | None:
        """본문(샘플교재) 파일명. 학기/권이 있어야 합니다."""
        n = grade_to_file_number(self.grade)
        if not n or self.term is None or self.volume is None:
            return None
        return f"g{n}_{self.slug}_sample_{self.term}_{self.volume}.pdf"

    def label(self) -> str:
        bits = [self.grade]
        if self.term:
            bits.append(f"{self.term}학기")
        bits.append(self.level)
        if self.volume:
            bits.append(f"{self.volume}권")
        return " ".join(bits)


#: 선생님 담당 교재 (2026-08-19 지정)
MY_BOOKS: tuple[BookRef, ...] = (
    # "중2-2 가우스 3권"
    BookRef(grade="중2", level="가우스", term=2, volume=3),
    # "초5-1 가우스 1권" → 별칭 변환으로 '초5 발전'
    BookRef(grade="초5", level="가우스", term=1, volume=1),
)
