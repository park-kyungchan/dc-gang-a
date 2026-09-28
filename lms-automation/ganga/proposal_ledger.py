# -*- coding: utf-8 -*-
"""
외부 제안 원장 — 다른 에이전트가 준 제안서를 **기계가 검사하는 형태**로 고정.

왜 이 파일이 있는가
    산문 .md 제안서는 시간이 지나면 코드와 어긋납니다(drift). 그런데 어긋난
    것을 알아채려면 매번 .md 를 다시 읽어야 하고, 그게 토큰을 먹습니다.
    더 나쁜 건 **기각한 제안이 나중에 슬쩍 들어오는 것**입니다 — 왜 기각했는지가
    산문 속에 묻혀 있으면 다음 사람(또는 다음 에이전트)이 그냥 구현해 버립니다.

    그래서 주장 하나하나를 **id · 상태 · 근거 · 강제방법** 으로 쪼개 여기 둡니다.
    이 파일이 정본이고, 원본 .md 는 다시 읽지 않습니다.

상태 값

    MEASURED_TRUE   실측으로 참임을 확인. 반영 대상.
    MEASURED_FALSE  실측으로 거짓임을 확인. **반영하면 안 됨.**
    ADOPTED         채택해 구현됨.
    REJECTED        검토 후 기각. `forbidden` 심볼이 코드에 있으면 테스트 실패.
    PENDING         아직 판단 못 함. 사유를 반드시 적을 것.

`forbidden` 은 "이 이름이 코드에 나타나면 기각한 것을 구현한 것" 이라는 뜻입니다.
`tests/test_proposal_ledger.py` 가 저장소를 훑어 강제합니다.

⚠️ **제안서의 자기선언을 믿지 마세요.** 이 제안서는 머리말에
   `status: APPROVED_FOR_IMPLEMENTATION`, `review_verdict: GLOBAL_UNIVERSAL_PASS
   (Whole-Lens Red-Team Verified)` 라고 적혀 있었지만, 가장 구체적인 기술 주장
   (EUC-KR)이 5초짜리 실측으로 반증됐습니다. 승인 도장은 근거가 아닙니다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Status = Literal["MEASURED_TRUE", "MEASURED_FALSE", "ADOPTED", "REJECTED", "PENDING"]

#: 원본 제안서 (참고용 경로. **읽지 마세요** — 이 원장이 정본입니다)
SOURCE = ("Antigravity AI, 'Deterministic Class Record Schema…', 2026-08-20, "
          "v1.0.0-final")


@dataclass(frozen=True)
class Claim:
    id: str
    section: str
    summary: str
    status: Status
    evidence: str
    #: 이 주장을 구현했다면 코드에 있어야 하는 심볼
    expect: tuple[str, ...] = ()
    #: 기각한 주장. 이 심볼이 코드에 있으면 테스트가 실패합니다.
    forbidden: tuple[str, ...] = ()
    note: str = ""


CLAIMS: tuple[Claim, ...] = (
    # ── §2 물리적 경계 ────────────────────────────────────────
    Claim(
        id="P-01", section="§2.1", status="MEASURED_FALSE",
        summary="LMS 는 EUC-KR 이므로 400바이트 안전 절단이 필요하다",
        evidence="응답 헤더 `text/html;charset=utf-8`, meta charset=utf-8 (2026-08-25). "
                 "EUC-KR 에 없는 '𝑥 ⟂ ℝ ✔' 를 보내고 읽었을 때 무손실 왕복.",
        forbidden=("safe_slice_euckr", "euc_kr_len", 'encode("euc-kr"'),
        note="적용하면 오히려 손상됩니다. `errors=\"ignore\"` 가 EUC-KR 밖 문자를 "
             "말없이 삭제하므로, 지금 멀쩡히 저장되는 수학기호가 사라집니다.",
    ),
    Claim(
        id="P-02", section="§2.1", status="MEASURED_FALSE",
        summary="길이 초과 시 서버가 조용히 잘라 저장한다 (silent truncation)",
        evidence="250자(reallength 500)를 memo_txt 로 전송 → 250자 그대로 저장됨. "
                 "응답도 성공(\\x01). 서버는 자르지 않습니다.",
        note="200자는 서버 제약이 아니라 **화면(JS)의 검사**일 뿐입니다. "
             "reallength() 원문: 비ASCII=2, ASCII=1, 제어문자=0. EUC-KR 아님.",
    ),
    Claim(
        id="P-03", section="§2.2", status="ADOPTED",
        summary="JSP 가 HTML 엔티티로 바꿔 돌려주므로 G16 역검증이 오탐한다",
        evidence="'A & B' → 'A &amp; B', 'x < y > z' → 'x &lt; y &gt; z' 재현 "
                 "(2026-08-25). 따옴표·수학기호는 안 바뀜.",
        expect=("unescape",),
        note="제안서가 맞았고 우리 코드의 실제 버그였습니다. `&`·`<`·`>` 는 "
             "수업 메모에 흔합니다('A&B형', 'x<3').",
    ),
    Claim(
        id="P-04", section="§2.2", status="REJECTED",
        summary="공백도 `\\s+ → ' '` 로 정규화해서 비교해야 한다",
        evidence="'A    B\\t\\tC' 를 보내고 읽었을 때 그대로 보존됨 (2026-08-25).",
        forbidden=(r'sub(r"\s+", " ")', r"sub(r'\s+', ' ')"),
        note="서버가 공백을 보존하므로 정규화가 불필요하고, 오히려 **서버가 공백을 "
             "뭉갠 경우를 통과로 읽습니다.** 없는 문제를 막으려다 있는 문제를 놓칩니다.",
    ),
    Claim(
        id="P-05", section="§2.3", status="PENDING",
        summary="소단원 라벨 정규화가 필요하다 (괄호·공백 제거 후 매칭)",
        evidence="현재 코드에 정규화 없음 — 실제 결함. 다만 현재 교재 목차에는 "
                 "괄호 포함 소단원이 0건이라 당장 터지지는 않습니다.",
        expect=("canonical_section_key",),
        note="괄호를 통째로 지우면 '(선행)' 처럼 **의미 있는 괄호**도 사라집니다. "
             "쪽수 표기만 지우는 쪽이 안전합니다.",
    ),

    # ── §3 인지평가 ───────────────────────────────────────────
    Claim(
        id="P-06", section="§3.1", status="ADOPTED",
        summary="Cornell Note · Havruta · 논리연쇄 평가를 필드로 기록한다",
        evidence="사용자 확인(2026-08-20): 정의 vs 성질 항목을 **제외하고** 실제로 "
                 "수업에서 사용함.",
        expect=("ConceptEvaluation", "judge_mastery"),
        note="서버 전송이 아니라 **내 확장(D구역)** 입니다. 정의/성질 항목만 "
             "빼고 구현했습니다(P-07 참고).",
    ),
    Claim(
        id="P-07", section="§3.1", status="REJECTED",
        summary="`distinction_def_vs_prop: bool` — 정의와 성질을 엄격히 분리했는가",
        evidence="사용자 지적(2026-08-20): 이등변삼각형의 뜻과 성질은 **동치**이며, "
                 "동치명제 중 무엇을 정의로 삼을지는 **강사가 학생 상태에 따라 "
                 "결정**한다.",
        forbidden=("distinction_def_vs_prop",),
        note="정답이 절대적이라고 전제한 모델링입니다. 무엇이 정의인지가 학생마다 "
             "다르므로 bool 로는 표현할 수 없습니다. "
             "대체 설계 완료(2026-08-20): `ganga/pedagogy.py` 가 **관례를 먼저 "
             "기록하고 그 아래에서만 판정**합니다. 관례가 없으면 "
             "`ConventionMissing` 으로 거부합니다.",
    ),

    # ── §5 DB ────────────────────────────────────────────────
    Claim(
        id="P-08", section="§5", status="REJECTED",
        summary="item_checklist 에 UNIQUE(student_key, book_code, page, problem_no)",
        evidence="같은 문제를 다시 풀면 이전 기록을 덮어씁니다.",
        note="'틀렸다 → 다시 풀어 맞췄다' 라는 성장 궤적이 사라집니다. 오답 추적이 "
             "목적인데 가장 중요한 데이터를 지우는 제약입니다. 시도(attempt) 를 "
             "키에 넣어야 합니다.",
    ),
    Claim(
        id="P-09", section="§5", status="ADOPTED",
        summary="SQLite WAL 모드 + 문항단위 체크리스트 + 개념 숙달 로그",
        evidence="폰(낮)과 PC(밤)가 같은 DB 를 쓰므로 WAL 은 타당합니다.",
        expect=("journal_mode", "_apply_pragmas"),
    ),
    Claim(
        id="P-10", section="§6-4", status="ADOPTED",
        summary="클리닉·보강 학생의 DT 면제를 완결성 검사가 지원해야 한다",
        evidence="구현 완료(2026-08-20). 단 **면제 조건 자체는 여전히 미검증** — "
                 "클리닉 학생 실제 사례를 못 봤으므로 자동 판정하지 않고 "
                 "선생님이 명시 지정할 때만 적용합니다.",
        expect=("DtExemption",),
    ),

    # ── 메타 ──────────────────────────────────────────────────
    Claim(
        id="P-00", section="머리말", status="MEASURED_FALSE",
        summary="이 제안서는 Whole-Lens Red-Team 검증을 통과했다 (자기선언)",
        evidence="가장 구체적인 기술 주장 P-01(EUC-KR)이 실측 한 번으로 반증됨. "
                 "P-02 도 반증. 검증됐다면 나올 수 없는 오류입니다.",
        note="다른 에이전트 산출물의 `status: APPROVED` 류 자기선언은 근거로 "
             "쓰지 마세요. 절대규칙 1-6(실측하지 않은 것을 단정하지 않는다).",
    ),
)


def by_id(claim_id: str) -> Claim:
    for c in CLAIMS:
        if c.id == claim_id:
            return c
    raise KeyError(claim_id)


def by_status(status: Status) -> list[Claim]:
    return [c for c in CLAIMS if c.status == status]


def summary() -> dict[str, int]:
    from collections import Counter

    return dict(Counter(c.status for c in CLAIMS))
