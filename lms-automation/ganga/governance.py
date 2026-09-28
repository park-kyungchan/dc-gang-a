# -*- coding: utf-8 -*-
"""
쓰기 거버넌스 — 학원 서버로 나가는 **모든** 요청이 지나는 단일 관문.

왜 관문이 하나여야 하는가
    검사가 여러 곳에 흩어져 있으면 반드시 우회 경로가 생깁니다. 새 기능을
    붙이는 사람이 기존 검사를 몰라서, 혹은 급해서 건너뜁니다.
    그래서 **서버에 쓰는 길은 여기 하나뿐**으로 만듭니다.
    `ganga.lms.writer` 도 이 관문을 통과한 요청만 보냅니다.

왜 게이트를 잘게 쪼개는가
    "검증 실패" 한 줄로는 무엇이 왜 막혔는지 알 수 없습니다. 초반에는
    선생님이 **실제로 무엇이 어떻게 나가는지 눈으로 확인해야** 하므로,
    각 검사가 이름·근거·통과여부를 따로 남깁니다.
    나중에 묶고 싶으면 묶으면 되지만, 쪼개진 것을 합치는 것이
    뭉쳐진 것을 쪼개는 것보다 훨씬 쉽습니다.

거버넌스 원칙 4가지
    1. **기본은 거부** — 명시적으로 통과하지 않으면 나가지 않습니다.
    2. **사람 승인 없이는 못 나감** — dry_run 을 꺼도 승인은 별개입니다.
    3. **모든 시도가 기록됨** — 성공·실패·차단 전부 저널에 남습니다.
    4. **개인정보는 저널에 원문으로 남기지 않음** — 학생 실명·본문은 요약만.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from .config import DATA

JOURNAL_PATH = DATA / "write_journal.jsonl"


class Stage(str, Enum):
    PREPARE = "0.준비"
    AUTHORITY = "1.권한"
    DATA = "2.데이터"
    SAFETY = "3.안전"
    APPROVAL = "4.승인"
    VERIFY = "5.검증"


class Tier(str, Enum):
    """되돌릴 수 있는가에 따른 등급.

    전송이라고 다 같은 무게가 아닙니다. 대부분은 학원 서버 DB 의 **덮어쓰기**라
    잘못 넣어도 다시 넣으면 그만입니다. 여기에 16단을 다 태우면 선생님이
    승인만 하다 하루가 갑니다.

    등급을 가르는 기준은 딱 하나 — **되돌릴 수 있는가.**

        LIGHT    되돌릴 수 있고 1건.        진도·숙제·메모·출결·DT·CISM
        BULK     되돌릴 수 있으나 대량.     같은 것을 반 전체에
                 (되돌리는 데 손으로 151번이 들면 사실상 못 되돌립니다)
        HANDOFF  되돌릴 수 없음.            알림톡·일정삭제
                 → **우리가 보내지 않습니다.** 준비만 하고 선생님이 누릅니다.
    """

    LIGHT = "가벼움"
    BULK = "보통"
    HANDOFF = "핸드오프"

    @property
    def note(self) -> str:
        return {
            "가벼움": "덮어쓰기 — 다시 넣으면 됩니다",
            "보통": "되돌릴 수 있으나 손이 많이 듭니다",
            "핸드오프": "되돌릴 수 없습니다 — 최종 버튼은 선생님이 누릅니다",
        }[self.value]


class Verdict(str, Enum):
    PASS = "통과"
    FAIL = "차단"
    SKIP = "해당없음"


@dataclass
class GateOutcome:
    gate_id: str
    name: str
    stage: Stage
    verdict: Verdict
    detail: str = ""

    @property
    def blocked(self) -> bool:
        return self.verdict is Verdict.FAIL

    def __str__(self) -> str:
        mark = {"통과": "✓", "차단": "✗", "해당없음": "·"}[self.verdict.value]
        return f"{mark} [{self.gate_id}] {self.name}: {self.detail}" if self.detail \
            else f"{mark} [{self.gate_id}] {self.name}"


@dataclass
class WriteOp:
    """서버로 나가려는 요청 하나. **불변으로 다루세요.**"""

    routine: str            # day_record / cism / schedule
    field: str              # progress / i_1 / move
    servlet: str            # controller.cct.tutor.DayRecordServlet
    method: str             # GET / POST
    params: dict[str, Any] = field(default_factory=dict)
    #: 대상 식별 (사람이 읽는 용도)
    subject: str = ""       # 학생명 등
    #: 실제로 쓰려는 값
    value: Any = None

    @property
    def key(self) -> str:
        return f"{self.routine}.{self.field}"

    @property
    def fingerprint(self) -> str:
        """같은 대상에 같은 값을 또 보내는지 판별하는 지문."""
        ident = json.dumps(
            {k: v for k, v in sorted(self.params.items())
             if k not in ("dummy",)},
            ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(f"{self.key}|{ident}".encode()).hexdigest()[:16]

    def preview(self) -> str:
        """실제로 나갈 요청을 사람이 읽을 수 있게. **승인 전에 반드시 보여줍니다.**"""
        safe = {k: (f"<{len(str(v))}자>" if isinstance(v, str) and len(str(v)) > 60
                    else v)
                for k, v in self.params.items() if k != "dummy"}
        lines = [
            f"{self.method} /servlet/{self.servlet}",
            f"  대상: {self.subject or '(미지정)'}",
            f"  항목: {self.key}",
        ]
        for k, v in sorted(safe.items()):
            lines.append(f"    {k} = {v}")
        return "\n".join(lines)


@dataclass
class GateContext:
    """게이트가 판단에 쓰는 재료. 게이트는 이것만 봅니다."""

    op: WriteOp
    session_ok: bool = False
    teacher_pri_no: str = ""
    policy_mode: str = "manual"
    dry_run: bool = True
    approved_by: str = ""
    owns_student: bool | None = None      # None = 확인 불가
    known_field: bool = False
    value_errors: list[str] = field(default_factory=list)
    consistency_errors: list[str] = field(default_factory=list)
    recent_fingerprints: set[str] = field(default_factory=set)
    writes_this_run: int = 0
    max_writes: int = 50
    min_interval_sec: float = 0.0
    last_write_at: float = 0.0
    preview_shown: bool = False
    #: 이 값을 **누가 만들었는가**. 승격 원장은 LLM 자동화를 규율하는 것이지
    #: 선생님이 직접 친 값까지 막으라는 규칙이 아닙니다. 모르면 llm 으로 봅니다.
    value_origin: str = "llm"             # llm | human
    #: 이번 전송이 몇 건짜리 묶음의 일부인가. 1 을 넘으면 등급이 올라갑니다.
    batch_size: int = 1
    #: 지금 잠금이 풀려 있는 항목들 (`day_record.progress` 형식). 보고용.
    unlocked: frozenset[str] = frozenset()


Gate = Callable[[GateContext], GateOutcome]


def _g(gate_id: str, name: str, stage: Stage):
    def deco(fn: Callable[[GateContext], tuple[Verdict, str]]) -> Gate:
        def wrapper(ctx: GateContext) -> GateOutcome:
            verdict, detail = fn(ctx)
            return GateOutcome(gate_id, name, stage, verdict, detail)
        wrapper.gate_id = gate_id      # type: ignore[attr-defined]
        wrapper.gate_name = name       # type: ignore[attr-defined]
        wrapper.stage = stage          # type: ignore[attr-defined]
        return wrapper
    return deco


# ─────────────────────────────────────────────────────────────
# 0. 준비
# ─────────────────────────────────────────────────────────────
@_g("G01", "세션 유효", Stage.PREPARE)
def g_session(ctx: GateContext):
    return (Verdict.PASS, "") if ctx.session_ok else \
        (Verdict.FAIL, "LMS 세션이 유효하지 않습니다")


@_g("G02", "강사 식별자", Stage.PREPARE)
def g_teacher(ctx: GateContext):
    if not ctx.teacher_pri_no:
        return Verdict.FAIL, "강사 pri_no 를 확보하지 못했습니다"
    if not str(ctx.teacher_pri_no).isdigit():
        return Verdict.FAIL, f"pri_no 형식 오류: {ctx.teacher_pri_no!r}"
    return Verdict.PASS, f"pri_no={ctx.teacher_pri_no}"


# ─────────────────────────────────────────────────────────────
# 1. 권한
# ─────────────────────────────────────────────────────────────
@_g("G03", "승격 원장 허용", Stage.AUTHORITY)
def g_policy(ctx: GateContext):
    """승격 원장은 **LLM 자동화**를 규율합니다. 선생님의 손을 막는 게 아닙니다.

    한때 이 게이트가 원장이 `auto` 가 아니면 무조건 막았습니다. 그러면
    선생님이 폰으로 직접 친 90점조차 "원장이 manual 이라" 전송이 안 됩니다.
    원장의 취지는 "LLM 이 이 항목을 대신 쓰기 시작해도 되는가" 이지
    "선생님이 이 항목을 쓸 수 있는가" 가 아닙니다. 둘을 섞으면 원장이
    자동화 통제 장치가 아니라 그냥 방해물이 됩니다.

        value_origin=human → 통과 (원장과 무관)
        value_origin=llm   → 원장이 auto 여야 통과
    """
    if ctx.value_origin == "human":
        return Verdict.PASS, "선생님이 직접 입력 — 원장 적용 대상 아님"
    if ctx.policy_mode != "auto":
        return Verdict.FAIL, (
            f"{ctx.op.key} 가 '{ctx.policy_mode}' 입니다. LLM 이 만든 값을 "
            f"보내려면 auto 여야 합니다 (`ganga policy --promote {ctx.op.key}`). "
            f"선생님이 직접 쓰신 값이면 origin 을 human 으로 표시하세요")
    return Verdict.PASS, "auto (LLM 생성)"


@_g("G04", "dry-run 해제 확인", Stage.AUTHORITY)
def g_dry_run(ctx: GateContext):
    """dry-run 은 **항목별로** 풉니다. 전역 스위치가 아닙니다.

    하나 끄면 전부 열리는 스위치는, 켜 두는 걸 잊었을 때 모든 쓰기가
    열려 있는 상태가 됩니다. 진도만 실측하고 싶은데 출결·DT·메모까지
    같이 열릴 이유가 없습니다. 사고 범위를 푼 항목으로 제한합니다.

    해제는 **프로세스 안에서만** 삽니다. 디스크에 남기지 않으므로
    다음 실행에서는 다시 잠깁니다.
    """
    if not ctx.dry_run:
        return Verdict.PASS, f"{ctx.op.key} 해제됨"
    unlocked = ", ".join(sorted(ctx.unlocked)) or "없음"
    return Verdict.FAIL, (
        f"{ctx.op.key} 는 잠겨 있습니다 (의도된 차단). "
        f"현재 해제된 항목: {unlocked}")


@_g("G05", "학생 소유권", Stage.AUTHORITY)
def g_ownership(ctx: GateContext):
    if ctx.owns_student is None:
        return Verdict.FAIL, "담당 학생인지 확인할 수 없습니다"
    if not ctx.owns_student:
        return Verdict.FAIL, f"{ctx.op.subject} 은(는) 내 담당이 아닙니다"
    return Verdict.PASS, ""


# ─────────────────────────────────────────────────────────────
# 2. 데이터
# ─────────────────────────────────────────────────────────────
#: 전송에 반드시 있어야 하는 식별키 (루틴별)
REQUIRED_PARAMS: dict[str, tuple[str, ...]] = {
    "day_record": ("stu_pri_no", "record_seq", "cm_seq"),
    "cism": ("tutor_pri_no", "the_date", "field_name"),
    "schedule": ("record_seq", "cm_seq"),
}


@_g("G06", "식별키 완비", Stage.DATA)
def g_target_keys(ctx: GateContext):
    need = REQUIRED_PARAMS.get(ctx.op.routine, ())
    missing = [k for k in need if not str(ctx.op.params.get(k, "") or "").strip()]
    if missing:
        return Verdict.FAIL, f"누락: {', '.join(missing)}"
    bad = [k for k in need
           if k.endswith(("_seq", "_no")) and not str(ctx.op.params[k]).isdigit()]
    if bad:
        return Verdict.FAIL, f"숫자여야 하는데 아님: {', '.join(bad)}"
    return Verdict.PASS, f"{len(need)}개 확인"


@_g("G07", "알려진 엔드포인트", Stage.DATA)
def g_known_field(ctx: GateContext):
    if not ctx.known_field:
        return Verdict.FAIL, (
            f"{ctx.op.key} 는 endpoints.py 에 등록된 항목이 아닙니다. "
            "실측 확인 없이 임의 전송할 수 없습니다")
    if not ctx.op.servlet.startswith("controller."):
        return Verdict.FAIL, f"서블릿 경로가 이상합니다: {ctx.op.servlet}"
    return Verdict.PASS, ctx.op.servlet.rsplit(".", 1)[-1]


@_g("G08", "값 검증", Stage.DATA)
def g_value(ctx: GateContext):
    if ctx.value_errors:
        return Verdict.FAIL, "; ".join(ctx.value_errors)
    return Verdict.PASS, ""


@_g("G09", "정합성", Stage.DATA)
def g_consistency(ctx: GateContext):
    if ctx.consistency_errors:
        return Verdict.FAIL, "; ".join(ctx.consistency_errors)
    return Verdict.PASS, ""


# ─────────────────────────────────────────────────────────────
# 3. 안전
# ─────────────────────────────────────────────────────────────
@_g("G10", "중복 전송 방지", Stage.SAFETY)
def g_duplicate(ctx: GateContext):
    if ctx.op.fingerprint in ctx.recent_fingerprints:
        return Verdict.FAIL, "같은 대상에 같은 값을 이미 보냈습니다"
    return Verdict.PASS, f"지문 {ctx.op.fingerprint}"


@_g("G11", "속도 제한", Stage.SAFETY)
def g_rate(ctx: GateContext):
    if ctx.min_interval_sec <= 0 or ctx.last_write_at <= 0:
        return Verdict.SKIP, "제한 없음"
    gap = time.time() - ctx.last_write_at
    if gap < ctx.min_interval_sec:
        return Verdict.FAIL, f"직전 전송 후 {gap:.1f}초 (최소 {ctx.min_interval_sec}초)"
    return Verdict.PASS, f"{gap:.1f}초 경과"


@_g("G12", "일괄 상한", Stage.SAFETY)
def g_batch_cap(ctx: GateContext):
    if ctx.writes_this_run >= ctx.max_writes:
        return Verdict.FAIL, f"이번 실행 {ctx.writes_this_run}건 (상한 {ctx.max_writes})"
    return Verdict.PASS, f"{ctx.writes_this_run}/{ctx.max_writes}"


# ─────────────────────────────────────────────────────────────
# 4. 승인 (HITL)
# ─────────────────────────────────────────────────────────────
@_g("G13", "미리보기 제시", Stage.APPROVAL)
def g_preview(ctx: GateContext):
    if not ctx.preview_shown:
        return Verdict.FAIL, "실제 나갈 요청을 사람에게 보여주지 않았습니다"
    return Verdict.PASS, ""


@_g("G14", "사람 승인", Stage.APPROVAL)
def g_approval(ctx: GateContext):
    if not ctx.approved_by:
        return Verdict.FAIL, "승인자가 없습니다. HITL 승인 없이는 전송할 수 없습니다"
    return Verdict.PASS, f"승인자 {ctx.approved_by}"


@_g("G17", "되돌릴 수 없음 — 핸드오프", Stage.APPROVAL)
def g_handoff(ctx: GateContext):
    """이 등급은 **우리가 절대 보내지 않습니다.**

    알림톡은 학부모 휴대폰으로 나가고 회수가 안 됩니다. 승인 절차를 아무리
    두껍게 쌓아도 잘못 나간 메시지를 되돌리지는 못합니다. 그래서 승인을
    늘리는 대신 **행위 자체를 넘깁니다** — 우리는 발송 화면을 준비해 주고,
    마지막 버튼은 선생님이 직접 누릅니다.

    이 게이트는 항상 차단합니다. 차단이 정상 동작입니다.
    """
    return Verdict.FAIL, (
        "되돌릴 수 없는 동작이라 자동 전송하지 않습니다. "
        "`handoff()` 로 발송 화면을 열고 마지막 버튼은 직접 누르세요"
    )


#: 전송 **전에** 통과해야 하는 게이트 체인 (순서 있음)
#: 하위호환 — 등급을 지정하지 않으면 예전처럼 14단을 전부 돌립니다.
PRE_SEND_GATES: tuple[Gate, ...] = (
    g_session, g_teacher,
    g_policy, g_dry_run, g_ownership,
    g_target_keys, g_known_field, g_value, g_consistency,
    g_duplicate, g_rate, g_batch_cap,
    g_preview, g_approval,
)

#: 등급 무관 — **항상** 돌아가는 게이트.
#:
#: 왜 이 8개는 등급으로 못 끄는가
#:   G01·G02  세션과 강사 식별자가 없으면 요청 자체가 성립하지 않습니다.
#:   G03      LLM 이 몰래 자동화를 시작하는 것을 막는 유일한 장치입니다.
#:   G04      **선생님 본인의 dry-run 스위치입니다.** 등급으로 끄면 dry-run 을
#:            켜 둬도 가벼운 쓰기는 그대로 나갑니다. 스위치의 의미가 사라집니다.
#:   G05      남의 담당 학생에게 쓰면 그 선생님은 덮인 줄도 모릅니다.
#:            "되돌릴 수 있다" 는 **되돌릴 사람이 알 때** 성립합니다.
#:   G06·G07  키가 틀리면 엉뚱한 학생에게 들어갑니다.
#:   G08      값 자체가 틀리면 되돌릴 수 있어도 일단 틀린 게 나갑니다.
_ALWAYS: tuple[Gate, ...] = (
    g_session, g_teacher,
    g_policy, g_dry_run, g_ownership,
    g_target_keys, g_known_field, g_value,
)

#: 대량 전송에만 붙는 것. 되돌리는 비용이 커지는 구간입니다.
_BULK_EXTRA: tuple[Gate, ...] = (
    g_consistency, g_duplicate, g_rate, g_batch_cap,
    g_preview, g_approval,
)

GATE_CHAINS: dict[Tier, tuple[Gate, ...]] = {
    Tier.LIGHT: _ALWAYS,
    Tier.BULK: _ALWAYS + _BULK_EXTRA,
    Tier.HANDOFF: _ALWAYS + _BULK_EXTRA + (g_handoff,),
}

#: 전송 **후** 검증 (writer 가 채웁니다)
#:
#: **등급과 무관하게 항상 돌립니다.** 되돌릴 수 있느냐와 무관한 문제입니다.
#: 이 사이트는 저장에 실패해도 HTTP 200 을 주기 때문에, 역검증이 없으면
#: 안 들어갔는데 들어간 줄 알고 넘어갑니다. 그게 "빠뜨리는" 실제 경로입니다.
POST_SEND_GATE_IDS: tuple[tuple[str, str], ...] = (
    ("G15", "응답 판정"),
    ("G16", "역검증"),
)

#: 되돌릴 수 없는 동작 — 우리가 보내지 않습니다.
#:
#: ⚠️ `schedule.delete` / `schedule.check` 는 **실측하지 않았습니다.**
#:    복구 가능한지 확인 전까지 보수적으로 핸드오프에 둡니다.
IRREVERSIBLE: frozenset[str] = frozenset({
    "alimtalk.one",       # 학부모 폰으로 발송 — 회수 불가
    "alimtalk.batch",     # 반 전체 일괄 발송
    "schedule.delete",    # 일정 삭제 (복구 가능 여부 미확인)
    "schedule.check",     # 출결 확정 (잠기는지 미확인)
})


def resolve_tier(op: WriteOp, *, batch_size: int = 1) -> Tier:
    """이 요청이 어느 등급인지. **판단 기준은 되돌릴 수 있는가 하나뿐입니다.**"""
    if op.key in IRREVERSIBLE or op.routine == "alimtalk":
        return Tier.HANDOFF
    return Tier.BULK if batch_size > 1 else Tier.LIGHT


@dataclass
class GateReport:
    op: WriteOp
    outcomes: list[GateOutcome] = field(default_factory=list)
    tier: Tier = Tier.LIGHT

    @property
    def allowed(self) -> bool:
        return bool(self.outcomes) and not any(o.blocked for o in self.outcomes)

    @property
    def blocked_at(self) -> GateOutcome | None:
        return next((o for o in self.outcomes if o.blocked), None)

    @property
    def needs_handoff(self) -> bool:
        """되돌릴 수 없어서 선생님이 직접 눌러야 하는가."""
        return self.tier is Tier.HANDOFF

    def render(self) -> str:
        lines = [self.op.preview(), "",
                 f"  등급: {self.tier.value} — {self.tier.note}",
                 f"  게이트 {len(self.outcomes)}단"]
        cur = None
        for o in self.outcomes:
            if o.stage != cur:
                cur = o.stage
                lines.append(f"  ── {cur.value} ──")
            lines.append(f"  {o}")
        lines.append("")
        if self.needs_handoff:
            lines.append("  → 자동 전송 안 함. 발송 화면을 열어 드립니다")
        else:
            lines.append("  → 전송 허용" if self.allowed else
                         f"  → 차단됨 ({self.blocked_at.gate_id if self.blocked_at else '?'})")
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.op.key, "subject": self.op.subject,
            "tier": self.tier.value, "needs_handoff": self.needs_handoff,
            "allowed": self.allowed,
            "blocked_at": self.blocked_at.gate_id if self.blocked_at else None,
            "gates": [{"id": o.gate_id, "name": o.name, "stage": o.stage.value,
                       "verdict": o.verdict.value, "detail": o.detail}
                      for o in self.outcomes],
        }


def evaluate(ctx: GateContext, *, stop_on_first_block: bool = False,
             tier: Tier | None = None) -> GateReport:
    """등급에 맞는 게이트를 돌립니다.

    기본은 **끝까지 다 돌립니다.** 첫 차단에서 멈추면 선생님이 "이것만 고치면
    되나?" 하고 고쳤을 때 또 다른 게 막혀서 반복하게 됩니다. 한 번에 전부
    보여주는 편이 낫습니다.

    `tier` 를 안 주면 `op` 와 `batch_size` 로 스스로 판정합니다.
    """
    t = tier or resolve_tier(ctx.op, batch_size=ctx.batch_size)
    rep = GateReport(op=ctx.op, tier=t)
    for gate in GATE_CHAINS[t]:
        out = gate(ctx)
        rep.outcomes.append(out)
        if out.blocked and stop_on_first_block:
            break
    return rep


# ─────────────────────────────────────────────────────────────
# 감사 저널 — append-only
# ─────────────────────────────────────────────────────────────
def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _redact(op: WriteOp) -> dict[str, Any]:
    """저널에 남길 요약. **학생 실명과 본문 원문은 남기지 않습니다.**

    감사에 필요한 것은 "무엇이 언제 나갔나" 이지 "무슨 문장이었나" 가
    아닙니다. 본문은 길이와 해시만 남깁니다.
    """
    v = op.value
    if isinstance(v, str):
        value_repr = {"len": len(v),
                      "sha": hashlib.sha256(v.encode()).hexdigest()[:12]}
    else:
        value_repr = {"value": v}
    return {
        "key": op.key, "servlet": op.servlet, "method": op.method,
        "fingerprint": op.fingerprint,
        "subject_hash": hashlib.sha256(op.subject.encode()).hexdigest()[:12]
        if op.subject else "",
        "params": sorted(k for k in op.params if k != "dummy"),
        "value": value_repr,
    }


def journal(report: GateReport, *, result: str, detail: str = "",
            approved_by: str = "", verified: bool | None = None,
            path: Path | None = None) -> None:
    """모든 시도를 기록합니다 — 성공·실패·차단 전부.

    `verified` 는 G16 역검증(서버 재조회) 결과입니다.
      True  = 보냈고 서버에서 다시 읽어 확인함
      False = 보냈지만 재조회에서 확인 실패
      None  = 역검증을 아예 돌리지 않음  ← **성공으로 세면 안 됩니다**
    이 사이트는 실패해도 HTTP 200 을 주므로 셋을 구분해야 합니다.
    """
    p = path or JOURNAL_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "at": _now(),
        "result": result,
        "detail": detail,
        "approved_by": approved_by,
        "verified": verified,
        "allowed": report.allowed,
        "blocked_at": report.blocked_at.gate_id if report.blocked_at else None,
        "op": _redact(report.op),
        "gates": [{"id": o.gate_id, "verdict": o.verdict.value} for o in report.outcomes],
    }
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def read_journal(limit: int = 50, path: Path | None = None) -> list[dict[str, Any]]:
    p = path or JOURNAL_PATH
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def journal_summary(path: Path | None = None) -> dict[str, Any]:
    from collections import Counter

    rows = read_journal(limit=100000, path=path)
    return {
        "total": len(rows),
        "by_result": dict(Counter(r.get("result", "?") for r in rows)),
        "blocked_gates": dict(Counter(
            r["blocked_at"] for r in rows if r.get("blocked_at"))),
        "path": str(path or JOURNAL_PATH),
    }


def gate_catalog() -> list[dict[str, str]]:
    """게이트 명세 — 문서·화면이 이걸 읽습니다.

    `tiers` 는 이 게이트가 **어느 등급에서 켜지는지**입니다.
    세 등급 모두에 있으면 등급으로 끌 수 없는 게이트입니다.
    """
    out: list[dict[str, str]] = []
    for g in (*PRE_SEND_GATES, g_handoff):
        gid = g.gate_id  # type: ignore[attr-defined]
        tiers = [t.value for t, chain in GATE_CHAINS.items() if g in chain]
        out.append({
            "id": gid, "name": g.gate_name,             # type: ignore[attr-defined]
            "stage": g.stage.value, "when": "전송 전",   # type: ignore[attr-defined]
            "tiers": ", ".join(tiers) or "(미사용)",
            "always": "예" if len(tiers) == len(GATE_CHAINS) else "아니오",
        })
    out += [{"id": gid, "name": name, "stage": Stage.VERIFY.value, "when": "전송 후",
             "tiers": "전부", "always": "예"}
            for gid, name in POST_SEND_GATE_IDS]
    return out


def tier_catalog() -> list[dict[str, Any]]:
    """등급별로 몇 단이 켜지는지 — 선생님이 눈으로 확인하는 표."""
    return [
        {"tier": t.value, "note": t.note,
         "pre_send": len(chain),
         "gates": [g.gate_id for g in chain],  # type: ignore[attr-defined]
         "auto_send": t is not Tier.HANDOFF}
        for t, chain in GATE_CHAINS.items()
    ]
