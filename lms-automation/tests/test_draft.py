# -*- coding: utf-8 -*-
"""
초안 생성 파이프라인 테스트.

가장 중요한 것: **승격 원장이 실제로 강제되는가.**
원장이 manual 인데 LLM 이 초안을 만들면 "몰래 자동화" 가 시작된 것입니다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import needs_pdf  # noqa: E402

from ganga import students as S  # noqa: E402
from ganga.pipeline.draft import (  # noqa: E402
    FIELD_TO_POLICY,
    build_context,
    class_report,
    draft_for_class,
    draft_for_student,
)
from ganga.policy import Ledger  # noqa: E402


@pytest.fixture
def db(tmp_path):
    conn = S.connect(tmp_path / "students.db")
    S.register(conn, login_id="a", name="홍길동",
               book_grade="중2", book_level="가우스", book_term=2, book_volume=3,
               stu_pri_no="98765", course_seq="12345", cm_seq="11223")
    S.add_observation(conn, "a", "이등변삼각형 증명을 스스로 완성함")
    yield conn
    conn.close()


@pytest.fixture
def led(tmp_path):
    return Ledger(path=tmp_path / "policy.json")


class FakeAdapter:
    """항상 같은 JSON 을 돌려주는 가짜 모델."""

    name = "fake"

    def __init__(self):
        self.calls = 0

    def complete(self, system, user):  # noqa: ARG002
        self.calls += 1
        return json.dumps({
            "progress_text": "도형의 성질 단원을 학습했습니다.",
            "homework_text": "다음 소단원을 예습해 옵니다.",
            "daily_memo": "증명 과정을 스스로 완성했습니다.",
        }, ensure_ascii=False)


# ─────────────────────────────────────────────────────────────
# 승격 원장 강제 — 이 파일의 핵심
# ─────────────────────────────────────────────────────────────
def test_원장이_전부_수동이면_초안을_만들지_않는다(db, led):
    """기본 상태(전 항목 manual)에서 LLM 이 호출되면 안 됩니다."""
    fake = FakeAdapter()
    r = draft_for_student(db, "a", date="2026-08-20", session_no=1,
                          adapter=fake, ledger=led)

    assert fake.calls == 0, "원장이 manual 인데 LLM 을 불렀습니다"
    assert r.draft.progress_text == ""
    assert r.draft.homework_text == ""
    assert r.draft.daily_memo == ""
    assert all("원장차단" in v for v in r.field_source.values())
    assert any("수동" in a for a in r.audit)


@needs_pdf
def test_승격한_항목만_초안이_만들어진다(db, led):
    led.promote("day_record", "progress")     # manual → suggest
    r = draft_for_student(db, "a", date="2026-08-20", session_no=1,
                          adapter=FakeAdapter(), ledger=led)

    assert r.draft.progress_text, "승격된 항목이 비었습니다"
    assert r.draft.homework_text == "", "승격 안 된 항목이 채워졌습니다"
    assert "원장차단" in r.field_source["homework_text"]
    assert "원장차단" not in r.field_source["progress_text"]


@needs_pdf
def test_세_항목을_모두_승격하면_모두_생성된다(db, led):
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)
    r = draft_for_student(db, "a", date="2026-08-20", session_no=1,
                          adapter=FakeAdapter(), ledger=led)
    assert r.draft.progress_text and r.draft.homework_text and r.draft.daily_memo


def test_원장_강등하면_다시_막힌다(db, led):
    led.promote("day_record", "progress")
    led.demote("day_record", "progress")
    r = draft_for_student(db, "a", date="2026-08-20", session_no=1,
                          adapter=FakeAdapter(), ledger=led)
    assert r.draft.progress_text == ""


# ─────────────────────────────────────────────────────────────
# 재료가 없으면 만들지 않는다
# ─────────────────────────────────────────────────────────────
def test_관찰메모가_없으면_메모를_비운다(db, led, tmp_path):
    """재료 없이 쓰라고 하는 것이 환각의 조건입니다."""
    conn = S.connect(tmp_path / "empty.db")
    S.register(conn, login_id="b", name="무관찰",
               book_grade="중2", book_level="가우스", book_term=2, book_volume=3)
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)

    r = draft_for_student(conn, "b", date="2026-08-20", session_no=1,
                          adapter=FakeAdapter(), ledger=led)
    assert r.draft.daily_memo == ""
    assert r.field_source["daily_memo"] == "재료없음"
    conn.close()


def test_교재가_없으면_차단사유에_남는다(db, led, tmp_path):
    conn = S.connect(tmp_path / "nobook.db")
    S.register(conn, login_id="c", name="교재없음")
    r = draft_for_student(conn, "c", date="2026-08-20", session_no=1, ledger=led)
    assert any("교재" in b for b in r.blockers)
    conn.close()


def test_없는_학생은_차단사유(db, led):
    r = draft_for_student(db, "nobody", date="2026-08-20", ledger=led)
    assert any("학생 없음" in b for b in r.blockers)


# ─────────────────────────────────────────────────────────────
# 결석
# ─────────────────────────────────────────────────────────────
def test_결석이면_초안을_만들지_않고_완결로_본다(db, led):
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)
    fake = FakeAdapter()
    r = draft_for_student(db, "a", date="2026-08-20", session_no=1,
                          adapter=fake, ledger=led, attendance="N")

    assert fake.calls == 0, "결석인데 LLM 을 불렀습니다"
    assert r.draft.progress_text == ""
    assert r.status is not None and r.status.is_complete
    assert all("결석" in v for v in r.field_source.values())


def test_결석이면_진도_재료를_모으지_않는다(db):
    ctx, _ = build_context(db, "a", date="2026-08-20", session_no=1, attendance="N")
    assert ctx.today == [] and ctx.homework == []
    assert ctx.attendance == "N"


# ─────────────────────────────────────────────────────────────
# 재료 수집
# ─────────────────────────────────────────────────────────────
@needs_pdf
def test_진도계획에서_이번회차_소단원을_가져온다(db):
    ctx, blockers = build_context(db, "a", date="2026-08-20", session_no=1)
    assert ctx.today, f"진도 재료가 비었습니다. blockers={blockers}"
    assert "가우스" in ctx.today[0].textbook


@needs_pdf
def test_범위밖_회차는_차단사유(db):
    _, blockers = build_context(db, "a", date="2026-08-20", session_no=9999)
    assert any("계획 범위" in b for b in blockers)


def test_식별키가_없으면_차단사유(db, tmp_path):
    conn = S.connect(tmp_path / "nokey.db")
    S.register(conn, login_id="d", name="키없음",
               book_grade="중2", book_level="가우스", book_term=2, book_volume=3)
    _, blockers = build_context(conn, "d", date="2026-08-20", session_no=1)
    assert any("식별키" in b for b in blockers)
    conn.close()


def test_식별키가_컨텍스트에_실린다(db):
    ctx, _ = build_context(db, "a", date="2026-08-20", session_no=1)
    assert ctx.stu_pri_no == "98765"
    assert ctx.keys()["cm_seq"] == "11223"


def test_지난진도가_있으면_재료에_들어간다(db):
    S.log_progress(db, "a", date="2026-08-18", session_no=1, status="완료",
                   actual="도형의 성질 · 1 이등변삼각형의 성질")
    ctx, _ = build_context(db, "a", date="2026-08-20", session_no=2)
    assert "이등변삼각형" in ctx.previous_progress


def test_오답유형은_관찰이_있을때만_보조로_붙는다(db, tmp_path):
    for _ in range(3):
        S.log_error(db, "a", tag="계산실수")
    ctx, _ = build_context(db, "a", date="2026-08-20", session_no=1)
    assert any("계산실수" in o for o in ctx.observations)

    conn = S.connect(tmp_path / "noobs.db")
    S.register(conn, login_id="e", name="관찰없음",
               book_grade="중2", book_level="가우스", book_term=2, book_volume=3)
    for _ in range(3):
        S.log_error(conn, "e", tag="계산실수")
    ctx2, _ = build_context(conn, "e", date="2026-08-20", session_no=1)
    assert ctx2.observations == [], "관찰이 없는데 오답요약만 넣으면 재료가 아닙니다"
    conn.close()


# ─────────────────────────────────────────────────────────────
# 전송하지 않는다
# ─────────────────────────────────────────────────────────────
def test_초안생성은_서버를_건드리지_않는다(db, led, monkeypatch):
    """draft 모듈이 실수로 writer 를 부르면 즉시 실패해야 합니다."""
    import ganga.lms.writer as W

    def boom(*a, **k):
        raise AssertionError("초안 생성이 전송을 시도했습니다")

    monkeypatch.setattr(W.DayRecordWriter, "write", boom)
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)
    draft_for_student(db, "a", date="2026-08-20", session_no=1,
                      adapter=FakeAdapter(), ledger=led)


# ─────────────────────────────────────────────────────────────
# 반 전체
# ─────────────────────────────────────────────────────────────
def test_반전체_초안과_보고서(db, led):
    S.register(db, login_id="b", name="이서준",
               book_grade="중2", book_level="가우스", book_term=2, book_volume=3,
               stu_pri_no="1", course_seq="2", cm_seq="3")
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)

    rs = draft_for_class(db, ["a", "b"], date="2026-08-20",
                         attendance={"b": "N"}, sessions={"a": 1, "b": 1},
                         adapter=FakeAdapter(), ledger=led)
    assert len(rs) == 2
    assert rs[1].draft.progress_text == "", "결석 학생에게 진도 초안이 생겼습니다"

    rep = class_report(rs)
    assert "홍길동" in rep and "이서준" in rep


def test_빈_반이면_그렇게_말한다():
    assert "없습니다" in class_report([])


# ─────────────────────────────────────────────────────────────
# 구독제 에이전트 모드 (--emit / --ingest)
# ─────────────────────────────────────────────────────────────
from ganga.pipeline.draft import emit_for_student, ingest_for_student  # noqa: E402


def test_emit은_모델을_부르지_않고_재료만_낸다(db, led):
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)
    req = emit_for_student(db, "a", date="2026-08-20", session_no=1, ledger=led)

    assert "facts" in req and "instruction" in req
    assert set(req["write_fields"]) == set(FIELD_TO_POLICY)
    assert req["allowed_tokens"], "허용 토큰 목록이 비었습니다"


def test_emit은_식별키를_노출하지_않는다(db, led):
    """문장 쓰는 데 필요 없고, 프롬프트에 샐 이유도 없습니다."""
    led.promote("day_record", "progress")
    req = emit_for_student(db, "a", date="2026-08-20", session_no=1, ledger=led)
    blob = json.dumps(req, ensure_ascii=False)
    for key in ("98765", "12345", "11223"):
        assert key not in blob, f"식별키 {key} 가 지시서에 노출됐습니다"


def test_emit은_원장이_막으면_건너뛰라고_한다(db, led):
    req = emit_for_student(db, "a", date="2026-08-20", session_no=1, ledger=led)
    assert "skip" in req and "수동" in req["skip"]


def test_emit은_결석이면_건너뛰라고_한다(db, led):
    led.promote("day_record", "progress")
    req = emit_for_student(db, "a", date="2026-08-20", session_no=1,
                           ledger=led, attendance="N")
    assert "skip" in req and "결석" in req["skip"]


def test_ingest는_에이전트_문장도_똑같이_검사한다(db, led):
    """에이전트가 썼다고 게이트를 봐주면 안 됩니다."""
    led.promote("day_record", "progress")
    r = ingest_for_student(db, "a", {"progress_text": "p.999 를 학습했습니다"},
                           date="2026-08-20", session_no=1, ledger=led)
    assert "999" not in r.draft.progress_text
    assert any("환각" in a for a in r.audit)


def test_ingest는_원장이_막은_필드를_버린다(db, led):
    """에이전트가 시키지 않은 칸을 채워 보내도 원장이 이깁니다."""
    led.promote("day_record", "progress")   # progress 만 허용
    r = ingest_for_student(db, "a", {
        "progress_text": "도형의 성질 단원을 진행했습니다",
        "daily_memo": "원장이 막았는데 채워 보낸 값",
    }, date="2026-08-20", session_no=1, ledger=led)

    assert r.draft.daily_memo == "", "원장이 막은 항목이 통과했습니다"
    assert any("원장이 막은" in a for a in r.audit)
    assert r.draft.progress_text


def test_ingest_정상문장은_통과한다(db, led):
    led.promote("day_record", "progress")
    r = ingest_for_student(db, "a", {"progress_text": "도형의 성질 단원을 진행했습니다"},
                           date="2026-08-20", session_no=1, ledger=led)
    assert r.draft.progress_text
    assert r.field_source["progress_text"] == "agent"


@needs_pdf
def test_템플릿은_완료를_단정하지_않는다(db, led):
    """계획한 소단원을 그 회차에 다 못 나가는 일이 흔합니다.
    '학습했습니다' 로 써버리면 절반만 나갔어도 완료로 기록됩니다."""
    for key in FIELD_TO_POLICY.values():
        led.promote("day_record", key)
    r = draft_for_student(db, "a", date="2026-08-20", session_no=1, ledger=led)
    assert "학습했습니다" not in r.draft.progress_text
    assert r.draft.progress_text.endswith("진행")


def test_AgentAdapter는_호출하면_안내와_함께_실패한다():
    from ganga.pipeline.llm import AgentAdapter

    with pytest.raises(NotImplementedError, match="emit"):
        AgentAdapter().complete("s", "u")
