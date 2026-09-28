# -*- coding: utf-8 -*-
"""
LLM 어댑터 — 수업일지 문장 생성.

LLM 의 권한 범위 (의도적으로 매우 좁습니다)
    할 수 있는 것 : 주어진 사실을 자연스러운 한국어 문장으로 다듬기
    할 수 없는 것 : 학생 지정 · 교재/페이지/문항 결정 · 점수 결정 ·
                    전송 여부 결정 · 성공 판정

환각 방지 3중 장치
    1. **사실 주입**  — 교재·페이지·문항·점수를 전부 프롬프트에 명시하고,
                       "여기 없는 것은 절대 쓰지 마라"를 시스템 규칙으로 못박음
    2. **숫자 화이트리스트** — 생성문의 모든 숫자가 `ctx.allowed_tokens()` 안에
                       있는지 대조. 없는 숫자가 나오면 그 시도는 폐기
    3. **게이트** — `gate_llm_output` 으로 메타발화·주입·길이 검사

셋 중 하나라도 걸리면 재시도하고, 재시도를 다 쓰면 **템플릿으로 폴백**합니다.
템플릿은 사실을 그대로 이어붙이므로 환각이 원천적으로 불가능합니다.
즉 최악의 경우에도 파이프라인은 결정론적으로 끝납니다.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Protocol

from .gates import MAX_HOMEWORK, MAX_MEMO, MAX_PROGRESS, gate_llm_output
from .schema import DayRecordContext, DayRecordDraft

# ─────────────────────────────────────────────────────────────
# 프롬프트
# ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
너는 '강의하는아이들' 수학학원 강사의 수업일지 작성을 돕는다.
이 글은 학부모가 데일리리포트로 그대로 받아보는 공식 기록이다.

절대 규칙:
1. 아래 <사실> 블록에 없는 내용은 한 글자도 지어내지 마라.
   교재명·페이지·문항번호·점수는 <사실> 에 적힌 것만 쓴다.
2. <사실> 에 없는 숫자를 새로 만들지 마라.
3. 학생을 평가절하하거나 단정적으로 부정적인 표현을 쓰지 마라.
   ("못한다", "부족하다" 대신 "아직 익숙해지는 중", "반복 연습이 필요")
4. 과장하지 마라. <사실> 에 "완벽 통과"라고 없으면 완벽하다고 쓰지 마라.
5. 존댓말 평서문. 이모지 금지. 인사말·맺음말 금지.
6. 출력은 반드시 아래 JSON 스키마 하나만. 설명 문장을 덧붙이지 마라.

{{
  "progress_text": "오늘 진도. 1~2문장.",
  "homework_text": "다음 시간까지 과제. 1문장.",
  "daily_memo": "학부모용 코칭 메모. 2~3문장. 관찰된 것에 근거해서."
}}

길이 상한: progress_text {max_progress}자, homework_text {max_homework}자, daily_memo {max_memo}자.
해당 항목의 <사실> 이 비어 있으면 그 키의 값은 빈 문자열 "" 로 둬라.
"""

USER_PROMPT = """<사실>
{facts}
</사실>

위 사실만 사용해서 JSON 을 출력해라."""


def build_prompt(ctx: DayRecordContext) -> tuple[str, str]:
    system = SYSTEM_PROMPT.format(
        max_progress=MAX_PROGRESS, max_homework=MAX_HOMEWORK, max_memo=MAX_MEMO
    )
    return system, USER_PROMPT.format(facts=ctx.facts_block())


# ─────────────────────────────────────────────────────────────
# 어댑터 인터페이스
# ─────────────────────────────────────────────────────────────
class LlmAdapter(Protocol):
    """교체 가능한 LLM 백엔드."""

    name: str

    def complete(self, system: str, user: str) -> str:
        """모델 응답 원문을 돌려준다."""
        ...


class AnthropicAdapter:
    """Claude API 어댑터. API 키는 환경변수에서만 읽습니다."""

    name = "anthropic"

    def __init__(self, model: str = "claude-sonnet-5",
                 api_key_env: str = "ANTHROPIC_API_KEY",
                 timeout: int = 60) -> None:
        self.model = model
        self.api_key_env = api_key_env
        self.timeout = timeout

    @property
    def available(self) -> bool:
        return bool(os.environ.get(self.api_key_env))

    def complete(self, system: str, user: str) -> str:
        key = os.environ.get(self.api_key_env)
        if not key:
            raise RuntimeError(
                f"{self.api_key_env} 환경변수가 없습니다. "
                "API 키를 파일에 저장하지 말고 환경변수로 넣으세요."
            )
        import urllib.request

        body = json.dumps({
            "model": self.model,
            "max_tokens": 1024,
            # 결정론을 최대화 — 같은 입력에 같은 출력이 나오도록
            "temperature": 0,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        return "".join(b.get("text", "") for b in data.get("content", []))


class TemplateAdapter:
    """LLM 없이 사실만 이어붙이는 결정론적 폴백.

    환각이 구조적으로 불가능합니다. API 키가 없거나, LLM 출력이 계속
    게이트를 통과하지 못할 때 여기로 떨어집니다.
    """

    name = "template"

    def complete(self, system: str, user: str) -> str:  # noqa: ARG002
        raise NotImplementedError("TemplateAdapter 는 render_template() 을 씁니다.")


class AgentAdapter:
    """**구독제 에이전트 모드용.** 자기가 모델을 부르지 않습니다.

    Claude Code / Codex / Gemini CLI 를 구독으로 쓰는 환경에서는 API 키가
    없고, 있을 이유도 없습니다. 에이전트 **자신이** LLM 이기 때문입니다.
    그래서 파이프라인이 모델을 호출하는 대신 이렇게 나눕니다.

        1. `ganga draft --emit`   재료(사실 블록)와 지시문을 JSON 으로 내보냄
        2. 에이전트가 그걸 읽고 문장을 만듦  ← 여기가 구독료로 커버되는 부분
        3. `ganga draft --ingest` 만들어진 문장을 게이트에 통과시킴

    게이트·승격원장·환각검사는 **그대로 적용됩니다.** 에이전트가 자유롭게
    쓴 문장이라고 검사를 건너뛰면, 이 프로젝트가 지키려던 것이 무너집니다.
    """

    name = "agent"

    def complete(self, system: str, user: str) -> str:  # noqa: ARG002
        raise NotImplementedError(
            "AgentAdapter 는 모델을 호출하지 않습니다. "
            "`ganga draft --emit` 로 재료를 받아 문장을 만든 뒤 "
            "`ganga draft --ingest` 로 되돌려주세요."
        )


def emit_request(ctx: DayRecordContext, *, allowed_fields: list[str]) -> dict[str, Any]:
    """에이전트에게 넘길 작업 지시서를 만듭니다.

    식별키(stu_pri_no 등)는 넣지 않습니다. 문장을 쓰는 데 필요 없고,
    프롬프트에 새어나갈 이유도 없습니다.
    """
    system, user = build_prompt(ctx)
    return {
        "student": ctx.student_name,
        "instruction": system,
        "facts": user,
        "write_fields": allowed_fields,
        "limits": {"progress_text": MAX_PROGRESS, "homework_text": MAX_HOMEWORK,
                   "daily_memo": MAX_MEMO},
        # 숫자뿐 아니라 학생명·교재명도 포함됩니다. 이름을 정직하게.
        "allowed_tokens": sorted(ctx.allowed_tokens()),
        "rules": [
            "facts 에 없는 내용은 한 글자도 지어내지 마세요.",
            "allowed_tokens 에 없는 숫자를 쓰면 환각으로 보고 폐기합니다.",
            "write_fields 에 없는 키는 작성하지 마세요 (승격 원장이 막은 항목).",
            "출력은 write_fields 를 키로 갖는 JSON 하나만.",
        ],
    }


def ingest_response(
    ctx: DayRecordContext,
    payload: dict[str, str],
    *,
    allowed_fields: list[str],
) -> GenerationResult:
    """에이전트가 만든 문장을 **API 모드와 똑같은 검사**에 통과시킵니다.

    사람이 만들었든 에이전트가 만들었든 검사는 동일합니다.
    """
    allowed = ctx.allowed_tokens()
    audit: list[str] = []
    draft = DayRecordDraft(source="agent")
    rejected = False

    for key, limit in _FIELDS:
        if key not in allowed_fields:
            continue
        value = str(payload.get(key, "") or "").strip()
        if not value:
            continue

        g = gate_llm_output(value, limit=limit, label=key)
        if not g.ok:
            audit.append(f"{key} 게이트 실패 — {'; '.join(g.errors)}")
            rejected = True
            continue
        value = g.value["text"]
        audit.extend(g.warnings)

        bad = hallucinated_numbers(value, allowed)
        if bad:
            audit.append(f"{key} 에 사실에 없는 숫자 {bad} — 환각으로 판단해 폐기")
            rejected = True
            continue

        setattr(draft, key, value)

    if rejected or not (draft.progress_text or draft.homework_text or draft.daily_memo):
        fallback = render_template(ctx)
        fallback.audit = audit + ["에이전트 출력이 게이트를 통과하지 못해 템플릿으로 폴백"]
        fallback.source = "template(fallback)"
        return GenerationResult(fallback, attempts=1, fell_back=True)

    draft.audit = audit
    return GenerationResult(draft, attempts=1, fell_back=False)


def render_template(ctx: DayRecordContext) -> DayRecordDraft:
    """사실을 그대로 문장으로 조립합니다.

    ⚠️ **완료를 단정하지 않습니다.** 계획한 소단원을 그 회차에 다 못 나가는
    일이 흔합니다. "학습했습니다" 라고 써버리면 실제로는 절반만 나갔는데
    완료로 기록되고, 그게 학부모 리포트로 나갑니다.
    실제 진행 정도는 선생님이 검토하면서 고칩니다.
    """
    progress = ", ".join(f.as_phrase() for f in ctx.today)
    if progress:
        progress += " 진행"

    homework = ", ".join(f.as_phrase() for f in ctx.homework)
    if homework:
        homework += " 예정"

    memo = ""
    if ctx.observations:
        memo = " ".join(
            o if o.rstrip().endswith((".", "다", "요")) else f"{o}."
            for o in ctx.observations
        )

    return DayRecordDraft(
        progress_text=progress, homework_text=homework, daily_memo=memo,
        source="template", audit=["템플릿으로 생성 (LLM 미사용)"],
    )


# ─────────────────────────────────────────────────────────────
# 환각 검사
# ─────────────────────────────────────────────────────────────
#: 문장에서 뽑아낼 숫자. 조사·단위가 붙어 있어도 잡습니다.
_NUM = re.compile(r"\d+")

#: 사실 대조에서 제외할 관용 숫자 (1~2문장 같은 표현, 서수)
_BENIGN = {"1", "2", "3"}


def hallucinated_numbers(text: str, allowed: set[str]) -> list[str]:
    """생성문에서 사실 목록에 없는 숫자를 찾아냅니다.

    페이지·문항번호 환각이 학부모 리포트로 나가는 것을 막는 마지막 방어선입니다.
    """
    found = set(_NUM.findall(text))
    return sorted(found - allowed - _BENIGN)


@dataclass
class GenerationResult:
    draft: DayRecordDraft
    attempts: int
    fell_back: bool


# ─────────────────────────────────────────────────────────────
# 파이프라인
# ─────────────────────────────────────────────────────────────
_FIELDS = (
    ("progress_text", MAX_PROGRESS),
    ("homework_text", MAX_HOMEWORK),
    ("daily_memo", MAX_MEMO),
)


def _parse_json(raw: str) -> dict[str, str]:
    """모델이 코드펜스를 둘러도 JSON 을 뽑아냅니다."""
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    start, end = s.find("{"), s.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"JSON 을 찾지 못했습니다: {raw[:120]}")
    obj = json.loads(s[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("최상위가 객체가 아닙니다")
    return {k: str(v or "") for k, v in obj.items()}


def draft_day_record(
    ctx: DayRecordContext,
    adapter: LlmAdapter | None = None,
    *,
    max_attempts: int = 3,
) -> GenerationResult:
    """수업일지 문장 3종을 생성합니다.

    LLM 이 없거나 계속 실패하면 템플릿으로 떨어지므로 **항상 결과가 나옵니다.**
    호출자는 `result.fell_back` 으로 LLM 이 쓰였는지 확인할 수 있습니다.
    """
    if adapter is None or isinstance(adapter, TemplateAdapter):
        return GenerationResult(render_template(ctx), attempts=0, fell_back=True)

    system, user = build_prompt(ctx)
    allowed = ctx.allowed_tokens()
    audit: list[str] = []

    for attempt in range(1, max_attempts + 1):
        try:
            raw = adapter.complete(system, user)
            parsed = _parse_json(raw)
        except Exception as exc:  # noqa: BLE001
            audit.append(f"시도 {attempt}: 응답 파싱 실패 — {exc}")
            continue

        draft = DayRecordDraft(source=adapter.name)
        rejected = False

        for key, limit in _FIELDS:
            value = parsed.get(key, "").strip()
            if not value:
                continue

            g = gate_llm_output(value, limit=limit, label=key)
            if not g.ok:
                audit.append(f"시도 {attempt}: {key} 게이트 실패 — {'; '.join(g.errors)}")
                rejected = True
                break
            value = g.value["text"]
            audit.extend(f"시도 {attempt}: {w}" for w in g.warnings)

            bad = hallucinated_numbers(value, allowed)
            if bad:
                audit.append(
                    f"시도 {attempt}: {key} 에 사실에 없는 숫자 {bad} — 환각으로 판단해 폐기"
                )
                rejected = True
                break

            setattr(draft, key, value)

        if rejected:
            continue

        if not (draft.progress_text or draft.homework_text or draft.daily_memo):
            audit.append(f"시도 {attempt}: 모든 필드가 비어 있음")
            continue

        draft.audit = audit
        return GenerationResult(draft, attempts=attempt, fell_back=False)

    # 재시도 소진 → 결정론적 폴백
    fallback = render_template(ctx)
    fallback.audit = audit + [
        f"{max_attempts}회 시도 모두 실패 — 템플릿으로 폴백했습니다."
    ]
    fallback.source = "template(fallback)"
    return GenerationResult(fallback, attempts=max_attempts, fell_back=True)
