# -*- coding: utf-8 -*-
"""
LLM 생성 계층 테스트 — 특히 환각 차단.

학부모에게 그대로 나가는 문서를 만드는 계층이므로, "그럴듯하지만 틀린 문장"이
빠져나가지 않는지가 핵심입니다. 네트워크 없이 가짜 어댑터로 검증합니다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.pipeline.llm import (  # noqa: E402
    AnthropicAdapter,
    TemplateAdapter,
    _parse_json,
    build_prompt,
    draft_day_record,
    hallucinated_numbers,
    render_template,
)
from ganga.pipeline.schema import DayRecordContext, DayRecordDraft, LessonFact  # noqa: E402


def make_ctx() -> DayRecordContext:
    return DayRecordContext(
        student_name="김민준",
        course_seq="12345", stu_pri_no="98765",
        record_seq="54321", cm_seq="11223",
        today=[LessonFact(textbook="초등 5-1 가우스 2권", page=31,
                          section="실력쌓기", problems="5~8번", result="완벽 통과")],
        homework=[LessonFact(textbook="초등 5-1 가우스 2권", page=32, problems="1~6번")],
        observations=["약분 원리를 스스로 설명함"],
        dt_score=10, hw_rate=5,
    )


class FakeAdapter:
    """지정한 JSON 을 그대로 돌려주는 가짜 모델."""

    name = "fake"

    def __init__(self, *responses: str):
        self.responses = list(responses)
        self.calls = 0

    def complete(self, system, user):  # noqa: ARG002
        self.calls += 1
        return self.responses[min(self.calls - 1, len(self.responses) - 1)]


def _json(**kw) -> str:
    base = {"progress_text": "", "homework_text": "", "daily_memo": ""}
    base.update(kw)
    return json.dumps(base, ensure_ascii=False)


# ─────────────────────────────────────────────────────────────
# 환각 차단
# ─────────────────────────────────────────────────────────────
def test_사실에_없는_페이지를_쓰면_폐기된다():
    ctx = make_ctx()   # 허용 페이지는 31, 32
    bad = FakeAdapter(_json(progress_text="초등 5-1 가우스 2권 p.312 실력쌓기를 학습했습니다"))
    r = draft_day_record(ctx, bad, max_attempts=2)

    assert r.fell_back, "환각인데 통과했습니다"
    assert any("환각" in a for a in r.draft.audit)
    assert "312" not in r.draft.progress_text


def test_사실에_없는_문항번호를_쓰면_폐기된다():
    ctx = make_ctx()   # 허용 문항은 5,6,7,8 / 1,6
    bad = FakeAdapter(_json(progress_text="p.31 실력쌓기 47번까지 풀었습니다"))
    r = draft_day_record(ctx, bad, max_attempts=1)
    assert r.fell_back


def test_사실에_있는_숫자만_쓰면_통과한다():
    ctx = make_ctx()
    good = FakeAdapter(_json(
        progress_text="초등 5-1 가우스 2권 p.31 실력쌓기 5~8번을 완벽하게 통과했습니다.",
        homework_text="초등 5-1 가우스 2권 p.32 1~6번을 과제로 진행합니다.",
        daily_memo="약분 원리를 스스로 설명했습니다.",
    ))
    r = draft_day_record(ctx, good, max_attempts=1)

    assert not r.fell_back
    assert r.attempts == 1
    assert "p.31" in r.draft.progress_text
    assert r.draft.source == "fake"


def test_hallucinated_numbers_직접_검사():
    allowed = {"31", "5", "8"}
    assert hallucinated_numbers("p.31 의 5~8번", allowed) == []
    assert hallucinated_numbers("p.99 를 풀었다", allowed) == ["99"]
    # 1,2,3 은 '1~2문장' 같은 관용 표현이라 제외
    assert hallucinated_numbers("2문장으로 정리", allowed) == []


# ─────────────────────────────────────────────────────────────
# 재시도와 폴백
# ─────────────────────────────────────────────────────────────
def test_첫시도_실패시_재시도한다():
    ctx = make_ctx()
    adapter = FakeAdapter(
        _json(progress_text="p.999 를 학습했습니다"),          # 환각 → 폐기
        _json(progress_text="p.31 실력쌓기 5~8번 완료했습니다"),  # 정상
    )
    r = draft_day_record(ctx, adapter, max_attempts=3)

    assert not r.fell_back
    assert r.attempts == 2
    assert adapter.calls == 2


def test_재시도를_다써도_결과가_나온다():
    """LLM 이 계속 실패해도 파이프라인이 멈추지 않아야 합니다."""
    ctx = make_ctx()
    always_bad = FakeAdapter(_json(progress_text="p.777 학습"))
    r = draft_day_record(ctx, always_bad, max_attempts=3)

    assert r.fell_back
    assert r.draft.source == "template(fallback)"
    assert r.draft.progress_text          # 템플릿이 채워줌
    assert "p.31" in r.draft.progress_text
    assert "777" not in r.draft.progress_text


def test_어댑터가_없으면_템플릿을_쓴다():
    r = draft_day_record(make_ctx(), None)
    assert r.fell_back
    assert r.draft.source == "template"
    assert r.attempts == 0


def test_모델이_JSON이_아닌_응답을_줘도_폴백한다():
    r = draft_day_record(make_ctx(), FakeAdapter("죄송하지만 도와드릴 수 없습니다"), max_attempts=2)
    assert r.fell_back
    assert any("파싱 실패" in a for a in r.draft.audit)


def test_메타발화는_게이트에서_차단된다():
    ctx = make_ctx()
    r = draft_day_record(
        ctx, FakeAdapter(_json(progress_text="As an AI language model, I cannot help")),
        max_attempts=1)
    assert r.fell_back
    assert any("게이트 실패" in a for a in r.draft.audit)


# ─────────────────────────────────────────────────────────────
# 템플릿 (결정론 보장)
# ─────────────────────────────────────────────────────────────
def test_템플릿은_사실만_사용한다():
    ctx = make_ctx()
    d = render_template(ctx)
    assert "초등 5-1 가우스 2권" in d.progress_text
    assert "p.31" in d.progress_text
    assert "5~8번" in d.progress_text
    assert hallucinated_numbers(d.progress_text, ctx.allowed_tokens()) == []


def test_템플릿은_같은_입력에_같은_출력을_낸다():
    ctx = make_ctx()
    assert render_template(ctx) == render_template(ctx)


def test_관찰이_없으면_메모를_만들지_않는다():
    ctx = make_ctx()
    ctx.observations = []
    assert render_template(ctx).daily_memo == ""


# ─────────────────────────────────────────────────────────────
# 스키마 / 프롬프트
# ─────────────────────────────────────────────────────────────
def test_식별키는_프롬프트에_노출되지_않는다():
    """stu_pri_no 같은 서버 키가 LLM 에게 갈 이유가 없습니다."""
    ctx = make_ctx()
    system, user = build_prompt(ctx)
    blob = system + user
    for key in ("98765", "54321", "11223", "12345"):
        assert key not in blob, f"식별키 {key} 가 프롬프트에 노출됨"


def test_프롬프트에_사실이_모두_들어간다():
    _, user = build_prompt(make_ctx())
    assert "초등 5-1 가우스 2권" in user
    assert "p.31" in user
    assert "약분 원리" in user


def test_페이로드_변환이_식별키를_보존한다():
    ctx = make_ctx()
    payload = render_template(ctx).to_payload(ctx)
    assert payload["stu_pri_no"] == "98765"
    assert payload["dt_score"] == 10
    assert payload["attendance"] == "Y"


def test_게이트와_연결된다():
    """생성 → 게이트 → 전송 준비까지 한 번에 통과하는지."""
    from ganga.pipeline.gates import gate_day_record

    ctx = make_ctx()
    payload = render_template(ctx).to_payload(ctx)
    g = gate_day_record(payload)
    assert g.ok, g.errors


def test_코드펜스로_감싼_JSON도_파싱한다():
    obj = _parse_json('```json\n{"progress_text": "완료"}\n```')
    assert obj["progress_text"] == "완료"


def test_API키가_없으면_available이_False():
    import os

    a = AnthropicAdapter(api_key_env="__NO_SUCH_KEY__")
    assert not a.available
    with pytest.raises(RuntimeError, match="환경변수"):
        a.complete("s", "u")
