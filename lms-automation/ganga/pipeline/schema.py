# -*- coding: utf-8 -*-
"""
수업일지 생성의 입출력 스키마.

설계 원칙: **사실은 주입하고, LLM 은 표현만 한다.**

    LLM 이 교재명·페이지·문항번호·점수를 "기억해서" 쓰면 그 순간 환각 위험이
    생깁니다. 그래서 그런 값들은 전부 `DayRecordContext` 에 담아 프롬프트로
    넣고, 생성된 문장이 그 사실들과 어긋나면 게이트에서 걸러냅니다.

    학부모에게 나가는 데일리리포트가 걸린 경로라 이 구분이 중요합니다.

원자 단위 스키마 (`AtomicProgress` / `AtomicHomework` / `AtomicMemo`)
    "진도를 한 문장으로 써 줘" 는 LLM 에게 **빈 종이**를 주는 것과 같습니다.
    교재명·쪽수·소단원을 기억해서 채우게 되고, 그게 환각이 들어오는 자리입니다.
    칸으로 쪼개 두면 각 칸에 들어갈 값이 서버·교재 목차에서 온 사실 하나뿐이라
    지어낼 여지가 좁아지고, 문장 조립은 `format()` 이 결정론적으로 합니다.
    (파이프라인 원칙: LLM 은 문장만, 판단과 조립은 코드가.)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, fields as dataclass_fields
from typing import Any

from ..lms.endpoints import reallength


@dataclass
class LessonFact:
    """수업에서 실제로 다룬 것 1건. 전부 강사/서버에서 온 확정 사실입니다."""

    textbook: str = ""          # 예: "초등 5-1 가우스 2권"
    page: int | None = None     # 예: 31
    problems: str = ""          # 예: "5~8번"
    section: str = ""           # 예: "실력쌓기"
    #: ⚠️ 진행 결과는 **선생님이 채우는 칸**입니다.
    #: 계획만 보고 "완벽 통과" 같은 것을 자동으로 넣으면 안 됩니다.
    #: 한 회차에 계획한 분량을 다 못 나가는 일이 흔합니다.
    result: str = ""            # 예: "완벽 통과", "3번 재시도 후 해결"

    def as_phrase(self) -> str:
        """사실을 그대로 문자열로. LLM 없이도 쓸 수 있는 형태."""
        bits = []
        if self.textbook:
            bits.append(f"[{self.textbook}]")
        loc = ""
        if self.page is not None:
            loc = f"p.{self.page}"
        if self.section:
            loc = f"{loc} {self.section}".strip()
        if self.problems:
            loc = f"{loc} {self.problems}".strip()
        if loc:
            bits.append(loc)
        if self.result:
            bits.append(self.result)
        return " ".join(bits)

    def tokens(self) -> set[str]:
        """이 사실에서 유래한 검증용 토큰들."""
        t: set[str] = set()
        if self.textbook:
            t.add(self.textbook)
        if self.page is not None:
            t.add(str(self.page))
        if self.problems:
            t.update(re.findall(r"\d+", self.problems))
        return t


@dataclass
class DayRecordContext:
    """수업일지 1행을 쓰기 위해 필요한 모든 확정 사실."""

    student_name: str
    # 서버 행 식별키 — LLM 에게는 절대 노출하지 않습니다.
    course_seq: str = ""
    stu_pri_no: str = ""
    record_seq: str = ""
    cm_seq: str = ""

    # 오늘 다룬 것 / 다음 과제
    today: list[LessonFact] = field(default_factory=list)
    homework: list[LessonFact] = field(default_factory=list)

    # 지난 수업 기록 (서버에서 읽어옴)
    previous_progress: str = ""

    # 강사가 직접 관찰한 것 — 메모의 원재료. 비어 있으면 메모를 만들지 않습니다.
    observations: list[str] = field(default_factory=list)

    # 점수 (강사 입력)
    dt_score: int | None = None
    hw_rate: int | None = None
    attendance: str = "Y"

    def allowed_tokens(self) -> set[str]:
        """생성문에 등장해도 되는 숫자·고유명사 집합."""
        t: set[str] = set()
        for f in (*self.today, *self.homework):
            t |= f.tokens()
        t.add(self.student_name)
        for o in self.observations:
            t.update(re.findall(r"\d+", o))
        for v in (self.dt_score, self.hw_rate):
            if v is not None:
                t.add(str(v))
        return t

    def facts_block(self) -> str:
        """프롬프트에 넣을 사실 목록. 여기 없는 것은 쓰면 안 됩니다."""
        lines = [f"학생: {self.student_name}"]
        if self.previous_progress:
            lines.append(f"지난 진도: {self.previous_progress}")
        if self.today:
            lines.append("오늘 수업에서 실제로 다룬 것:")
            lines += [f"  - {f.as_phrase()}" for f in self.today]
        if self.homework:
            lines.append("다음 시간까지 낼 과제:")
            lines += [f"  - {f.as_phrase()}" for f in self.homework]
        if self.observations:
            lines.append("강사가 직접 관찰한 것:")
            lines += [f"  - {o}" for o in self.observations]
        if self.dt_score is not None:
            lines.append(f"일일테스트 점수: {self.dt_score}/10")
        if self.hw_rate is not None:
            lines.append(f"숙제 완성도: {self.hw_rate}/5")
        return "\n".join(lines)

    def keys(self) -> dict[str, str]:
        return {
            "course_seq": self.course_seq,
            "stu_pri_no": self.stu_pri_no,
            "record_seq": self.record_seq,
            "cm_seq": self.cm_seq,
        }


@dataclass
class DayRecordDraft:
    """생성 결과. 게이트를 통과한 것만 여기 담깁니다."""

    progress_text: str = ""
    homework_text: str = ""
    daily_memo: str = ""

    #: 어떻게 만들어졌는지 (llm / template / hybrid)
    source: str = "template"
    #: 게이트 경고 및 재시도 이력 — 감사 추적용
    audit: list[str] = field(default_factory=list)

    def to_payload(self, ctx: DayRecordContext) -> dict[str, Any]:
        """writer 에 넘길 페이로드로 변환합니다."""
        p: dict[str, Any] = dict(ctx.keys())
        if self.progress_text:
            p["progress_text"] = self.progress_text
        if self.homework_text:
            p["homework_text"] = self.homework_text
        if self.daily_memo:
            p["daily_memo"] = self.daily_memo
        if ctx.dt_score is not None:
            p["dt_score"] = ctx.dt_score
        if ctx.hw_rate is not None:
            p["hw_rate"] = ctx.hw_rate
        if ctx.attendance:
            p["attendance"] = ctx.attendance
        return p


# ─────────────────────────────────────────────────────────────
# 원자 단위 스키마 — LLM 이 채울 수 있는 칸을 좁힙니다
# ─────────────────────────────────────────────────────────────
# 왜 자르지 않는가 (P-02, 실측 2026-08-25)
#     memo_txt 에 250자(reallength 500)를 보냈더니 **250자 그대로 저장**됐습니다.
#     서버는 자르지 않습니다. 200자는 서버 제약이 아니라 화면 JS 의 검사일 뿐이고,
#     사용자 결정(2026-08-20)으로 길이 제한도 두지 않습니다.
#     그래서 `format()` 은 **어떤 경우에도 문자열을 자르지 않습니다.**
#     길이는 `display_length` 로 알려만 줍니다 — 막는 데 쓰지 마세요.
#
# 왜 EUC-KR 로 인코딩하지 않는가 (P-01, 실측 2026-08-25)
#     이 LMS 는 UTF-8 입니다(응답 헤더 `text/html;charset=utf-8`). EUC-KR 에 없는
#     '𝑥 ⟂ ℝ ✔' 를 보내고 다시 읽어도 무손실 왕복합니다. 반대로 EUC-KR 로 바꿔
#     담으려 하면 `errors="ignore"` 가 그 문자들을 **말없이 삭제**합니다.
#     즉 보호한다는 처리가 멀쩡히 저장되던 수학기호를 파괴합니다.
#     수학 학원의 수업 기록에서 수학기호가 사라지는 것이 가장 나쁜 결과이므로,
#     여기서는 바이트 단위 절단을 하지 않습니다. 원장이 이 결정을 강제합니다
#     (`ganga/proposal_ledger.py` P-01, `tests/test_proposal_ledger.py`).

#: 화면 JS(`reallength`)가 경고를 띄우는 기준. **서버 제약이 아닙니다.**
#: 참고용으로만 씁니다 — 이 값으로 전송을 막거나 문자열을 자르지 않습니다.
SCREEN_HINT_LIMIT = 400

#: 사람이 읽는 칸 이름. "무엇이 비었는지" 를 화면에 그대로 띄우기 위한 것입니다.
SLOT_LABELS: dict[str, str] = {
    "textbook_name": "교재명",
    "chapter": "대단원",
    "sub_unit_no": "소단원 번호",
    "sub_unit_title": "소단원명",
    "page_start": "시작쪽",
    "page_end": "끝쪽",
    "stages_covered": "진행단계",
    "page_range": "쪽 범위",
    "problem_scope": "문항 범위",
    "mandatory_tags": "필수 과제",
    "next_preview": "다음 예고",
    "pre_class_note_feedback": "예습노트 피드백",
    "in_class_reaction": "수업 중 반응",
    "solution_habit_coaching": "풀이습관 지도",
}

#: 메모 문장에서 각 칸 앞에 붙는 이름. 라벨이 있어야 어느 칸이 빠졌는지 보입니다.
MEMO_PREFIXES: dict[str, str] = {
    "pre_class_note_feedback": "예습노트",
    "in_class_reaction": "수업반응",
    "solution_habit_coaching": "풀이습관",
}


def _blank(v: Any) -> bool:
    """'재료가 없다'의 정의. 0 은 값이므로 비었다고 보지 않습니다."""
    if v is None:
        return True
    if isinstance(v, str):
        return not v.strip()
    if isinstance(v, (list, tuple, set, dict)):
        return not v
    return False


class _Atomic:
    """원자 스키마 공통부.

    재료가 없으면 **만들지 않습니다.** 추측해서 채운 값(있지도 않은 쪽수)이
    자유텍스트보다 위험합니다 — 그럴듯해서 사람이 검토에서 놓칩니다.
    그래서 빈 칸은 문장에서 통째로 빠지고, `missing_slots()` 로 드러납니다.
    """

    #: 재료가 필요한 칸. `status` 처럼 기본값이 의미를 갖는 칸은 넣지 않습니다.
    MATERIAL_SLOTS: tuple[str, ...] = ()

    def format(self) -> str:      # pragma: no cover - 하위 클래스가 구현
        raise NotImplementedError

    def missing_slots(self) -> tuple[str, ...]:
        """재료가 없어 비어 있는 칸. 이 칸들은 문장에서 빠져 있습니다."""
        return tuple(s for s in self.MATERIAL_SLOTS
                     if _blank(getattr(self, s, None)))

    def missing_labels(self) -> tuple[str, ...]:
        return tuple(SLOT_LABELS.get(s, s) for s in self.missing_slots())

    @property
    def is_complete(self) -> bool:
        """모든 칸에 재료가 있는가. 아니어도 `format()` 은 됩니다(그 부분만 빠짐)."""
        return not self.missing_slots()

    @property
    def display_length(self) -> int:
        """화면 JS 와 같은 계산(비ASCII=2, ASCII=1)으로 잰 길이.

        **알려주기만 합니다.** 이 값으로 자르거나 막지 않습니다.
        서버는 자르지 않는 것이 실측으로 확인됐습니다(P-02).
        """
        return reallength(self.format())

    @property
    def exceeds_screen_hint(self) -> bool:
        """화면 JS 가 경고를 띄울 길이인가 — **참고용 표시일 뿐입니다.**

        True 여도 전송은 막지 않습니다. 서버는 이보다 긴 값도 그대로 저장합니다.
        """
        return self.display_length > SCREEN_HINT_LIMIT

    def as_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in dataclass_fields(self)}


@dataclass
class AtomicProgress(_Atomic):
    """진도 한 줄을 칸으로 쪼갠 것.

    예) `[중2-2 가우스 3권] 도형의 성질 > 3. 이등변삼각형의 성질 p.42~47 개념·기본 진행`
    """

    textbook_name: str = ""       # 예: "중2-2 가우스 3권"
    chapter: str = ""             # 예: "도형의 성질"
    sub_unit_no: int | None = None
    sub_unit_title: str = ""      # 예: "이등변삼각형의 성질"
    page_start: int | None = None
    page_end: int | None = None
    stages_covered: list[str] = field(default_factory=list)  # 예: ["개념", "기본"]
    #: 기본값이 "진행" 인 이유 — 계획한 분량을 한 회차에 다 못 나가는 일이 흔합니다.
    #: "학습했습니다" 로 단정하면 절반만 나간 것도 완료로 학부모 리포트에 나갑니다.
    #: 어디까지 나갔는지는 선생님이 고치고, 그 결과가 progress_log 에 남습니다.
    status: str = "진행"

    MATERIAL_SLOTS = ("textbook_name", "chapter", "sub_unit_no",
                      "sub_unit_title", "page_start", "page_end",
                      "stages_covered")

    def _unit(self) -> str:
        head = self.chapter.strip()
        tail = self.sub_unit_title.strip()
        if self.sub_unit_no is not None:
            # 번호만 알고 제목을 모르면 제목을 지어내지 않고 번호만 남깁니다.
            tail = (f"{self.sub_unit_no}. {tail}".strip() if tail
                    else f"소단원 {self.sub_unit_no}")
        if head and tail:
            return f"{head} > {tail}"
        return head or tail

    def _pages(self) -> str:
        s, e = self.page_start, self.page_end
        if s is None and e is None:
            return ""       # 모르면 쪽 표기를 통째로 뺍니다. 'p.999' 는 여기서 시작합니다.
        if s is not None and e is not None:
            return f"p.{s}" if s == e else f"p.{s}~{e}"
        # 한쪽만 아는 경우 — 열린 끝을 그대로 드러냅니다.
        # 'p.42' 로 닫아 쓰면 42쪽만 나간 것으로 읽혀 없는 사실을 만듭니다.
        return f"p.{s}~" if s is not None else f"~p.{e}"

    def format(self) -> str:
        """사실만으로 진도 문장을 조립합니다. **자르지 않습니다.**"""
        bits: list[str] = []
        if self.textbook_name.strip():
            bits.append(f"[{self.textbook_name.strip()}]")
        unit = self._unit()
        if unit:
            bits.append(unit)
        pages = self._pages()
        if pages:
            bits.append(pages)
        stages = [s.strip() for s in self.stages_covered if s and s.strip()]
        if stages:
            bits.append("·".join(stages))
        # 재료가 하나도 없으면 **빈 문자열**입니다.
        # 여기서 "진행" 만 돌려주면 완결성 검사가 진도를 '입력됨' 으로 읽어
        # 아무것도 안 쓴 칸이 통과합니다. 누락을 놓치는 것이 가장 나쁜 실패입니다.
        if not bits:
            return ""
        if self.status.strip():
            bits.append(self.status.strip())
        return " ".join(bits)


@dataclass
class AtomicHomework(_Atomic):
    """숙제 한 줄을 칸으로 쪼갠 것.

    예) `[중2-2 가우스 3권] p.48~50 1~12번 (필수: 오답노트, 서술형) 다음 예고: 삼각형의 외심`
    """

    textbook_name: str = ""
    page_range: str = ""          # 예: "p.48~50" — 계산하지 말고 받은 그대로
    problem_scope: str = ""       # 예: "1~12번", "홀수번만"
    mandatory_tags: list[str] = field(default_factory=list)  # 예: ["오답노트"]
    #: 다음 시간 예고. 없으면 비웁니다 — 다음 진도를 모르면서 예고를 지어내면
    #: 학부모가 그걸 약속으로 읽습니다.
    next_preview: str = ""

    #: `next_preview` 는 없을 수 있는 것이 정상이라 필수 재료로 보지 않습니다.
    MATERIAL_SLOTS = ("textbook_name", "page_range", "problem_scope",
                      "mandatory_tags")

    def format(self) -> str:
        bits: list[str] = []
        if self.textbook_name.strip():
            bits.append(f"[{self.textbook_name.strip()}]")
        if self.page_range.strip():
            bits.append(self.page_range.strip())
        if self.problem_scope.strip():
            bits.append(self.problem_scope.strip())
        tags = [t.strip() for t in self.mandatory_tags if t and t.strip()]
        if tags:
            bits.append(f"(필수: {', '.join(tags)})")
        if self.next_preview.strip():
            bits.append(f"다음 예고: {self.next_preview.strip()}")
        return " ".join(bits)


@dataclass
class AtomicMemo(_Atomic):
    """메모를 세 칸으로 쪼갠 것.

    메모가 가장 환각이 쉽습니다 — 재료가 없어도 문장은 얼마든지 나오기 때문입니다.
    그래서 관찰 종류별로 칸을 나누고, **관찰하지 않은 칸은 비웁니다.**

    예) `예습노트: 정의를 자기 말로 정리함 / 수업반응: 보조선을 먼저 제안함`
    """

    pre_class_note_feedback: str = ""    # 예습노트(코넬노트)에 대한 피드백
    in_class_reaction: str = ""          # 수업 중 실제 반응
    solution_habit_coaching: str = ""    # 풀이습관 지도 내용

    MATERIAL_SLOTS = ("pre_class_note_feedback", "in_class_reaction",
                      "solution_habit_coaching")

    def format(self) -> str:
        """관찰한 칸만 이어 붙입니다. 빈 칸은 라벨째 빠집니다."""
        bits = [f"{MEMO_PREFIXES[s]}: {str(getattr(self, s) or '').strip()}"
                for s in self.MATERIAL_SLOTS
                if str(getattr(self, s) or "").strip()]
        return " / ".join(bits)
