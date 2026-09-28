# -*- coding: utf-8 -*-
"""
등급 재편 테스트 — 되돌릴 수 있는가로 게이트 수를 정한다.

배경
    "어차피 전송이라는 액션이 학원서버측 DB 저장 아닌가? 이거 언제든지
    내가 다시 수정할 수 있어." (사용자, 2026-08-20)

    맞습니다. 진도·숙제·메모·출결·DT 는 전부 덮어쓰기라 잘못 넣어도 다시
    넣으면 그만입니다. 여기에 16단을 다 태우면 선생님이 승인만 하다 하루가
    갑니다. 그래서 **되돌릴 수 있는가** 하나로 등급을 나눴습니다.

이 파일이 지키는 것
    1. 가벼움이라고 아무거나 통과시키지 않는다 (안전 8단은 못 끈다)
    2. 알림톡은 **어떤 경로로도 자동 발송되지 않는다**
    3. 대량이면 자동으로 등급이 올라간다
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.governance import (  # noqa: E402
    GATE_CHAINS,
    IRREVERSIBLE,
    GateContext,
    Tier,
    WriteOp,
    evaluate,
    read_journal,
    resolve_tier,
)
from ganga.lms.endpoints import alimtalk_url  # noqa: E402
from ganga.lms.gateway import WriteGateway  # noqa: E402
from ganga.policy import Ledger  # noqa: E402

from test_gateway import FakeLms  # noqa: E402


def make_op(**kw) -> WriteOp:
    base = dict(
        routine="day_record", field="progress",
        servlet="controller.cct.tutor.DayRecordServlet", method="GET",
        params={"stu_pri_no": "1235920", "record_seq": "1", "cm_seq": "82128",
                "prg_txt": "도형의 성질"},
        subject="홍길동", value="도형의 성질",
    )
    base.update(kw)
    return WriteOp(**base)


def ctx(**kw) -> GateContext:
    base = dict(
        op=make_op(), session_ok=True, teacher_pri_no="1292923",
        policy_mode="auto", dry_run=False, owns_student=True, known_field=True,
    )
    base.update(kw)
    return GateContext(**base)


# ─────────────────────────────────────────────────────────────
# 등급 판정
# ─────────────────────────────────────────────────────────────
def test_한명짜리_덮어쓰기는_가벼움():
    assert resolve_tier(make_op()) is Tier.LIGHT


def test_대량이면_자동으로_등급이_오른다():
    """되돌릴 수는 있지만 손으로 151번 고쳐야 하면 사실상 못 되돌립니다."""
    assert resolve_tier(make_op(), batch_size=2) is Tier.BULK
    assert resolve_tier(make_op(), batch_size=151) is Tier.BULK


def test_알림톡은_건수와_무관하게_핸드오프():
    one = make_op(routine="alimtalk", field="one")
    assert resolve_tier(one) is Tier.HANDOFF
    assert resolve_tier(one, batch_size=1) is Tier.HANDOFF


def test_되돌릴수없는_목록에_알림톡이_있다():
    assert "alimtalk.one" in IRREVERSIBLE
    assert "alimtalk.batch" in IRREVERSIBLE


# ─────────────────────────────────────────────────────────────
# 가벼움이라고 무방비가 아니다
# ─────────────────────────────────────────────────────────────
def test_가벼움은_승인_없이_통과한다():
    """이게 재편의 목적입니다 — 되돌릴 수 있는 1건에 승인을 요구하지 않습니다."""
    rep = evaluate(ctx(approved_by="", preview_shown=False))
    assert rep.tier is Tier.LIGHT
    assert rep.allowed, rep.render()
    assert len(rep.outcomes) == 8


@pytest.mark.parametrize("override,gate", [
    ({"session_ok": False}, "G01"),
    ({"teacher_pri_no": ""}, "G02"),
    ({"dry_run": True}, "G04"),
    ({"owns_student": False}, "G05"),
    ({"known_field": False}, "G07"),
    ({"value_errors": ["200자 초과"]}, "G08"),
])
def test_가벼움에서도_이것들은_막는다(override, gate):
    rep = evaluate(ctx(**override))
    assert not rep.allowed
    assert gate in {o.gate_id for o in rep.outcomes if o.blocked}


def test_dry_run은_등급으로_끌_수_없다():
    """선생님 본인의 스위치입니다.

    등급을 나누면서 G04 를 가벼움에서 빼면, dry-run 을 켜 둬도 가장 자주
    나가는 쓰기는 그대로 전송됩니다. 스위치의 의미가 사라집니다.
    """
    for tier, chain in GATE_CHAINS.items():
        ids = {getattr(g, "gate_id") for g in chain}
        assert "G04" in ids, f"{tier.value} 에 dry-run 게이트가 없습니다"
        assert "G05" in ids, f"{tier.value} 에 소유권 게이트가 없습니다"
        assert "G03" in ids, f"{tier.value} 에 승격 원장 게이트가 없습니다"


def test_식별키는_모든_등급에서_필수():
    """키가 틀리면 되돌릴 수 있어도 **엉뚱한 학생**에게 들어갑니다."""
    op = make_op(params={"stu_pri_no": "", "record_seq": "1", "cm_seq": "2"})
    assert not evaluate(ctx(op=op)).allowed


# ─────────────────────────────────────────────────────────────
# 승격 원장 — LLM 을 규율하는 것이지 선생님을 막는 게 아니다
# ─────────────────────────────────────────────────────────────
def test_선생님이_직접_친_값은_원장과_무관하다():
    """폰으로 직접 넣은 90점이 '원장이 manual 이라' 막히면 안 됩니다."""
    rep = evaluate(ctx(policy_mode="manual", value_origin="human"))
    assert rep.allowed, rep.render()


def test_LLM이_만든_값은_원장이_auto여야_한다():
    rep = evaluate(ctx(policy_mode="manual", value_origin="llm"))
    assert not rep.allowed
    assert "G03" in {o.gate_id for o in rep.outcomes if o.blocked}


def test_출처를_모르면_LLM으로_본다():
    """안전한 기본값 쪽으로 틀립니다."""
    assert GateContext(op=make_op()).value_origin == "llm"


# ─────────────────────────────────────────────────────────────
# 알림톡 — 자동 발송 경로가 없어야 한다
# ─────────────────────────────────────────────────────────────
@pytest.fixture
def gw(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    g = WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"),
                     dry_run=False, min_interval_sec=0)
    g.owned_students = {"test"}
    return g


def an_alimtalk(gw):
    return gw.build_alimtalk_op(
        report_seqs=["3479920"], all_report_seqs=["3479920"],
        report_date="2026-08-25", subjects=["홍길동"])


def test_알림톡은_send해도_서버로_안_나간다(gw):
    op = an_alimtalk(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")          # 승인해도 소용없어야 합니다
    res = gw.send(op, owner_login="test")

    assert not res.sent
    assert gw.lms.calls == [], "알림톡이 서버로 나갔습니다"
    assert res.handoff_url.startswith("https://dc.gang-a.kr/alimtalk/")


def test_알림톡_게이트는_항상_차단한다(gw):
    op = an_alimtalk(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")
    rep = gw.evaluate(op, owner_login="test")
    assert rep.needs_handoff
    assert not rep.allowed
    assert "G17" in {o.gate_id for o in rep.outcomes if o.blocked}


def test_핸드오프도_저널에_남는다(gw, tmp_path):
    op = an_alimtalk(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")
    gw.send(op, owner_login="test")
    rows = read_journal(path=tmp_path / "j.jsonl")
    assert rows and rows[-1]["result"] == "HANDOFF"


def test_핸드오프는_발송화면과_대상을_알려준다(gw):
    ho = gw.handoff(an_alimtalk(gw))
    assert "send_studyreport_alimtalk.jsp" in ho.url
    assert "3479920" in ho.url
    assert ho.subjects == ["홍길동"]
    assert "회수" in ho.why
    assert "직접" in ho.render()


def test_되돌릴수있는것을_핸드오프로_부르면_거부(gw):
    op = gw.build_day_record_op(
        field_name="progress", value="진도", subject="홍길동",
        stu_pri_no="1235920", record_seq="1", cm_seq="82128")
    with pytest.raises(ValueError, match="핸드오프 대상이 아닙니다"):
        gw.handoff(op)


def test_알림톡_URL_형식():
    """report_date 는 **하이픈 있는** 형식입니다 (수업일지 std_ymd 와 반대)."""
    url = alimtalk_url(target_report_seqs=["1", "2"], all_report_seqs=["1", "2", "3"],
                       report_date="2026-08-25")
    assert "target_report_seq_list=1,2" in url
    assert "all_report_seq_list=1,2,3" in url
    assert "report_date=2026-08-25" in url


def test_대상이_없으면_URL을_안_만든다():
    with pytest.raises(ValueError):
        alimtalk_url(target_report_seqs=[], all_report_seqs=["1"],
                     report_date="2026-08-25")


# ─────────────────────────────────────────────────────────────
# 전송 후 검증은 등급과 무관
# ─────────────────────────────────────────────────────────────
def test_역검증은_등급으로_끌_수_없다():
    """되돌릴 수 있느냐와 무관한 문제입니다.

    이 사이트는 저장에 실패해도 HTTP 200 을 줍니다. 역검증이 없으면
    **안 들어갔는데 들어간 줄 알고** 넘어갑니다. 그게 빠뜨리는 경로입니다.
    """
    from ganga.governance import POST_SEND_GATE_IDS

    assert {g for g, _ in POST_SEND_GATE_IDS} == {"G15", "G16"}


def test_보고서에_등급이_표시된다():
    rep = evaluate(ctx())
    assert "가벼움" in rep.render()
    assert rep.to_dict()["tier"] == "가벼움"
