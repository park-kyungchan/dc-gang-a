# -*- coding: utf-8 -*-
"""
대기열 → 서버 다리 테스트.

이 다리가 지켜야 하는 것은 **"승인한 것만, 승인한 값 그대로"** 입니다.
낮에 폰으로 승인해 두고 밤에 PC 로 보내는 흐름이라, 그 사이에 값이 바뀌거나
승인이 낡았는데도 나가면 선생님이 모르는 내용이 학부모에게 갑니다.

여기서 잡는 사고 4가지
    1. 승인 안 한 항목이 나감
    2. 승인 후 값을 고쳤는데 **옛 승인**으로 나감
    3. 그날 수업 행이 없는데 조용히 사라짐 (누락)
    4. `--commit` 없이 서버가 건드려짐
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga import queue as Q  # noqa: E402
from ganga.governance import Tier  # noqa: E402
from ganga.pipeline.flush import flush, value_origin_of  # noqa: E402

from test_gateway import FakeLms  # noqa: E402

DATE = "2026-08-25"


#: 서버 필드명 → 리더가 노출하는 속성명
_FIELD_ATTR = {"prg_txt": "progress_text", "hw_txt": "homework_text",
               "memo_txt": "memo_text", "attn_yn": "attendance"}


class FakeRow:
    def __init__(self, stu="1235920", name="홍길동"):
        self.stu_pri_no = stu
        self.student_name = name
        self.record_seq = "1"
        self.cm_seq = "82128"
        self.course_seq = "8"
        self.progress_text = ""
        self.homework_text = ""
        self.memo_text = ""
        self.attendance = "Y"
        self.daily_test = None
        self.homework_rate = None


class FakePage:
    def __init__(self, rows):
        self.records = rows


@pytest.fixture
def env(tmp_path, monkeypatch):
    """큐 + 가짜 세션.

    **조회가 쓰기를 반영합니다.** 이게 없으면 역검증(G16)이 항상 실패해서
    "다리가 잘 이어졌는가" 를 볼 수가 없습니다. 실제 서버는 쓴 값을 다시
    돌려주므로, 가짜도 그렇게 만드는 것이 맞습니다.

    ⚠️ 다만 이 가짜는 **성공한 쓰기만** 반영합니다. 실패 응답을 흉내 낼
    때는 반영하지 않아야 역검증 실패를 제대로 검사할 수 있습니다.
    """
    monkeypatch.setattr("ganga.governance.JOURNAL_PATH", tmp_path / "j.jsonl")
    conn = Q.connect(tmp_path / "q.db")
    rows = [FakeRow()]

    def _read(lms, date, grp_seq):
        for _method, _url, params in getattr(lms, "calls", []):
            if "\x01" not in getattr(lms, "_body", ""):
                continue            # 서버가 실패를 알린 쓰기는 반영하지 않습니다
            stu = str(params.get("stu_pri_no", ""))
            row = next((r for r in rows if r.stu_pri_no == stu), None)
            if row is None:
                continue
            for fname, attr in _FIELD_ATTR.items():
                if fname in params:
                    setattr(row, attr, params[fname])
        return FakePage(rows)

    # **원본 모듈을 갈아끼웁니다.** `flush` 와 게이트웨이의 역검증이 각자
    # import 하므로, 한쪽만 갈면 역검증은 진짜 리더를 불러 항상 실패합니다.
    monkeypatch.setattr("ganga.lms.reader.read_day_record", _read)
    monkeypatch.setattr("ganga.pipeline.flush.read_day_record", _read)
    lms = FakeLms("<html><body>\x01</body></html>")
    yield conn, lms, rows
    conn.close()


def _enqueue(conn, *, value="이등변삼각형의 성질", field="progress",
             note="수기", approve=True):
    it = Q.enqueue(conn, the_date=DATE, routine="day_record", field_name=field,
                   subject_key="1235920", subject_name="홍길동",
                   value=value, note=note)
    if approve:
        Q.review(conn, it.id, actor="박경찬")
        Q.approve(conn, it.id, by="박경찬")
    return Q.get(conn, it.id)


def _flush(conn, lms, **kw):
    kw.setdefault("the_date", DATE)
    kw.setdefault("grp_seq", "1")
    kw.setdefault("actor", "박경찬")
    return flush(conn, lms, **kw)


# ─────────────────────────────────────────────────────────────
# 1. 승인한 것만 나간다
# ─────────────────────────────────────────────────────────────
def test_승인_안_한_항목은_대상이_아니다(env):
    conn, lms, _ = env
    _enqueue(conn, approve=False)
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))

    assert rep.outcomes == []
    assert len(rep.not_ready) == 1
    assert lms.calls == [], "승인 안 한 항목이 서버로 나갔습니다"


def test_승인_후_값을_고치면_승인이_풀린다(env):
    """큐의 핵심 성질. 값이 바뀌면 옛 승인은 무효입니다."""
    conn, lms, _ = env
    it = _enqueue(conn, value="원래 진도")
    assert Q.get(conn, it.id).approval_valid

    Q.enqueue(conn, the_date=DATE, routine="day_record", field_name="progress",
              subject_key="1235920", subject_name="홍길동",
              value="고친 진도", note="수기")           # 같은 키 → 갱신

    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    assert rep.outcomes == []
    assert lms.calls == [], "값이 바뀐 항목이 옛 승인으로 나갔습니다"
    assert "값이 바뀌" in rep.to_dict()["not_ready"][0]["why"], \
        rep.to_dict()["not_ready"][0]


def test_승인한_값_그대로_나간다(env):
    conn, lms, _ = env
    _enqueue(conn, value="이등변삼각형의 성질 (p.17~24)")
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))

    assert len(rep.sent) == 1
    method, url, params = lms.calls[0]
    assert params["prg_txt"] == "이등변삼각형의 성질 (p.17~24)"


def test_큐_승인이_G14를_만족시킨다(env):
    """**이 다리의 존재 이유.**

    G13/G14 는 보통 등급(2건 이상)에서만 돕니다. 1건이면 가벼움이라
    애초에 승인을 안 묻습니다. 그러니 다리가 진짜 필요한 곳은 일괄이고,
    여기서 큐 승인이 게이트웨이 승인을 대신하는지 봅니다.
    """
    conn, lms, rows = env
    rows.append(FakeRow(stu="999", name="김철수"))
    _enqueue(conn)
    it2 = Q.enqueue(conn, the_date=DATE, routine="day_record",
                    field_name="progress", subject_key="999",
                    subject_name="김철수", value="다른 진도", note="수기")
    Q.review(conn, it2.id, actor="박경찬")
    Q.approve(conn, it2.id, by="박경찬")

    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))

    assert len(rep.sent) == 2, [o.detail for o in rep.outcomes]
    for out in rep.outcomes:
        assert out.tier is Tier.BULK
        g13 = next(g for g in out.gates if g["id"] == "G13")
        g14 = next(g for g in out.gates if g["id"] == "G14")
        assert g13["verdict"] == "통과", "미리보기가 통과되지 않았습니다"
        assert g14["verdict"] == "통과"
        assert "박경찬" in g14["detail"], "큐의 승인자가 G14 에 안 실렸습니다"


def test_한건이면_가벼움이라_승인을_묻지_않는다(env):
    conn, lms, _ = env
    _enqueue(conn)
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    out = rep.outcomes[0]
    assert out.ok and out.tier is Tier.LIGHT
    assert not any(g["id"] in ("G13", "G14") for g in out.gates)


# ─────────────────────────────────────────────────────────────
# 2. 조용히 사라지지 않는다
# ─────────────────────────────────────────────────────────────
def test_그날_수업행이_없으면_실패로_남는다(env):
    """건너뛰고 아무 말 안 하면 그게 '빠뜨리는' 것입니다."""
    conn, lms, rows = env
    rows.clear()
    _enqueue(conn)
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))

    assert len(rep.outcomes) == 1
    assert not rep.outcomes[0].ok
    assert "행이 없습니다" in rep.outcomes[0].detail
    assert lms.calls == []


def test_지원하지_않는_루틴도_보고된다(env):
    conn, lms, _ = env
    it = Q.enqueue(conn, the_date=DATE, routine="cism", field_name="i_1",
                   subject_key="", subject_name="주간보고", value="x", note="수기")
    Q.review(conn, it.id, actor="박경찬")
    Q.approve(conn, it.id, by="박경찬")

    rep = _flush(conn, lms, dry_run=False, unlock=("cism.i_1",))
    assert len(rep.outcomes) == 1 and not rep.outcomes[0].ok
    assert "지원하지 않는" in rep.outcomes[0].detail


def test_대상이_없으면_경고를_남긴다(env):
    conn, lms, _ = env
    rep = _flush(conn, lms, dry_run=False)
    assert rep.warnings and "승인이 유효한 항목이 없습니다" in rep.warnings[0]


# ─────────────────────────────────────────────────────────────
# 3. dry-run 은 서버를 건드리지 않는다
# ─────────────────────────────────────────────────────────────
def test_dry_run은_전송하지_않는다(env):
    conn, lms, _ = env
    _enqueue(conn)
    rep = _flush(conn, lms, dry_run=True, unlock=("day_record.progress",))

    assert lms.calls == [], "dry-run 인데 서버로 나갔습니다"
    assert not rep.outcomes[0].sent
    assert Q.get(conn, 1).state is Q.Status.APPROVED, "dry-run 이 큐 상태를 바꿨습니다"


def test_잠금을_안_풀면_G04가_막는다(env):
    conn, lms, _ = env
    _enqueue(conn)
    rep = _flush(conn, lms, dry_run=False, unlock=())

    assert lms.calls == []
    assert rep.outcomes[0].blocked_at == "G04"


def test_다른_항목을_풀면_이_항목은_안_나간다(env):
    conn, lms, _ = env
    _enqueue(conn, field="progress")
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.memo",))

    assert lms.calls == []
    assert rep.outcomes[0].blocked_at == "G04"


# ─────────────────────────────────────────────────────────────
# 4. 전송 결과가 큐에 반영된다
# ─────────────────────────────────────────────────────────────
def test_성공하면_큐가_전송완료로_바뀐다(env):
    conn, lms, _ = env
    it = _enqueue(conn)
    _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    assert Q.get(conn, it.id).state is Q.Status.SENT


def test_실패하면_큐가_전송실패로_바뀐다(env, monkeypatch):
    conn, _, _ = env
    lms = FakeLms("<html></html>")          # 갱신된 행 없음 = 실패
    _enqueue(conn)
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))

    assert not rep.outcomes[0].ok
    assert Q.get(conn, 1).state is Q.Status.FAILED


def test_전송완료된_항목은_다시_나가지_않는다(env):
    """`sent` 는 종착점입니다. 두 번 보내면 중복입니다."""
    conn, lms, _ = env
    _enqueue(conn)
    _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    before = len(lms.calls)

    rep2 = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    assert len(lms.calls) == before, "이미 보낸 것을 또 보냈습니다"
    assert rep2.outcomes == []


# ─────────────────────────────────────────────────────────────
# 5. 등급과 값 출처
# ─────────────────────────────────────────────────────────────
def test_여러건이면_보통_등급이_된다(env):
    conn, lms, rows = env
    rows.append(FakeRow(stu="999", name="김철수"))
    _enqueue(conn)
    it2 = Q.enqueue(conn, the_date=DATE, routine="day_record", field_name="progress",
                    subject_key="999", subject_name="김철수",
                    value="다른 진도", note="수기")
    Q.review(conn, it2.id, actor="박경찬")
    Q.approve(conn, it2.id, by="박경찬")

    rep = _flush(conn, lms, dry_run=True, unlock=("day_record.progress",))
    assert len(rep.outcomes) == 2
    assert all(o.tier is Tier.BULK for o in rep.outcomes)


def test_수기_표시가_있으면_사람이_쓴_값으로_본다(env):
    conn, lms, _ = env
    _enqueue(conn, note="수기 입력")
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    assert rep.outcomes[0].ok, "선생님이 직접 쓴 값이 원장에 막혔습니다"


def test_출처_표시가_없으면_LLM으로_보고_원장을_적용한다(env):
    """안전한 기본값 쪽으로 틀립니다. 원장이 manual 이면 막혀야 합니다."""
    conn, lms, _ = env
    _enqueue(conn, note="agent")
    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))

    assert lms.calls == []
    assert rep.outcomes[0].blocked_at == "G03"


def test_출처_판정_규칙():
    class _It:
        note = "수기"
    assert value_origin_of(_It()) == "human"

    class _It2:
        note = ""
    assert value_origin_of(_It2()) == "llm"


# ─────────────────────────────────────────────────────────────
# 6. 상한
# ─────────────────────────────────────────────────────────────
def test_상한을_주면_그만큼만_보내고_알린다(env):
    conn, lms, rows = env
    rows.append(FakeRow(stu="999", name="김철수"))
    _enqueue(conn)
    it2 = Q.enqueue(conn, the_date=DATE, routine="day_record", field_name="progress",
                    subject_key="999", subject_name="김철수", value="v2", note="수기")
    Q.review(conn, it2.id, actor="박경찬")
    Q.approve(conn, it2.id, by="박경찬")

    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",),
                 max_items=1)
    assert len(rep.outcomes) == 1
    assert any("--max" in w for w in rep.warnings)


def test_보고서에_승인대기_항목도_드러난다(env):
    """보낸 것만 보여주면 '안 보낸 것' 을 못 봅니다."""
    conn, lms, _ = env
    _enqueue(conn, approve=False)
    rep = _flush(conn, lms, dry_run=True)
    assert "승인 대기" in rep.render() or rep.not_ready


def test_일괄이어도_속도제한에_걸려_실패하지_않는다(env):
    """G11 은 서버를 보호하려는 것이지 일괄 전송을 깨려는 게 아닙니다.

    기다리지 않으면 반 전체 전송에서 **첫 명만 나가고 나머지가 전부**
    "직전 전송 후 0.0초" 로 실패합니다. 실제로 그렇게 됐었습니다.
    """
    conn, lms, rows = env
    for i in range(3):
        rows.append(FakeRow(stu=f"90{i}", name=f"학생{i}"))
        it = Q.enqueue(conn, the_date=DATE, routine="day_record",
                       field_name="progress", subject_key=f"90{i}",
                       subject_name=f"학생{i}", value=f"진도{i}", note="수기")
        Q.review(conn, it.id, actor="박경찬")
        Q.approve(conn, it.id, by="박경찬")

    rep = _flush(conn, lms, dry_run=False, unlock=("day_record.progress",))
    assert len(rep.sent) == 3, [o.detail for o in rep.outcomes]
    assert not any(o.blocked_at == "G11" for o in rep.outcomes)
