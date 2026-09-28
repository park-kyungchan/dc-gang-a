# -*- coding: utf-8 -*-
"""
전송 판정 회귀 테스트 — 첫 실전송에서 드러난 결함.

무슨 일이 있었나 (2026-08-25)
    `test` 학생 8/25 진도란에 실제로 값을 보냈습니다. 서버에 **정상적으로
    들어갔고** 역검증(G16)도 통과했는데, 저널에는 `FAILED` 로 남았습니다.

    원인은 서버 응답이 `<html><body></body></html>` 였다는 것입니다.
    `judge_response` 가 `bool` 만 돌려주면서 **"모르겠다" 를 "실패" 로 접었고**,
    그 실패가 역검증 통과를 덮어썼습니다.

    "실패를 성공으로 읽지 않는다" 는 맞습니다. 하지만 **모른다는 것을
    실패라고 우기는 것**은 다른 문제입니다. 이러면 성공한 전송을 다시
    보내게 되고, 저널이 사실과 달라져 감사 기록으로 못 씁니다.

이 파일이 지키는 것
    1. 판정 불가(None)와 확실한 실패(False)를 구분한다
    2. 판정 불가일 때는 역검증이 결정한다
    3. **확실한 실패는 역검증이 통과해도 뒤집지 못한다**
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.lms.gateway import WriteGateway  # noqa: E402
from ganga.lms.writer import judge_response  # noqa: E402
from ganga.policy import Ledger  # noqa: E402

from test_gateway import FakeLms  # noqa: E402

#: 실측 응답 4종 (2026-08-25, 성공 1건 + 실패 3건 대조)
REAL_SUCCESS = "<html><body>\x01</body></html>"          # 정상
REAL_NO_ROW = "<html></html>"                            # 없는 학생/회차/cm_seq
REAL_ERROR = ('<html><head></head><body onload="javascript:document.errform.submit()">'
              '\n<form name="errform" action="/error/error.jsp" method="post">\n</form>')
#: body 는 있는데 안이 빈 경우 — 실측되진 않았지만 판정 불가로 남겨야 합니다
REAL_EMPTY = "<html>\n<body></body>\n</html>"


# ─────────────────────────────────────────────────────────────
# 서버의 쓰기 응답 규약 — 실측 대조
# ─────────────────────────────────────────────────────────────
def test_성공표식은_제어문자_x01():
    """`<body>` 안에 \\x01 이 오면 성공입니다. HTTP 는 넷 다 200 이라 소용없습니다."""
    verdict, detail = judge_response(REAL_SUCCESS)
    assert verdict is True
    assert "x01" in detail or "성공" in detail


def test_body가_없으면_갱신된_행이_없는_것():
    """없는 학생·없는 회차·없는 cm_seq 셋 다 이 응답이었습니다."""
    verdict, detail = judge_response(REAL_NO_ROW)
    assert verdict is False, "0행 갱신을 성공으로 읽으면 안 됩니다"
    assert "행" in detail


def test_error_jsp_폼은_실패():
    """키를 전부 비우면 서버 오류 페이지로 넘기는 폼이 옵니다."""
    assert judge_response(REAL_ERROR)[0] is False


def test_네_응답이_서로_다르게_판정된다():
    """규약이 실제로 구분력이 있는지 — 넷이 같은 값으로 접히면 의미가 없습니다."""
    got = [judge_response(b)[0]
           for b in (REAL_SUCCESS, REAL_NO_ROW, REAL_ERROR, REAL_EMPTY)]
    assert got == [True, False, False, None], got


# ─────────────────────────────────────────────────────────────
# 3값 판정
# ─────────────────────────────────────────────────────────────
def test_빈_본문은_판정불가이지_실패가_아니다():
    """`is None` 으로 확인합니다. `assert not ok` 는 False 와 구분하지 못합니다."""
    verdict, detail = judge_response(REAL_EMPTY)
    assert verdict is None, f"판정불가여야 하는데 {verdict!r} 입니다"
    assert "역검증" in detail


def test_공백_섞인_빈_껍데기도_알아본다():
    """줄바꿈·들여쓰기가 어떻게 섞이든 내용이 없으면 빈 껍데기입니다."""
    from ganga.lms.writer import is_empty_shell

    for body in ("<html><body></body></html>",
                 "<html>\n<body></body>\n</html>",
                 "<html>\r\n  <body>\t</body>\r\n</html>",
                 "<html><body/></html>"):
        assert is_empty_shell(body), body
        assert judge_response(body)[0] is None, body


def test_내용이_있으면_껍데기가_아니다():
    from ganga.lms.writer import is_empty_shell

    assert not is_empty_shell("<html><body>저장되었습니다</body></html>")


def test_완전히_빈_응답도_판정불가():
    assert judge_response("") is not None
    assert judge_response("")[0] is None


def test_확실한_실패는_False():
    """이건 '모르겠다' 가 아니라 '아니다' 입니다."""
    for body in ("저장되지 않았습니다", "오류가 발생했습니다",
                 "<script>alert('실패')</script>"):
        assert judge_response(body)[0] is False, body


def test_세션만료는_확실한_실패():
    body = '<html><input type="password" name="pw"></html>'
    assert judge_response(body)[0] is False


def test_확실한_성공은_True():
    for body in ("OK", "success", "저장되었습니다"):
        assert judge_response(body)[0] is True, body


def test_모르는_응답은_성공으로_새지_않는다():
    """판정불가는 성공이 아닙니다. 역검증 없이는 실패로 취급돼야 합니다."""
    assert judge_response("1724054400000")[0] is not True
    assert judge_response("1001 Unauthorized")[0] is not True


# ─────────────────────────────────────────────────────────────
# G15 + G16 합성
# ─────────────────────────────────────────────────────────────
@pytest.fixture
def gw(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    return tmp_path


def _send(tmp_path, body, verify, *, field="progress"):
    lms = FakeLms(body)
    g = WriteGateway(lms, ledger=Ledger(path=tmp_path / "p.json"),
                     min_interval_sec=0)
    g.owned_students = {"홍길동"}
    g.unlock(f"day_record.{field}", by="박경찬")
    op = g.build_day_record_op(
        field_name=field, value="도형의 성질", subject="홍길동",
        stu_pri_no="1235920", record_seq="1", cm_seq="82128", course_seq="8")
    g.preview(op)
    g.approve(op, by="박경찬")
    return g.send(op, owner_login="홍길동", value_origin="human", verify=verify)


def test_빈본문이라도_역검증이_통과하면_성공(gw):
    """첫 실전송의 실제 상황. 값은 들어갔는데 FAILED 로 남았던 그 경우입니다."""
    res = _send(gw, REAL_EMPTY, lambda op: True)
    assert res.sent
    assert res.judged is None
    assert res.verified is True
    assert res.ok, "값이 서버에 들어갔는데 실패로 기록됩니다"


def test_빈본문에_역검증_실패면_실패(gw):
    res = _send(gw, REAL_EMPTY, lambda op: False)
    assert not res.ok


def test_빈본문에_역검증을_안하면_실패(gw):
    """모른 채로 성공이라고 하지 않습니다."""
    res = _send(gw, REAL_EMPTY, None)
    assert res.judged is None and res.verified is None
    assert not res.ok


def test_확실한_실패는_역검증이_통과해도_실패(gw):
    """역검증이 통과했다고 뒤집으면 안 됩니다.

    서버가 '저장되지 않았습니다' 라고 했는데 재조회에서 같은 값이 보인다면,
    **내가 쓴 게 아니라 원래 그 값이었을** 가능성이 큽니다.
    """
    res = _send(gw, "저장되지 않았습니다", lambda op: True)
    assert res.judged is False
    assert res.verified is True
    assert not res.ok, "명시적 실패를 역검증으로 덮어썼습니다"


def test_확실한_성공에_역검증_실패면_실패(gw):
    res = _send(gw, "OK", lambda op: False)
    assert res.judged is True and res.verified is False
    assert not res.ok


def test_확실한_성공에_역검증_안했으면_성공(gw):
    res = _send(gw, "OK", None)
    assert res.ok


# ─────────────────────────────────────────────────────────────
# 저널이 사실과 일치해야 감사 기록이다
# ─────────────────────────────────────────────────────────────
def test_성공한_전송이_저널에_SENT로_남는다(gw):
    from ganga.governance import read_journal

    _send(gw, REAL_EMPTY, lambda op: True)
    rows = read_journal(path=gw / "j.jsonl")
    assert rows[-1]["result"] == "SENT"
    assert rows[-1]["verified"] is True


def test_역검증_안한_전송은_verified가_None(gw):
    """'역검증 통과' 와 '역검증 안 함' 을 저널에서 구분할 수 있어야 합니다."""
    from ganga.governance import read_journal

    _send(gw, "OK", None)
    assert read_journal(path=gw / "j.jsonl")[-1]["verified"] is None


# ─────────────────────────────────────────────────────────────
# 항목별 잠금
# ─────────────────────────────────────────────────────────────
def test_푼_항목만_나간다(tmp_path, monkeypatch):
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    lms = FakeLms("OK")
    g = WriteGateway(lms, ledger=Ledger(path=tmp_path / "p.json"),
                     min_interval_sec=0)
    g.owned_students = {"홍길동"}
    g.unlock("day_record.progress", by="박경찬")

    def op_for(field):
        return g.build_day_record_op(
            field_name=field, value="가나다라마바사아자차", subject="홍길동",
            stu_pri_no="1235920", record_seq="1", cm_seq="82128", course_seq="8")

    kw = dict(owner_login="홍길동", value_origin="human")
    assert g.send(op_for("progress"), **kw).sent, "푼 항목이 안 나갔습니다"
    assert not g.send(op_for("memo"), **kw).sent, "안 푼 항목이 나갔습니다"
    assert not g.send(op_for("homework"), **kw).sent


def test_잠금해제는_이름을_요구한다(tmp_path):
    g = WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"))
    with pytest.raises(ValueError):
        g.unlock("day_record.progress", by="")


def test_항목형식이_틀리면_거부(tmp_path):
    g = WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"))
    with pytest.raises(ValueError, match="routine.field"):
        g.unlock("progress", by="박경찬")


def test_다시_잠글_수_있다(tmp_path):
    g = WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"))
    g.unlock("day_record.progress", "day_record.memo", by="박경찬")
    assert len(g.unlocked) == 2
    g.lock("day_record.memo")
    assert g.unlocked == frozenset({"day_record.progress"})
    g.lock()
    assert g.unlocked == frozenset()


def test_해제는_디스크에_남지_않는다(tmp_path):
    """다음 실행에서는 다시 잠겨 있어야 합니다. 켜 둔 걸 잊는 게 위험합니다."""
    led = Ledger(path=tmp_path / "p.json")
    a = WriteGateway(FakeLms(), ledger=led)
    a.unlock("day_record.progress", by="박경찬")
    b = WriteGateway(FakeLms(), ledger=led)
    assert b.unlocked == frozenset()


# ─────────────────────────────────────────────────────────────
# G16 엔티티 정규화 — 실측 (2026-08-25)
# ─────────────────────────────────────────────────────────────
"""
서버가 `&` `<` `>` 를 엔티티로 바꿔서 돌려줍니다.

    보냄 'A & B'      → 읽음 'A &amp; B'
    보냄 'x < y > z'  → 읽음 'x &lt; y &gt; z'
    보냄 '"' "'"      → 그대로 (안 바꿈)
    보냄 '√2 π ± ≥'   → 그대로
    보냄 '𝑥 ⟂ ℝ ✔'    → 그대로 (EUC-KR 밖 문자도 무손실)
    보냄 'A    B\\t\\tC'→ 그대로 (연속 공백 보존)

이걸 안 풀면 `&` 하나 들어간 진도가 정상 저장됐는데 역검증 실패로 나옵니다.
반대로 **공백까지 정규화하면** 서버가 공백을 뭉갠 경우를 통과로 읽습니다.
"""


class _Row:
    def __init__(self, text):
        self.stu_pri_no = "1235920"
        self.progress_text = text


def _verifier(gw, server_returns):
    """서버가 `server_returns` 를 돌려준다고 가정한 역검증 함수."""
    import types

    page = types.SimpleNamespace(records=[_Row(server_returns)])
    import ganga.lms.reader as R

    orig = R.read_day_record
    R.read_day_record = lambda *a, **k: page
    try:
        return gw.day_record_verifier(date="2026-08-25", grp_seq="1")
    finally:
        R.read_day_record = orig


def _op(gw, value):
    return gw.build_day_record_op(
        field_name="progress", value=value, subject="홍길동",
        stu_pri_no="1235920", record_seq="1", cm_seq="82128", course_seq="8")


def _gw(tmp_path):
    return WriteGateway(FakeLms(), ledger=Ledger(path=tmp_path / "p.json"))


def test_엔티티로_돌아온_값을_통과시킨다(tmp_path):
    g = _gw(tmp_path)
    import types
    import ganga.lms.reader as R

    R_orig = R.read_day_record
    R.read_day_record = lambda *a, **k: types.SimpleNamespace(
        records=[_Row("A &amp; B")])
    try:
        v = g.day_record_verifier(date="2026-08-25", grp_seq="1")
        assert v(_op(g, "A & B")), "정상 저장인데 역검증이 실패로 봅니다"
    finally:
        R.read_day_record = R_orig


def test_부등호_엔티티도_통과(tmp_path):
    g = _gw(tmp_path)
    import types
    import ganga.lms.reader as R

    R_orig = R.read_day_record
    R.read_day_record = lambda *a, **k: types.SimpleNamespace(
        records=[_Row("x &lt; y &gt; z")])
    try:
        v = g.day_record_verifier(date="2026-08-25", grp_seq="1")
        assert v(_op(g, "x < y > z"))
    finally:
        R.read_day_record = R_orig


def test_진짜_다른_값은_여전히_막는다(tmp_path):
    """엔티티를 푼다고 아무 값이나 통과하면 역검증이 무의미해집니다."""
    g = _gw(tmp_path)
    import types
    import ganga.lms.reader as R

    R_orig = R.read_day_record
    R.read_day_record = lambda *a, **k: types.SimpleNamespace(
        records=[_Row("전혀 다른 진도")])
    try:
        v = g.day_record_verifier(date="2026-08-25", grp_seq="1")
        assert not v(_op(g, "이등변삼각형의 성질"))
    finally:
        R.read_day_record = R_orig


def test_공백은_정규화하지_않는다(tmp_path):
    """서버는 연속 공백을 보존합니다(실측). 접으면 뭉갠 경우를 놓칩니다."""
    g = _gw(tmp_path)
    import types
    import ganga.lms.reader as R

    R_orig = R.read_day_record
    R.read_day_record = lambda *a, **k: types.SimpleNamespace(
        records=[_Row("A B C")])          # 서버가 공백을 뭉갠 상황
    try:
        v = g.day_record_verifier(date="2026-08-25", grp_seq="1")
        assert not v(_op(g, "A    B    C")), "공백이 뭉개졌는데 통과했습니다"
    finally:
        R.read_day_record = R_orig
