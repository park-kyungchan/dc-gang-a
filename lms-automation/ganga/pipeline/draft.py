# -*- coding: utf-8 -*-
"""
수업일지 초안 생성 — 지금까지 만든 조각들을 잇는 곳.

    학생DB(관찰메모·오답유형)  ┐
    진도계획(이번 회차 소단원) ├─→ 사실 블록 ─→ LLM ─→ 게이트 ─→ 초안
    지난 수업 기록            ┘                              (전송 안 함)

⚠️ 진도는 **계획일 뿐 실적이 아닙니다.**
    한 회차에 계획한 소단원을 다 못 나가는 일이 흔합니다. 그래서 초안은
    "…진행" 까지만 쓰고 완료를 단정하지 않습니다. 실제 어디까지 나갔는지는
    선생님이 검토하면서 고치고, 그 결과가 progress_log 에 남아 다음 계획을
    다시 계산합니다. 쪽 단위 입력이 들어오기 전까지는 여기서 더 추론하지
    않습니다.

**이 모듈은 절대 전송하지 않습니다.** 초안까지만 만들고 사람에게 넘깁니다.
전송은 `ganga.lms.writer` 가 하고, 그것도 승인 후에만 합니다.

승격 원장을 강제하는 첫 지점
    지금까지 `ganga/policy.py` 의 원장은 존재하기만 하고 아무도 읽지
    않았습니다. 규칙이 코드에 걸려 있지 않으면 그건 규칙이 아니라 문서입니다.
    여기서 항목별 모드를 실제로 확인합니다.

        manual   → LLM 이 **초안조차 만들지 않습니다.** 빈칸으로 둡니다.
        suggest  → 초안을 만들되 전송 후보로 올리지 않습니다.
        auto     → 초안을 만들고 전송 후보가 됩니다 (그래도 사람 승인 필요).

사실이 없으면 만들지 않습니다
    관찰 메모가 없으면 daily_memo 를 비웁니다. 재료 없이 LLM 에게 쓰라고 하면
    그게 정확히 환각을 부르는 조건입니다.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any

from ..policy import Ledger, Mode
from .completeness import RowStatus, check_row
from .llm import LlmAdapter, draft_day_record, emit_request, ingest_response
from .schema import DayRecordContext, DayRecordDraft, LessonFact

#: 초안 대상 필드 ↔ 승격 원장 키
FIELD_TO_POLICY: dict[str, str] = {
    "progress_text": "progress",
    "homework_text": "homework",
    "daily_memo": "memo",
}


@dataclass
class DraftResult:
    """학생 1명의 초안과 그 근거."""

    student_key: str
    student_name: str
    draft: DayRecordDraft = field(default_factory=DayRecordDraft)
    #: 필드별로 왜 그 값이 됐는지 (llm / template / 원장차단 / 재료없음)
    field_source: dict[str, str] = field(default_factory=dict)
    status: RowStatus | None = None
    blockers: list[str] = field(default_factory=list)
    audit: list[str] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        """사람이 검토만 하면 되는 상태인가."""
        return bool(self.status and self.status.is_complete) and not self.blockers

    def summary(self) -> str:
        if self.blockers:
            return f"{self.student_name} ✗ {self.blockers[0]}"
        mark = self.status.progress_mark if self.status else "?????"
        srcs = ", ".join(f"{k.replace('_text','').replace('daily_','')}={v}"
                         for k, v in self.field_source.items())
        return f"{self.student_name} {mark} [{srcs}]"

    def to_payload(self, ctx: DayRecordContext) -> dict[str, Any]:
        return self.draft.to_payload(ctx)


# ─────────────────────────────────────────────────────────────
# 재료 수집 — 전부 결정론적
# ─────────────────────────────────────────────────────────────
def build_context(
    conn: sqlite3.Connection,
    student_key: str,
    *,
    date: str,
    session_no: int | None = None,
    dt_score: int | None = None,
    hw_rate: int | None = None,
    attendance: str = "Y",
) -> tuple[DayRecordContext, list[str]]:
    """학생 DB 와 진도 계획에서 사실을 모읍니다.

    반환: (컨텍스트, 차단사유 목록)
    """
    from .. import students as S

    blockers: list[str] = []
    st = S.get(conn, student_key)
    if st is None:
        return DayRecordContext(student_name=student_key), [f"학생 없음: {student_key}"]

    ctx = DayRecordContext(
        student_name=st.name,
        course_seq=st.course_seq, stu_pri_no=st.stu_pri_no,
        record_seq="", cm_seq=st.cm_seq,
        dt_score=dt_score, hw_rate=hw_rate, attendance=attendance,
    )

    if not st.can_write_to_lms:
        blockers.append(
            "LMS 식별키 미확보 (" + ", ".join(st.missing_keys()) + ") — "
            "학생그룹 편성 후 수업일지 화면에서 채워집니다"
        )

    # 결석이면 진도·숙제 재료를 모으지 않습니다. 모으면 게이트가 모순으로 잡습니다.
    if attendance == "N":
        return ctx, blockers

    # ── 이번 회차에 나갈 소단원 ──────────────────────────────
    book = st.to_book_ref()
    if book is None:
        blockers.append("교재가 지정되지 않아 진도를 특정할 수 없습니다")
    else:
        from ..syllabus import build_plan, load_syllabus

        syl = load_syllabus(book)
        if not len(syl):
            blockers.append("교재 목차를 읽지 못했습니다: " + "; ".join(syl.warnings))
        else:
            # **'완료' 만** 계획에서 뺍니다. '부분' 을 빼면 반만 나간 소단원의
            # 나머지를 영영 안 나갑니다(한때 실제로 그랬습니다).
            done = S.completed_sections(conn, student_key)
            plan = build_plan(syl, pace=st.pace, per_week=st.per_week,
                              done_sections=done)
            if unfinished := S.partial_sections(conn, student_key):
                blockers.append(
                    "아직 안 끝난 소단원이 있습니다(계획에 남겨 둡니다): "
                    + ", ".join(unfinished[:3]))
            if unjudged := S.unjudged_sections(conn, student_key):
                blockers.append(
                    "완료 기준이 없어 판정하지 못한 진도가 있습니다: "
                    + ", ".join(unjudged[:3])
                    + " — `set_completion_standard()` 로 기준을 정하세요")
            idx = (session_no or 1) - 1
            if 0 <= idx < len(plan.sessions):
                sess = plan.sessions[idx]
                for label in sess.sections:
                    # result 는 비워 둡니다. 계획일 뿐 아직 일어나지 않은 일이고,
                    # 한 회차에 계획 분량을 다 못 나가는 경우가 흔합니다.
                    ctx.today.append(
                        LessonFact(textbook=book.label(), section=label))
                nxt = plan.sessions[idx + 1] if idx + 1 < len(plan.sessions) else None
                if nxt:
                    for label in nxt.sections:
                        ctx.homework.append(
                            LessonFact(textbook=book.label(), section=label))
            else:
                blockers.append(
                    f"{session_no}회차가 계획 범위(1~{len(plan.sessions)}) 밖입니다")

    # ── 지난 수업 기록 ────────────────────────────────────
    # 지난 수업은 **한 것 전부**를 봅니다. 완료든 부분이든 수업은 했으니까요.
    prev = conn.execute(
        "SELECT actual_section, date FROM progress_log WHERE student_key=? "
        "AND status IN ('완료','부분') ORDER BY date DESC LIMIT 1", (student_key,)
    ).fetchone()
    if prev and prev["actual_section"]:
        ctx.previous_progress = f"{prev['date']} {prev['actual_section']}"

    # ── 관찰 메모 — 메모 초안의 유일한 재료 ─────────────────
    for o in S.observations(conn, student_key, limit=3):
        ctx.observations.append(o["text"])

    # ── 오답 유형 — 관찰이 있을 때만 보조 재료로 ─────────────
    prof = S.error_profile(conn, student_key)
    if prof["total"] >= 3 and prof["dominant"] and ctx.observations:
        ctx.observations.append(
            f"최근 오답 {prof['total']}건 중 '{prof['dominant']}' 유형이 가장 많음")

    return ctx, blockers


# ─────────────────────────────────────────────────────────────
# 초안 생성
# ─────────────────────────────────────────────────────────────
def draft_for_student(
    conn: sqlite3.Connection,
    student_key: str,
    *,
    date: str,
    session_no: int | None = None,
    adapter: LlmAdapter | None = None,
    ledger: Ledger | None = None,
    attendance: str = "Y",
    dt_score: int | None = None,
    hw_rate: int | None = None,
) -> DraftResult:
    """학생 1명의 수업일지 초안을 만듭니다. **전송하지 않습니다.**"""
    led = ledger or Ledger()
    ctx, blockers = build_context(
        conn, student_key, date=date, session_no=session_no,
        dt_score=dt_score, hw_rate=hw_rate, attendance=attendance)

    res = DraftResult(student_key=student_key, student_name=ctx.student_name,
                      blockers=blockers)

    # 결석이면 초안이 필요 없습니다. 출결만 기록하면 완결입니다.
    if attendance == "N":
        res.field_source = {k: "결석 — 작성 대상 아님" for k in FIELD_TO_POLICY}
        res.status = check_row(res.draft.to_payload(ctx), student=ctx.student_name)
        return res

    # ── 승격 원장 확인 — LLM 이 손대도 되는 항목만 추립니다 ──
    allowed = {f for f, key in FIELD_TO_POLICY.items()
               if led.llm_may_draft("day_record", key)}
    for f, key in FIELD_TO_POLICY.items():
        if f not in allowed:
            res.field_source[f] = f"원장차단({led.mode('day_record', key).value})"

    if not allowed:
        res.audit.append(
            "모든 항목이 수동(manual)이라 초안을 만들지 않았습니다. "
            "`ganga policy --promote day_record.progress` 로 승격하세요.")
        res.status = check_row(res.draft.to_payload(ctx), student=ctx.student_name)
        return res

    gen = draft_day_record(ctx, adapter)
    res.audit.extend(gen.draft.audit)

    # ── 원장이 허용한 필드만, 재료가 있는 것만 채웁니다 ──────
    has_material = {
        "progress_text": bool(ctx.today),
        "homework_text": bool(ctx.homework),
        "daily_memo": bool(ctx.observations),
    }
    for f in FIELD_TO_POLICY:
        if f not in allowed:
            continue
        if not has_material[f]:
            res.field_source[f] = "재료없음"
            continue
        value = getattr(gen.draft, f, "")
        if not value:
            res.field_source[f] = "생성실패"
            continue
        setattr(res.draft, f, value)
        res.field_source[f] = "template" if gen.fell_back else gen.draft.source

    res.draft.source = gen.draft.source
    res.status = check_row(res.draft.to_payload(ctx), student=ctx.student_name)
    return res


def allowed_fields(ledger: Ledger | None = None) -> list[str]:
    """승격 원장이 LLM/에이전트에게 허용한 필드."""
    led = ledger or Ledger()
    return [f for f, key in FIELD_TO_POLICY.items()
            if led.llm_may_draft("day_record", key)]


def emit_for_student(
    conn: sqlite3.Connection,
    student_key: str,
    *,
    date: str,
    session_no: int | None = None,
    ledger: Ledger | None = None,
    attendance: str = "Y",
) -> dict[str, Any]:
    """에이전트에게 넘길 작업 지시서를 만듭니다 (구독제 모드 1단계).

    모델을 호출하지 않습니다. 재료만 내보냅니다.
    """
    ctx, blockers = build_context(conn, student_key, date=date,
                                  session_no=session_no, attendance=attendance)
    fields = allowed_fields(ledger)
    if attendance == "N":
        return {"student_key": student_key, "student": ctx.student_name,
                "skip": "결석 — 작성 대상 아님", "blockers": blockers}
    if not fields:
        return {"student_key": student_key, "student": ctx.student_name,
                "skip": "승격 원장이 모든 항목을 수동으로 두고 있습니다",
                "blockers": blockers}
    req = emit_request(ctx, allowed_fields=fields)
    req.update({"student_key": student_key, "date": date,
                "session_no": session_no, "blockers": blockers})
    return req


def ingest_for_student(
    conn: sqlite3.Connection,
    student_key: str,
    payload: dict[str, str],
    *,
    date: str,
    session_no: int | None = None,
    ledger: Ledger | None = None,
    attendance: str = "Y",
) -> DraftResult:
    """에이전트가 만든 문장을 게이트에 통과시킵니다 (구독제 모드 3단계).

    검사는 API 모드와 **완전히 동일**합니다. 에이전트가 썼다고 봐주지 않습니다.
    """
    ctx, blockers = build_context(conn, student_key, date=date,
                                  session_no=session_no, attendance=attendance)
    res = DraftResult(student_key=student_key, student_name=ctx.student_name,
                      blockers=blockers)
    fields = allowed_fields(ledger)

    # 원장이 막은 필드를 에이전트가 채워 보냈다면 **버립니다.**
    for f, key in FIELD_TO_POLICY.items():
        if f not in fields:
            res.field_source[f] = f"원장차단({(ledger or Ledger()).mode('day_record', key).value})"
            if payload.get(f):
                res.audit.append(f"{f}: 원장이 막은 항목을 에이전트가 채워 보내 폐기했습니다")

    if not fields:
        res.status = check_row(res.draft.to_payload(ctx), student=ctx.student_name)
        return res

    gen = ingest_response(ctx, payload, allowed_fields=fields)
    res.audit.extend(gen.draft.audit)
    for f in fields:
        value = getattr(gen.draft, f, "")
        if value:
            setattr(res.draft, f, value)
            res.field_source[f] = "template(폴백)" if gen.fell_back else "agent"
        else:
            res.field_source[f] = "생성실패"
    res.draft.source = gen.draft.source
    res.status = check_row(res.draft.to_payload(ctx), student=ctx.student_name)
    return res


def draft_for_class(
    conn: sqlite3.Connection,
    student_keys: list[str],
    *,
    date: str,
    attendance: dict[str, str] | None = None,
    sessions: dict[str, int] | None = None,
    scores: dict[str, int] | None = None,
    adapter: LlmAdapter | None = None,
    ledger: Ledger | None = None,
) -> list[DraftResult]:
    """반 전체 초안. 결석·회차·점수는 학생별로 다르므로 dict 로 받습니다."""
    att = attendance or {}
    sess = sessions or {}
    sc = scores or {}
    led = ledger or Ledger()
    return [
        draft_for_student(
            conn, k, date=date, session_no=sess.get(k),
            adapter=adapter, ledger=led,
            attendance=att.get(k, "Y"), dt_score=sc.get(k))
        for k in student_keys
    ]


def class_report(results: list[DraftResult]) -> str:
    """반 전체 초안 상태를 한 화면으로."""
    if not results:
        return "초안 대상 학생이 없습니다"
    ready = sum(1 for r in results if r.ready)
    lines = [f"{ready}/{len(results)} 검토 준비됨"]
    lines += [f"  {r.summary()}" for r in results]
    blocked = [r for r in results if r.blockers]
    if blocked:
        lines.append("")
        lines.append("차단 사유:")
        for r in blocked:
            for b in r.blockers:
                lines.append(f"  {r.student_name}: {b}")
    return "\n".join(lines)
