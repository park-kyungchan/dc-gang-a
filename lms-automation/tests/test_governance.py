# -*- coding: utf-8 -*-
"""
쓰기 거버넌스 테스트.

이 파일이 지키는 것은 하나입니다: **승인 없이는 아무것도 나가지 않는다.**
게이트 하나가 조용히 무력화되면 그때부터 이 프로젝트는 위험한 도구가 됩니다.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.governance import (  # noqa: E402
    POST_SEND_GATE_IDS,
    PRE_SEND_GATES,
    GateContext,
    Stage,
    Verdict,
    WriteOp,
    evaluate,
    gate_catalog,
    journal,
    journal_summary,
    read_journal,
)


def make_op(**kw) -> WriteOp:
    base = dict(
        routine="day_record", field="progress",
        servlet="controller.cct.tutor.DayRecordServlet", method="GET",
        params={"stu_pri_no": "98765", "record_seq": "54321", "cm_seq": "11223",
                "prg_txt": "도형의 성질 진행", "dummy": "123"},
        subject="홍길동", value="도형의 성질 진행",
    )
    base.update(kw)
    return WriteOp(**base)


def ok_ctx(**kw) -> GateContext:
    """모든 게이트를 통과하는 기준 컨텍스트.

    `batch_size=2` 인 이유: 등급 재편 이후 **1건짜리 전송은 8단(가벼움)만**
    돌아갑니다. G09~G14 를 검사하는 기존 테스트들이 조용히 무의미해지지
    않도록, 기준 컨텍스트를 일괄(보통, 14단)로 둡니다.
    가벼움 등급은 아래 `등급 재편` 절에서 따로 다룹니다.
    """
    base = dict(
        op=make_op(), session_ok=True, teacher_pri_no="1292923",
        policy_mode="auto", dry_run=False, approved_by="박경찬",
        owns_student=True, known_field=True, preview_shown=True,
        batch_size=2,
    )
    base.update(kw)
    return GateContext(**base)


# ─────────────────────────────────────────────────────────────
# 기본은 거부
# ─────────────────────────────────────────────────────────────
def test_아무것도_설정하지_않으면_차단된다():
    """기본값이 통과이면 안 됩니다."""
    rep = evaluate(GateContext(op=make_op()))
    assert not rep.allowed
    assert rep.blocked_at is not None


def test_전부_갖추면_통과한다():
    rep = evaluate(ok_ctx())
    assert rep.allowed, rep.render()


@pytest.mark.parametrize("override,expect_gate", [
    ({"session_ok": False}, "G01"),
    ({"teacher_pri_no": ""}, "G02"),
    ({"policy_mode": "manual"}, "G03"),
    ({"policy_mode": "suggest"}, "G03"),
    ({"dry_run": True}, "G04"),
    ({"owns_student": False}, "G05"),
    ({"owns_student": None}, "G05"),
    ({"known_field": False}, "G07"),
    ({"value_errors": ["200자 초과"]}, "G08"),
    ({"consistency_errors": ["결석인데 진도 있음"]}, "G09"),
    ({"preview_shown": False}, "G13"),
    ({"approved_by": ""}, "G14"),
])
def test_게이트가_각각_독립적으로_막는다(override, expect_gate):
    """하나만 어겨도 그 게이트에서 막혀야 합니다."""
    rep = evaluate(ok_ctx(**override))
    assert not rep.allowed
    blocked = {o.gate_id for o in rep.outcomes if o.blocked}
    assert expect_gate in blocked, f"{expect_gate} 가 막지 않았습니다: {blocked}"


def test_승인만_빼면_다른_게이트는_다_통과한다():
    """승인이 유일한 차단 사유임을 확인 — HITL 이 진짜 마지막 관문인가."""
    rep = evaluate(ok_ctx(approved_by=""))
    blocked = [o.gate_id for o in rep.outcomes if o.blocked]
    assert blocked == ["G14"], f"승인 외에 막힌 것: {blocked}"


def test_dry_run이_켜져있으면_승인해도_안나간다():
    rep = evaluate(ok_ctx(dry_run=True))
    assert not rep.allowed
    assert any(o.gate_id == "G04" and o.blocked for o in rep.outcomes)


# ─────────────────────────────────────────────────────────────
# 식별키
# ─────────────────────────────────────────────────────────────
def test_식별키가_비면_막는다():
    op = make_op(params={"stu_pri_no": "", "record_seq": "1", "cm_seq": "2"})
    rep = evaluate(ok_ctx(op=op))
    g6 = next(o for o in rep.outcomes if o.gate_id == "G06")
    assert g6.blocked and "stu_pri_no" in g6.detail


def test_식별키가_숫자가_아니면_막는다():
    op = make_op(params={"stu_pri_no": "abc", "record_seq": "1", "cm_seq": "2"})
    rep = evaluate(ok_ctx(op=op))
    assert next(o for o in rep.outcomes if o.gate_id == "G06").blocked


def test_루틴마다_필요한_키가_다르다():
    cism = make_op(routine="cism", field="i_1",
                   servlet="controller.cct.common.CourseCommonServlet",
                   params={"tutor_pri_no": "1292923", "the_date": "2026-08-20",
                           "field_name": "i_1"})
    assert evaluate(ok_ctx(op=cism)).allowed


def test_이상한_서블릿_경로를_막는다():
    op = make_op(servlet="evil.Servlet")
    rep = evaluate(ok_ctx(op=op))
    assert next(o for o in rep.outcomes if o.gate_id == "G07").blocked


# ─────────────────────────────────────────────────────────────
# 안전장치
# ─────────────────────────────────────────────────────────────
def test_같은_값_재전송을_막는다():
    op = make_op()
    rep = evaluate(ok_ctx(op=op, recent_fingerprints={op.fingerprint}))
    g10 = next(o for o in rep.outcomes if o.gate_id == "G10")
    assert g10.blocked and "이미" in g10.detail


def test_지문은_dummy를_무시한다():
    """타임스탬프 때문에 매번 다른 지문이 되면 중복검사가 무의미합니다."""
    a = make_op(params={"stu_pri_no": "1", "record_seq": "2", "cm_seq": "3",
                        "dummy": "111"})
    b = make_op(params={"stu_pri_no": "1", "record_seq": "2", "cm_seq": "3",
                        "dummy": "999"})
    assert a.fingerprint == b.fingerprint


def test_값이_다르면_지문도_다르다():
    a = make_op(params={"stu_pri_no": "1", "record_seq": "2", "cm_seq": "3",
                        "prg_txt": "가"})
    b = make_op(params={"stu_pri_no": "1", "record_seq": "2", "cm_seq": "3",
                        "prg_txt": "나"})
    assert a.fingerprint != b.fingerprint


def test_일괄_상한을_넘으면_막는다():
    rep = evaluate(ok_ctx(writes_this_run=50, max_writes=50))
    assert next(o for o in rep.outcomes if o.gate_id == "G12").blocked


def test_속도제한():
    rep = evaluate(ok_ctx(min_interval_sec=5.0, last_write_at=time.time()))
    assert next(o for o in rep.outcomes if o.gate_id == "G11").blocked

    rep2 = evaluate(ok_ctx(min_interval_sec=5.0, last_write_at=time.time() - 10))
    assert not next(o for o in rep2.outcomes if o.gate_id == "G11").blocked


def test_속도제한_미설정이면_해당없음():
    rep = evaluate(ok_ctx())
    assert next(o for o in rep.outcomes if o.gate_id == "G11").verdict is Verdict.SKIP


# ─────────────────────────────────────────────────────────────
# 미리보기 — 초반에 무엇이 나가는지 눈으로 봐야 합니다
# ─────────────────────────────────────────────────────────────
def test_미리보기에_메서드와_서블릿이_나온다():
    p = make_op().preview()
    assert "GET /servlet/controller.cct.tutor.DayRecordServlet" in p
    assert "홍길동" in p
    assert "day_record.progress" in p


def test_미리보기가_긴_본문을_요약한다():
    op = make_op(params={"stu_pri_no": "1", "record_seq": "2", "cm_seq": "3",
                         "prg_txt": "가" * 200})
    p = op.preview()
    assert "<200자>" in p
    assert "가" * 100 not in p


def test_미리보기에_dummy는_안나온다():
    assert "dummy" not in make_op().preview()


def test_보고서가_단계별로_묶여_나온다():
    r = evaluate(ok_ctx()).render()
    for stage in ("0.준비", "1.권한", "2.데이터", "3.안전", "4.승인"):
        assert stage in r
    assert "전송 허용" in r


# ─────────────────────────────────────────────────────────────
# 게이트 목록 자체가 계약
# ─────────────────────────────────────────────────────────────
def test_게이트가_17개다():
    """게이트가 조용히 사라지면 안 됩니다.

    16 → 17: 되돌릴 수 없는 동작을 항상 차단하는 G17(핸드오프)이 붙었습니다.
    등급 재편은 게이트를 **없앤 것이 아니라** 언제 켜지는지를 나눈 것입니다.
    """
    assert len(PRE_SEND_GATES) == 14
    assert len(POST_SEND_GATE_IDS) == 2
    assert len(gate_catalog()) == 17
    assert "G17" in {g["id"] for g in gate_catalog()}


def test_게이트ID가_중복되지_않는다():
    ids = [g["id"] for g in gate_catalog()]
    assert len(ids) == len(set(ids))


def test_모든_게이트가_결과를_남긴다():
    rep = evaluate(ok_ctx())
    assert len(rep.outcomes) == len(PRE_SEND_GATES)
    assert all(o.detail is not None for o in rep.outcomes)


def test_첫_차단에서_멈추지_않고_전부_보여준다():
    """한 번에 다 보여줘야 고치는 왕복이 줄어듭니다."""
    rep = evaluate(ok_ctx(session_ok=False, approved_by=""))
    assert len(rep.outcomes) == len(PRE_SEND_GATES)
    assert len([o for o in rep.outcomes if o.blocked]) >= 2


def test_옵션으로_첫_차단에서_멈출_수도_있다():
    rep = evaluate(ok_ctx(session_ok=False), stop_on_first_block=True)
    assert len(rep.outcomes) == 1


# ─────────────────────────────────────────────────────────────
# 감사 저널
# ─────────────────────────────────────────────────────────────
def test_차단된_시도도_기록된다(tmp_path):
    p = tmp_path / "j.jsonl"
    rep = evaluate(ok_ctx(approved_by=""))
    journal(rep, result="BLOCKED", detail="승인 없음", path=p)

    rows = read_journal(path=p)
    assert len(rows) == 1
    assert rows[0]["result"] == "BLOCKED"
    assert rows[0]["blocked_at"] == "G14"


def test_저널에_학생실명이_남지_않는다(tmp_path):
    """개인정보는 감사에 필요 없습니다. 해시만 남깁니다."""
    p = tmp_path / "j.jsonl"
    journal(evaluate(ok_ctx()), result="SENT", path=p)
    raw = p.read_text(encoding="utf-8")
    assert "홍길동" not in raw


def test_저널에_본문원문이_남지_않는다(tmp_path):
    p = tmp_path / "j.jsonl"
    op = make_op(value="약분 원리를 스스로 설명했습니다")
    journal(evaluate(ok_ctx(op=op)), result="SENT", path=p)
    raw = p.read_text(encoding="utf-8")
    assert "약분 원리" not in raw
    entry = json.loads(raw.splitlines()[0])
    assert entry["op"]["value"]["len"] == len("약분 원리를 스스로 설명했습니다")
    assert entry["op"]["value"]["sha"]


def test_저널은_덧붙이기만_한다(tmp_path):
    p = tmp_path / "j.jsonl"
    for i in range(3):
        journal(evaluate(ok_ctx()), result=f"R{i}", path=p)
    assert len(read_journal(path=p)) == 3


def test_저널_요약(tmp_path):
    p = tmp_path / "j.jsonl"
    journal(evaluate(ok_ctx()), result="SENT", path=p)
    journal(evaluate(ok_ctx(approved_by="")), result="BLOCKED", path=p)
    s = journal_summary(path=p)
    assert s["total"] == 2
    assert s["by_result"]["SENT"] == 1
    assert s["blocked_gates"]["G14"] == 1


def test_저널이_없으면_빈_목록(tmp_path):
    assert read_journal(path=tmp_path / "none.jsonl") == []
