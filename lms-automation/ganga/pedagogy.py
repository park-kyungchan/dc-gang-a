# -*- coding: utf-8 -*-
"""
교육적 판단 기준 — **정답이 선생님의 선택에 달린 것들.**

왜 이 모듈이 따로 있는가
    외부 제안서에 `distinction_def_vs_prop: bool` — "학생이 정의와 성질을
    엄격히 구분했는가" 라는 항목이 있었습니다. 기각했습니다.

    이등변삼각형에서

        A. 두 변의 길이가 같다      (보통 '뜻' 으로 배움)
        B. 두 밑각의 크기가 같다    (보통 '성질' 로 배움)

    **A ⟺ B 입니다.** 어느 쪽을 정의로 삼아도 같은 대상이고, 무엇을 정의로
    잡을지는 **선생님이 학생 상태를 보고 정합니다**(사용자 확인 2026-08-20).
    그러니 "구분했는가" 는 무엇을 정의로 잡았는지 정해야만 답이 생기는
    질문입니다. `bool` 하나로는 표현할 수 없습니다.

이 모듈이 세우는 규율

    **판정 기준이 선생님의 선택에 달린 항목은, 그 선택을 먼저 기록하고 나서
    판정한다. 선택이 없으면 판정하지 않는다.**

    이 저장소가 서버에 대해 지키는 규칙(1-6 실측하지 않은 것을 단정하지
    않는다)을 교육 영역으로 옮긴 것입니다. 서버에 대해서는 실측을 요구하면서
    학생 평가에서는 절대적 정답을 가정하고 있었습니다.

`None` 과 `False` 는 다릅니다
    DT 점수에서 배운 것과 같은 구조입니다 (-1 미입력 vs 0 미실시).

        None   확인하지 않음   ← 못 한 것이 아닙니다
        False  확인했고 못 함
        True   확인했고 함

    셋을 접으면 "안 물어본 것" 이 "못 하는 것" 으로 둔갑합니다.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import date as Date
from typing import Any

# ─────────────────────────────────────────────────────────────
# "진도를 나갔다" 의 기준 — 완료란 무엇인가
# ─────────────────────────────────────────────────────────────
"""
`PROGRESS_STATUS` 에 '완료' 가 있었지만 **완료가 무엇인지는 어디에도 없었습니다.**
그래서 두 가지가 동시에 벌어졌습니다.

  1. 사람마다(그리고 같은 사람도 날마다) 다른 뜻으로 '완료' 를 씁니다.
  2. 코드가 `status IN ('완료','부분')` 으로 **둘을 같이 셌습니다.**

2번이 실제 버그였습니다. `build_plan(done_sections=...)` 에 '부분' 까지 넘어가서
**절반만 나간 소단원이 남은 계획에서 통째로 빠졌습니다.** 나머지 절반을 영영
안 나가게 됩니다 — 이 프로젝트가 정의한 실패("빠뜨리는 것") 그 자체입니다.

도달 수준은 순서가 있습니다. 뒤로 갈수록 강합니다.
"""
COVERAGE_LEVELS: tuple[str, ...] = (
    "NOT_STARTED",   # 손도 안 댐
    "EXPLAINED",     # 설명했다 — 강사가 다뤘음
    "PRACTICED",     # 문제를 풀렸다 — 학생이 손으로 해 봄
    "REPRODUCED",    # 스스로 재현했다 — 도움 없이 다시 해냄
)

COVERAGE_LABELS: dict[str, str] = {
    "NOT_STARTED": "미실시",
    "EXPLAINED": "설명함",
    "PRACTICED": "풀려봄",
    "REPRODUCED": "스스로 재현",
}


def level_rank(level: str) -> int:
    """수준의 서열. 모르는 값은 **가장 약한 쪽**으로 봅니다(안전한 방향)."""
    try:
        return COVERAGE_LEVELS.index(level)
    except ValueError:
        return 0


@dataclass
class CompletionStandard:
    """이 학생에게 '완료' 로 인정할 **최소 수준.**

    학생마다 다를 수 있습니다. 선행한 학생에게는 `REPRODUCED` 를 요구하고,
    처음 배우는 학생에게는 `PRACTICED` 로 두는 식입니다.
    `scope` 가 비면 그 학생의 기본값이고, 개념명을 넣으면 그 개념만 덮어씁니다.
    """

    id: int
    student_key: str
    scope: str              # '' = 전체 기본 / 개념명 = 그 개념만
    min_level: str
    reason: str = ""
    set_by: str = ""
    set_on: str = ""
    superseded_on: str | None = None

    @property
    def is_current(self) -> bool:
        return self.superseded_on is None

    @property
    def label(self) -> str:
        return COVERAGE_LABELS.get(self.min_level, self.min_level)

    def meets(self, reached: str) -> bool:
        return level_rank(reached) >= level_rank(self.min_level)

    def summary(self) -> str:
        where = self.scope or "(전체 기본)"
        return (f"{where}: '{self.label}' 이상이면 완료"
                + (f" · {self.reason}" if self.reason else ""))


def judge_progress(reached: str, standard: CompletionStandard | None
                   ) -> str | None:
    """도달 수준 + 기준 → `완료` / `부분` / `미실시`.

    **기준이 없으면 `None` 입니다 — '완료' 라고 단정하지 않습니다.**
    그러면 그 소단원은 남은 계획에 계속 남습니다. 틀리더라도 **중복해서 다시
    나가는 쪽**으로 틀리지, 빠뜨리는 쪽으로 틀리지 않습니다.
    """
    if level_rank(reached) <= 0:
        return "미실시"
    if standard is None:
        return None
    return "완료" if standard.meets(reached) else "부분"


# ─────────────────────────────────────────────────────────────
# 동치 관례 — 무엇을 정의로 잡았는가
# ─────────────────────────────────────────────────────────────
"""
동치명제가 여럿인 개념들 (실제 중등 과정)

    이등변삼각형   두 변이 같다 ⟺ 두 밑각이 같다
    평행사변형     조건 5개가 서로 동치
    마름모·직사각형·정사각형
    합동·닮음 조건
    원의 접선

지금은 목록을 굳히지 않습니다. 선생님이 쓰는 개념부터 하나씩 등록합니다
(**실측하지 않은 것을 단정하지 않는다**). 아래는 확인된 것 하나뿐입니다.
"""
KNOWN_EQUIVALENCES: dict[str, tuple[str, ...]] = {
    "이등변삼각형": (
        "두 변의 길이가 같다",
        "두 밑각의 크기가 같다",
    ),
}

#: 동치임을 확인한 방법 (사용자 확인 2026-08-20)
EVIDENCE_KINDS: dict[str, str] = {
    "havruta": "하브루타에서 말로 물음",
    "proved_converse": "역을 증명시킴",
}

#: 숙달 판정
MASTERY_LEVELS: tuple[str, ...] = ("FULLY_MASTERED", "PARTIAL", "RETRY")

#: 노트 결함 (원안 유지 — 정의/성질 항목만 뺐습니다)
NOTE_DEFECTS: dict[str, str] = {
    "DEFECT_DICTATION": "받아쓰기 — 강의를 그대로 옮기고 자기 정리가 없음",
    "DEFECT_NO_PROOF": "유도 과정 없이 공식만 적음",
    "DEFECT_NO_CUE": "왼쪽 단서(질문) 칸이 비어 있음",
    "DEFECT_NO_SUMMARY": "아래쪽 요약 2~3줄이 없음",
    #: 정의/성질 혼동 대신 이것을 씁니다. **관례가 정해진 뒤에만** 판정합니다.
    "DEFECT_CIRCULAR": "순환논법 — 정의로 잡지 않은 명제를 근거로 씀",
}


class ConventionMissing(ValueError):
    """관례를 정하지 않고 판정하려 했습니다.

    이 예외가 나는 것이 정상 동작입니다. 무엇을 정의로 잡았는지 모르면
    "순환논법인가" 를 판정할 근거 자체가 없습니다.
    """


SCHEMA = """
-- '완료' 로 인정할 최소 수준. 관례와 같은 구조입니다 —
-- 덮어쓰지 않고 종료 표시만 합니다. 기준을 바꾸면 그 전 판정은
-- 옛 기준 아래에서 내려진 것이라 소급하면 기록이 거짓말이 됩니다.
CREATE TABLE IF NOT EXISTS completion_standard (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key   TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    scope         TEXT NOT NULL DEFAULT '',   -- '' = 전체 기본 / 개념명
    min_level     TEXT NOT NULL,
    reason        TEXT DEFAULT '',
    set_by        TEXT NOT NULL,
    set_on        TEXT NOT NULL,
    superseded_on TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_std ON completion_standard(student_key, scope);

-- 무엇을 정의로 잡았는가 — **학생×개념 단위** (사용자 결정 2026-08-20)
--
-- 왜 개념 단위(전체 공통)가 아닌가
--   같은 반이어도 학생마다 다를 수 있고, 한 학생도 개념마다 다를 수 있습니다.
--   선행한 학생과 처음 배우는 학생에게 같은 출발점을 강요할 이유가 없습니다.
--
-- 이력을 남깁니다 (UPDATE 가 아니라 INSERT). 학기 중에 관례를 바꿀 수 있고,
-- 그러면 **바꾸기 전 기록은 옛 관례로 판정된 것**이라 소급 적용하면 안 됩니다.
CREATE TABLE IF NOT EXISTS concept_convention (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key    TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    concept_key    TEXT NOT NULL,          -- '이등변삼각형'
    definition     TEXT NOT NULL,          -- 정의로 잡은 명제 (원문)
    others         TEXT NOT NULL DEFAULT '[]',  -- 나머지 동치명제 JSON 배열
    reason         TEXT DEFAULT '',        -- 왜 이렇게 정했는가
    set_by         TEXT NOT NULL,
    set_on         TEXT NOT NULL,          -- 언제부터 (날짜)
    superseded_on  TEXT,                   -- 바뀐 날 (NULL = 현행)
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_conv ON concept_convention(student_key, concept_key);

-- 개념 숙달 로그 — **관례 아래에서만** 판정합니다.
--
-- `convention_id` 가 NOT NULL 인 것이 이 표의 핵심입니다. 관례 없이 기록하면
-- "정의와 성질을 구분 못 함" 같은 판정이 무엇을 뜻하는지 알 수 없게 됩니다.
--
-- 불리언이 아니라 INTEGER NULL 인 이유
--   NULL = 확인 안 함 / 0 = 확인했고 못 함 / 1 = 확인했고 함
--   셋을 접으면 "안 물어본 것" 이 "못 하는 것" 으로 둔갑합니다.
CREATE TABLE IF NOT EXISTS concept_mastery_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key       TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    convention_id     INTEGER NOT NULL REFERENCES concept_convention(id),
    date              TEXT NOT NULL,
    concept_key       TEXT NOT NULL,
    -- ── 동치 이해 ─────────────────────────────────────────
    equivalence_known INTEGER,             -- 둘이 같은 말임을 아는가
    equivalence_by    TEXT DEFAULT '[]',   -- 어떻게 확인했나 (EVIDENCE_KINDS)
    converse_proved   INTEGER,             -- 정의로 안 잡은 쪽을 증명했는가
    -- ── 논증 ─────────────────────────────────────────────
    derived_from_def  INTEGER,             -- 잡은 정의에서 유도했는가
    circular          INTEGER,             -- 순환논법을 썼는가 (결함)
    logical_chain_ok  INTEGER,             -- 논리 연쇄가 끊기지 않았는가
    math_translation_ok INTEGER,           -- 우리말 → 수학기호 번역
    -- ── 노트 ─────────────────────────────────────────────
    note_status       TEXT NOT NULL DEFAULT 'MISSING',
    note_defects      TEXT NOT NULL DEFAULT '[]',
    mastery_level     TEXT NOT NULL,
    note              TEXT DEFAULT '',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_mastery
    ON concept_mastery_log(student_key, concept_key, date DESC);
"""


def _row_to_standard(r: sqlite3.Row) -> CompletionStandard:
    return CompletionStandard(
        id=r["id"], student_key=r["student_key"], scope=r["scope"] or "",
        min_level=r["min_level"], reason=r["reason"] or "",
        set_by=r["set_by"] or "", set_on=r["set_on"] or "",
        superseded_on=r["superseded_on"])


def set_completion_standard(conn: sqlite3.Connection, student_key: str, *,
                            min_level: str, scope: str = "", reason: str = "",
                            set_by: str, on: str | None = None
                            ) -> CompletionStandard:
    """이 학생에게 '완료' 로 인정할 최소 수준을 정합니다."""
    if min_level not in COVERAGE_LEVELS:
        raise ValueError(f"min_level 은 {COVERAGE_LEVELS} 중 하나여야 합니다: "
                         f"{min_level!r}")
    if min_level == "NOT_STARTED":
        raise ValueError("'미실시' 를 완료 기준으로 삼을 수는 없습니다")
    if not set_by.strip():
        raise ValueError("누가 정했는지 필요합니다")
    day = on or Date.today().isoformat()

    with conn:
        conn.execute(
            """UPDATE completion_standard SET superseded_on=?
               WHERE student_key=? AND scope=? AND superseded_on IS NULL""",
            (day, student_key, scope))
        conn.execute(
            """INSERT INTO completion_standard
               (student_key, scope, min_level, reason, set_by, set_on)
               VALUES (?,?,?,?,?,?)""",
            (student_key, scope, min_level, reason, set_by.strip(), day))
    return get_completion_standard(  # type: ignore[return-value]
        conn, student_key, scope=scope)


def get_completion_standard(conn: sqlite3.Connection, student_key: str, *,
                            scope: str = "") -> CompletionStandard | None:
    """현행 기준. 개념별 기준이 없으면 **전체 기본으로 떨어집니다.**

    둘 다 없으면 `None` — 그러면 아무것도 '완료' 로 치지 않습니다.
    """
    for sc in ([scope, ""] if scope else [""]):
        r = conn.execute(
            """SELECT * FROM completion_standard
               WHERE student_key=? AND scope=? AND superseded_on IS NULL
               ORDER BY id DESC LIMIT 1""", (student_key, sc)).fetchone()
        if r:
            return _row_to_standard(r)
    return None


@dataclass
class Convention:
    """이 학생이 이 개념에서 **무엇을 정의로 잡았는가.**"""

    id: int
    student_key: str
    concept_key: str
    definition: str
    others: list[str] = field(default_factory=list)
    reason: str = ""
    set_by: str = ""
    set_on: str = ""
    superseded_on: str | None = None

    @property
    def is_current(self) -> bool:
        return self.superseded_on is None

    @property
    def equivalents(self) -> list[str]:
        """정의를 포함한 동치명제 전부."""
        return [self.definition, *self.others]

    def is_definitional(self, statement: str) -> bool:
        return statement.strip() == self.definition.strip()

    def summary(self) -> str:
        rest = " / ".join(self.others) or "(없음)"
        return (f"{self.concept_key}: 정의 = {self.definition}"
                f" · 나머지 = {rest}"
                + (f" · {self.reason}" if self.reason else ""))


def _row_to_convention(r: sqlite3.Row) -> Convention:
    return Convention(
        id=r["id"], student_key=r["student_key"], concept_key=r["concept_key"],
        definition=r["definition"], others=json.loads(r["others"] or "[]"),
        reason=r["reason"] or "", set_by=r["set_by"] or "",
        set_on=r["set_on"] or "", superseded_on=r["superseded_on"])


def set_convention(conn: sqlite3.Connection, student_key: str, *,
                   concept_key: str, definition: str,
                   others: list[str] | None = None, reason: str = "",
                   set_by: str, on: str | None = None) -> Convention:
    """이 학생의 이 개념에서 정의로 삼을 명제를 정합니다.

    기존 관례는 **덮어쓰지 않고 종료 표시**만 합니다. 바꾸기 전에 남긴
    판정들은 옛 관례 아래에서 내려진 것이라, 소급하면 기록이 거짓말이 됩니다.
    """
    if not definition.strip():
        raise ValueError("정의로 삼을 명제가 비어 있습니다")
    if not set_by.strip():
        raise ValueError("누가 정했는지 필요합니다")
    day = on or Date.today().isoformat()

    rest = [o for o in (others or []) if o.strip() and o.strip() != definition.strip()]
    if not rest and concept_key in KNOWN_EQUIVALENCES:
        # 알려진 동치명제가 있으면 채워 줍니다. 없는 것을 지어내지는 않습니다.
        rest = [s for s in KNOWN_EQUIVALENCES[concept_key]
                if s.strip() != definition.strip()]

    with conn:
        conn.execute(
            """UPDATE concept_convention SET superseded_on=?
               WHERE student_key=? AND concept_key=? AND superseded_on IS NULL""",
            (day, student_key, concept_key))
        cur = conn.execute(
            """INSERT INTO concept_convention
               (student_key, concept_key, definition, others, reason, set_by, set_on)
               VALUES (?,?,?,?,?,?,?)""",
            (student_key, concept_key, definition.strip(),
             json.dumps(rest, ensure_ascii=False), reason, set_by.strip(), day))
    return get_convention(conn, student_key, concept_key)  # type: ignore[return-value]


def get_convention(conn: sqlite3.Connection, student_key: str,
                   concept_key: str) -> Convention | None:
    """현행 관례. **없으면 None** — 판정하기 전에 반드시 확인하세요."""
    r = conn.execute(
        """SELECT * FROM concept_convention
           WHERE student_key=? AND concept_key=? AND superseded_on IS NULL
           ORDER BY id DESC LIMIT 1""", (student_key, concept_key)).fetchone()
    return _row_to_convention(r) if r else None


def convention_history(conn: sqlite3.Connection, student_key: str,
                       concept_key: str) -> list[Convention]:
    return [_row_to_convention(r) for r in conn.execute(
        """SELECT * FROM concept_convention
           WHERE student_key=? AND concept_key=? ORDER BY id""",
        (student_key, concept_key))]


# ─────────────────────────────────────────────────────────────
# 숙달 판정
# ─────────────────────────────────────────────────────────────
@dataclass
class ConceptEvaluation:
    """한 개념에 대한 평가 1건. 전부 **3값**(None/False/True)입니다."""

    equivalence_known: bool | None = None
    equivalence_by: list[str] = field(default_factory=list)
    converse_proved: bool | None = None
    derived_from_def: bool | None = None
    circular: bool | None = None
    logical_chain_ok: bool | None = None
    math_translation_ok: bool | None = None
    note_status: str = "MISSING"
    note_defects: list[str] = field(default_factory=list)
    note: str = ""

    @property
    def unchecked(self) -> list[str]:
        """확인하지 않은 항목. **못 한 것이 아니라 안 물어본 것입니다.**"""
        return [k for k in ("equivalence_known", "converse_proved",
                            "derived_from_def", "circular",
                            "logical_chain_ok", "math_translation_ok")
                if getattr(self, k) is None]


def judge_mastery(ev: ConceptEvaluation) -> tuple[str, list[str]]:
    """숙달 등급과 결함 코드. **확인 안 한 것을 실패로 세지 않습니다.**

    등급 기준
        RETRY           순환논법을 썼거나, 정의에서 유도하지 못함
        PARTIAL         동치를 모르거나, 확인 안 한 항목이 남음
        FULLY_MASTERED  동치를 알고 정의에서 유도했으며 순환논법 없음
    """
    defects = list(ev.note_defects)
    if ev.circular:
        defects.append("DEFECT_CIRCULAR")

    if ev.circular or ev.derived_from_def is False:
        return "RETRY", sorted(set(defects))
    if ev.equivalence_known is False:
        return "PARTIAL", sorted(set(defects))
    if ev.unchecked:
        # 안 물어본 것이 남아 있으면 '완전 숙달' 이라고 할 근거가 없습니다.
        return "PARTIAL", sorted(set(defects))
    if ev.equivalence_known and ev.derived_from_def:
        return "FULLY_MASTERED", sorted(set(defects))
    return "PARTIAL", sorted(set(defects))


def log_mastery(conn: sqlite3.Connection, student_key: str, *,
                concept_key: str, ev: ConceptEvaluation,
                date: str | None = None) -> dict[str, Any]:
    """평가를 기록합니다. **관례가 없으면 거부합니다.**"""
    conv = get_convention(conn, student_key, concept_key)
    if conv is None:
        raise ConventionMissing(
            f"'{concept_key}' 에서 무엇을 정의로 잡을지 아직 정하지 않았습니다. "
            f"`set_convention()` 을 먼저 부르세요. "
            f"정의가 정해지지 않으면 '순환논법인가' 를 판정할 근거가 없습니다."
        )
    bad = [d for d in ev.note_defects if d not in NOTE_DEFECTS]
    if bad:
        raise ValueError(f"알 수 없는 결함 코드: {bad}")
    bad_ev = [e for e in ev.equivalence_by if e not in EVIDENCE_KINDS]
    if bad_ev:
        raise ValueError(f"알 수 없는 확인 방법: {bad_ev}")

    level, defects = judge_mastery(ev)
    day = date or Date.today().isoformat()

    def _b(v: bool | None) -> int | None:
        return None if v is None else int(v)

    with conn:
        cur = conn.execute(
            """INSERT INTO concept_mastery_log
               (student_key, convention_id, date, concept_key,
                equivalence_known, equivalence_by, converse_proved,
                derived_from_def, circular, logical_chain_ok,
                math_translation_ok, note_status, note_defects,
                mastery_level, note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (student_key, conv.id, day, concept_key,
             _b(ev.equivalence_known),
             json.dumps(ev.equivalence_by, ensure_ascii=False),
             _b(ev.converse_proved), _b(ev.derived_from_def), _b(ev.circular),
             _b(ev.logical_chain_ok), _b(ev.math_translation_ok),
             ev.note_status, json.dumps(defects, ensure_ascii=False),
             level, ev.note))
    return {"id": int(cur.lastrowid or 0), "mastery_level": level,
            "defects": defects, "convention": conv.summary(),
            "unchecked": ev.unchecked}
