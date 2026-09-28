# -*- coding: utf-8 -*-
"""
게이트웨이 테스트 — 승인 없이는 아무것도 나가지 않는가.

네트워크 없이 가짜 세션으로 검증합니다. 실제 HTTP 가 나가면 즉시 실패합니다.

**`batch_size=2` 를 넘기는 이유**: 등급 재편(2026-08-20) 이후 1건짜리 전송은
가벼움 등급이라 8단만 돕니다. 이 파일은 **전체 체인**(보통 등급 14단)을
검사하므로 일괄로 둡니다. 가벼움 등급의 동작은 `test_tiers.py` 에 있습니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.governance import read_journal  # noqa: E402
from ganga.lms.gateway import NotApproved, WriteGateway  # noqa: E402
from ganga.policy import Ledger  # noqa: E402


class FakeTeacher:
    pri_no = "1292923"
    name = "박경찬"
    fran_no = "1680"


class FakeResponse:
    def __init__(self, body="OK"):
        self.html_content = body


class FakeLms:
    """서버에 실제로 나가지 않는 가짜 세션. 호출을 세기만 합니다."""

    def __init__(self, body="OK"):
        self.teacher = FakeTeacher()
        self.calls: list[tuple[str, str, dict]] = []
        self._body = body

    def get(self, url, params=None, check=True, **kw):
        self.calls.append(("GET", url, params or {}))
        return FakeResponse(self._body)

    def post(self, url, data=None, check=True, **kw):
        self.calls.append(("POST", url, data or {}))
        return FakeResponse(self._body)


@pytest.fixture
def gw(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    led = Ledger(path=tmp_path / "policy.json")
    g = WriteGateway(FakeLms(), ledger=led, dry_run=False, min_interval_sec=0)
    g.owned_students = {"gildong01"}
    return g


def an_op(gw):
    return gw.build_day_record_op(
        field_name="progress", value="도형의 성질 진행", subject="홍길동",
        stu_pri_no="98765", record_seq="54321", cm_seq="11223", course_seq="12345")


def promote_to_auto(gw, key="progress"):
    gw.ledger.promote("day_record", key)
    gw.ledger.promote("day_record", key)


# ─────────────────────────────────────────────────────────────
# 승인 없이는 나가지 않는다 — 이 파일의 핵심
# ─────────────────────────────────────────────────────────────
def test_승인없이_send하면_전송되지_않는다(gw):
    """미리보기(G13)가 승인(G14)보다 먼저 막습니다 — 순서가 맞습니다.
    사람이 무엇이 나가는지 보지도 않았는데 승인 여부를 묻는 것이 이상하니까요."""
    promote_to_auto(gw)
    op = an_op(gw)
    res = gw.send(op, owner_login="gildong01", batch_size=2)

    assert not res.sent
    assert gw.lms.calls == [], "승인 없이 HTTP 가 나갔습니다"
    assert "G13" in res.detail


def test_미리보기만_하고_승인을_안하면_G14가_막는다(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op)                      # G13 통과
    res = gw.send(op, owner_login="gildong01", batch_size=2)

    assert not res.sent
    assert gw.lms.calls == []
    assert "G14" in res.detail and "승인" in res.detail


def test_미리보기_없이는_승인조차_못한다(gw):
    op = an_op(gw)
    with pytest.raises(NotApproved):
        gw.approve(op, by="박경찬")


def test_정상_절차를_다_밟으면_전송된다(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")
    res = gw.send(op, owner_login="gildong01", batch_size=2)

    assert res.sent and res.ok
    assert len(gw.lms.calls) == 1
    method, url, params = gw.lms.calls[0]
    assert method == "GET"                    # 진도는 GET (실측)
    assert "DayRecordServlet" in url
    assert params["reqCmd"] == "udtPrg"
    assert params["prg_txt"] == "도형의 성질 진행"


def test_원장이_auto가_아니면_전송되지_않는다(gw):
    gw.ledger.promote("day_record", "progress")   # suggest 까지만
    op = an_op(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")
    res = gw.send(op, owner_login="gildong01", batch_size=2)

    assert not res.sent
    assert gw.lms.calls == []


def test_dry_run이면_전송되지_않는다(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    g = WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"),
                     dry_run=True, min_interval_sec=0)
    g.owned_students = {"gildong01"}
    promote_to_auto(g)
    op = an_op(g)
    g.preview(op)
    g.approve(op, by="박경찬")
    res = g.send(op, owner_login="gildong01", batch_size=2)

    assert not res.sent
    assert g.lms.calls == []


def test_남의_학생에게는_전송되지_않는다(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")
    res = gw.send(op, owner_login="somebody_else")

    assert not res.sent
    assert gw.lms.calls == []


# ─────────────────────────────────────────────────────────────
# 승인은 1회용
# ─────────────────────────────────────────────────────────────
def test_한번_쓴_승인은_소멸한다(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op)
    gw.approve(op, by="박경찬")
    gw.send(op, owner_login="gildong01", batch_size=2)

    res2 = gw.send(op, owner_login="gildong01", batch_size=2)
    assert not res2.sent, "승인이 재사용됐습니다"
    assert len(gw.lms.calls) == 1


def test_같은_값_재전송은_중복게이트가_막는다(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op); gw.approve(op, by="박경찬")
    gw.send(op, owner_login="gildong01", batch_size=2)

    op2 = an_op(gw)
    gw.preview(op2); gw.approve(op2, by="박경찬")
    res = gw.send(op2, owner_login="gildong01", batch_size=2)
    assert not res.sent
    assert "G10" in res.detail or "이미" in res.detail


def test_승인_철회(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op); gw.approve(op, by="박경찬")
    gw.revoke(op)
    assert not gw.send(op, owner_login="gildong01", batch_size=2).sent


def test_빈_승인자는_거부(gw):
    op = an_op(gw)
    gw.preview(op)
    with pytest.raises(ValueError):
        gw.approve(op, by="   ")


# ─────────────────────────────────────────────────────────────
# 요청 조립이 실측 스펙과 맞는가
# ─────────────────────────────────────────────────────────────
def test_진도는_GET_DayRecordServlet(gw):
    op = an_op(gw)
    assert op.method == "GET"
    assert op.servlet == "controller.cct.tutor.DayRecordServlet"
    assert op.params["reqCmd"] == "udtPrg"


def test_일일테스트는_POST_CourseCommonServlet(gw):
    op = gw.build_day_record_op(field_name="daily_test", value=9, subject="홍길동",
                                stu_pri_no="1", record_seq="2", cm_seq="3")
    assert op.method == "POST"
    assert op.servlet == "controller.cct.common.CourseCommonServlet"
    assert op.params["daily_test_no"] == 9        # radio 아님 (실측)
    assert op.params["tutor_pri_no"] == "1292923"


def test_모르는_필드는_예외가_아니라_G07이_막는다(gw):
    """여기서 예외를 던지면 게이트 보고서에 안 남아 감사가 끊깁니다."""
    op = gw.build_day_record_op(field_name="made_up", value="x", subject="홍길동",
                                stu_pri_no="1", record_seq="2", cm_seq="3")
    rep = gw.evaluate(op, owner_login="gildong01", batch_size=2)
    assert not rep.allowed
    assert any(o.gate_id == "G07" and o.blocked for o in rep.outcomes)


def test_CISM_요청_조립(gw):
    op = gw.build_cism_op(field_id="i_1", value="칭찬 대상", the_date="2026-08-20")
    assert op.routine == "cism"
    assert op.params["reqCmd"] == "SetCismContentData"
    assert op.params["field_name"] == "i_1"


# ─────────────────────────────────────────────────────────────
# 역검증 (G16)
# ─────────────────────────────────────────────────────────────
def test_역검증_실패면_전체를_실패로_본다(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op); gw.approve(op, by="박경찬")
    res = gw.send(op, owner_login="gildong01", batch_size=2, verify=lambda o: False)

    assert res.sent
    assert res.verified is False
    assert not res.ok, "응답은 OK 였지만 역검증이 실패했는데 성공으로 봤습니다"


def test_역검증_통과(gw):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op); gw.approve(op, by="박경찬")
    res = gw.send(op, owner_login="gildong01", batch_size=2, verify=lambda o: True)
    assert res.ok and res.verified is True
    assert [g[0] for g in res.post_gates] == ["G15", "G16"]


def test_서버가_실패응답이면_실패(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    g = WriteGateway(FakeLms(body="저장되지 않았습니다"),
                     ledger=Ledger(path=tmp_path / "p.json"),
                     dry_run=False, min_interval_sec=0)
    g.owned_students = {"gildong01"}
    promote_to_auto(g)
    op = an_op(g)
    g.preview(op); g.approve(op, by="박경찬")
    res = g.send(op, owner_login="gildong01", batch_size=2)
    assert res.sent and not res.ok


# ─────────────────────────────────────────────────────────────
# 저널
# ─────────────────────────────────────────────────────────────
def test_차단도_저널에_남는다(gw, tmp_path):
    promote_to_auto(gw)
    gw.send(an_op(gw), owner_login="gildong01", batch_size=2)     # 승인 없음 → 차단
    rows = read_journal(path=tmp_path / "j.jsonl")
    assert rows and rows[-1]["result"] == "BLOCKED"


def test_전송도_저널에_남고_승인자가_기록된다(gw, tmp_path):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op); gw.approve(op, by="박경찬")
    gw.send(op, owner_login="gildong01", batch_size=2)

    rows = read_journal(path=tmp_path / "j.jsonl")
    assert rows[-1]["result"] == "SENT"
    assert rows[-1]["approved_by"] == "박경찬"


def test_저널에_학생실명이_없다(gw, tmp_path):
    promote_to_auto(gw)
    op = an_op(gw)
    gw.preview(op); gw.approve(op, by="박경찬")
    gw.send(op, owner_login="gildong01", batch_size=2)
    raw = (tmp_path / "j.jsonl").read_text(encoding="utf-8")
    assert "홍길동" not in raw
    assert "도형의 성질 진행" not in raw


# ─────────────────────────────────────────────────────────────
# 상한
# ─────────────────────────────────────────────────────────────
def test_일괄상한을_넘으면_멈춘다(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    g = WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"),
                     dry_run=False, max_writes=2, min_interval_sec=0)
    g.owned_students = {"gildong01"}
    promote_to_auto(g)

    for i in range(4):
        op = g.build_day_record_op(field_name="progress", value=f"진도{i}",
                                   subject="홍길동", stu_pri_no="98765",
                                   record_seq="54321", cm_seq="11223")
        g.preview(op); g.approve(op, by="박경찬")
        g.send(op, owner_login="gildong01", batch_size=2)

    assert len(g.lms.calls) == 2, f"상한을 넘겼습니다: {len(g.lms.calls)}건"
