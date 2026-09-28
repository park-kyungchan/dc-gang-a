# -*- coding: utf-8 -*-
"""
초안 대기열 테스트.

핵심: **승인은 값에 묶인다.** 승인해 둔 것과 실제로 보내는 것이 달라지면
승인의 의미가 없습니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import needs_git  # noqa: E402

from ganga.queue import (  # noqa: E402
    TRANSITIONS,
    Item,
    Status,
    TransitionError,
    approve,
    connect,
    discard,
    enqueue,
    get,
    history,
    list_items,
    mark_failed,
    mark_sent,
    ready_to_send,
    review,
    revoke,
    summary,
)

D = "2026-08-20"


@pytest.fixture
def q(tmp_path):
    conn = connect(tmp_path / "q.db")
    yield conn
    conn.close()


def add(conn, *, field_name="progress", value="도형의 성질 진행",
        key="gildong01", name="홍길동") -> Item:
    return enqueue(conn, the_date=D, routine="day_record", field_name=field_name,
                   subject_key=key, subject_name=name, value=value)


# ─────────────────────────────────────────────────────────────
# 영속성 — 이 파일의 존재 이유
# ─────────────────────────────────────────────────────────────
def test_프로세스가_바뀌어도_승인이_남는다(tmp_path):
    """낮에 폰으로 넣고 저녁에 PC 에서 보내는 흐름의 전제입니다."""
    p = tmp_path / "q.db"
    c1 = connect(p)
    it = add(c1)
    review(c1, it.id)
    approve(c1, it.id, by="박경찬")
    c1.close()

    c2 = connect(p)                      # 다른 연결 = 재시작 흉내
    got = get(c2, it.id)
    assert got.state is Status.APPROVED
    assert got.approved_by == "박경찬"
    assert got.approval_valid
    c2.close()


# ─────────────────────────────────────────────────────────────
# 승인은 값에 묶인다
# ─────────────────────────────────────────────────────────────
def test_승인후_값을_고치면_승인이_풀린다(q):
    it = add(q)
    review(q, it.id)
    approve(q, it.id, by="박경찬")

    again = enqueue(q, the_date=D, routine="day_record", field_name="progress",
                    subject_key="gildong01", subject_name="홍길동",
                    value="다른 진도로 수정")
    assert again.state is Status.DRAFT, "값을 고쳤는데 승인이 남아 있습니다"
    assert again.approved_by == ""
    assert not again.approval_valid


def test_같은_값을_다시_넣으면_승인이_유지된다(q):
    """오타 수정 없이 같은 값을 재저장하는 것으로 승인이 풀리면 번거롭습니다."""
    it = add(q, value="같은 값")
    review(q, it.id)
    approve(q, it.id, by="박경찬")
    again = add(q, value="같은 값")
    assert again.state is Status.APPROVED
    assert again.approval_valid


def test_전송대상은_유효한_승인만(q):
    a = add(q, field_name="progress", value="진도")
    b = add(q, field_name="homework", value="숙제")
    for it in (a, b):
        review(q, it.id)
        approve(q, it.id, by="박경찬")

    # b 의 값을 바꿔 승인을 무효화
    enqueue(q, the_date=D, routine="day_record", field_name="homework",
            subject_key="gildong01", subject_name="홍길동", value="바뀐 숙제")

    ready = ready_to_send(q, the_date=D)
    assert [r.field for r in ready] == ["progress"]


# ─────────────────────────────────────────────────────────────
# 상태 전이
# ─────────────────────────────────────────────────────────────
def test_검토없이_승인할_수_없다(q):
    it = add(q)
    with pytest.raises(TransitionError):
        approve(q, it.id, by="박경찬")


def test_전송은_종착점(q):
    it = add(q)
    review(q, it.id)
    approve(q, it.id, by="박경찬")
    mark_sent(q, it.id, result="OK")
    for fn in (review, discard):
        with pytest.raises(TransitionError):
            fn(q, it.id)


def test_전송된_항목은_덮어쓸_수_없다(q):
    it = add(q)
    review(q, it.id)
    approve(q, it.id, by="박경찬")
    mark_sent(q, it.id)
    with pytest.raises(TransitionError, match="이미 전송"):
        add(q, value="다시 넣기")


def test_실패하면_다시_검토로_돌아갈_수_있다(q):
    it = add(q)
    review(q, it.id)
    approve(q, it.id, by="박경찬")
    mark_failed(q, it.id, result="G10 중복")
    assert get(q, it.id).state is Status.FAILED
    assert review(q, it.id).state is Status.REVIEWED


def test_승인_철회(q):
    it = add(q)
    review(q, it.id)
    approve(q, it.id, by="박경찬")
    r = revoke(q, it.id, actor="박경찬")
    assert r.state is Status.REVIEWED
    assert r.approved_by == ""


def test_빈_승인자는_거부(q):
    it = add(q)
    review(q, it.id)
    with pytest.raises(ValueError):
        approve(q, it.id, by="  ")


def test_전이표에_종착상태는_비어있다():
    assert TRANSITIONS[Status.SENT] == set()
    assert TRANSITIONS[Status.DISCARDED] == set()


def test_모든_상태가_전이표에_있다():
    for s in Status:
        assert s in TRANSITIONS, f"{s} 가 전이표에 없습니다"


# ─────────────────────────────────────────────────────────────
# 이력
# ─────────────────────────────────────────────────────────────
def test_모든_전이가_이력에_남는다(q):
    it = add(q)
    review(q, it.id, actor="박경찬")
    approve(q, it.id, by="박경찬")
    mark_sent(q, it.id, result="OK")

    h = history(q, it.id)
    assert [x["to_state"] for x in h] == ["draft", "reviewed", "approved", "sent"]
    assert any(x["actor"] == "박경찬" for x in h)


def test_값변경도_이력에_남는다(q):
    it = add(q, value="처음")
    review(q, it.id)
    approve(q, it.id, by="박경찬")
    add(q, value="바뀜")
    assert any("승인이 취소" in (x["reason"] or "") for x in history(q, it.id))


# ─────────────────────────────────────────────────────────────
# 조회
# ─────────────────────────────────────────────────────────────
def test_기본조회는_종착상태를_뺀다(q):
    a = add(q, field_name="progress")
    b = add(q, field_name="memo")
    review(q, b.id)
    discard(q, b.id)
    rows = list_items(q, the_date=D)
    assert [r.field for r in rows] == ["progress"]
    assert len(list_items(q, the_date=D, include_terminal=True)) == 2


def test_요약(q):
    a = add(q, field_name="progress")
    b = add(q, field_name="homework")
    review(q, a.id)
    approve(q, a.id, by="박경찬")
    s = summary(q, the_date=D)
    assert s["total"] == 2
    assert s["ready"] == 1
    assert s["pending_review"] == 1


def test_다른_날짜는_섞이지_않는다(q):
    add(q)
    enqueue(q, the_date="2026-08-22", routine="day_record", field_name="progress",
            subject_key="gildong01", subject_name="홍길동", value="다른 날")
    assert len(list_items(q, the_date=D)) == 1


def test_없는_항목은_예외(q):
    with pytest.raises(KeyError):
        review(q, 9999)


