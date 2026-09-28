# -*- coding: utf-8 -*-
"""
강의 코드 인덱싱 테스트.

핵심: **확인하지 않은 것을 재생 가능하다고 말하지 않는다.**
PDF 만 보고는 type 2(앱 전용)인지 type 3(웹 재생)인지 알 수 없습니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.config import ASSET_DIR  # noqa: E402
from ganga.curriculum import BookRef  # noqa: E402
from ganga.lectures import (  # noqa: E402
    _H_CODE,
    _MARKER,
    _NUM_CODE,
    _section_at,
    connect,
    index_lectures,
    resolve_types,
    search,
    stats,
)


@pytest.fixture
def db(tmp_path):
    conn = connect(tmp_path / "idx.db")
    yield conn
    conn.close()


BOOK = BookRef(grade="중2", level="가우스", term=2, volume=3)


def has_pdf() -> bool:
    fn = BOOK.sample_filename()
    return bool(fn) and (ASSET_DIR / fn).exists()


# ─────────────────────────────────────────────────────────────
# 코드 추출 패턴
# ─────────────────────────────────────────────────────────────
def test_영상강의_표기를_감지한다():
    assert _MARKER.search("영상강의\n전자칠판강의\nH2109")
    assert not _MARKER.search("01. 삼각형의 성질\n15")


def test_H코드와_7자리코드를_구분한다():
    text = "영상강의\n전자칠판강의\nH2109\n1367422\n1367423"
    assert _H_CODE.findall(text) == ["2109"]
    assert _NUM_CODE.findall(text) == ["1367422", "1367423"]


def test_H코드의_숫자부분이_서버조회키다():
    """playLecture 가 'H' 를 제거하고 보냅니다 (실측)."""
    assert _H_CODE.search("H2109").group(1) == "2109"


def test_쪽번호로_소단원을_찾는다():
    toc = [(14, "도형의 성질", "이등변삼각형의 성질"),
           (26, "도형의 성질", "직각삼각형의 합동")]
    assert _section_at(toc, 17)[1] == "이등변삼각형의 성질"
    assert _section_at(toc, 29)[1] == "직각삼각형의 합동"
    assert _section_at(toc, 5) == ("", ""), "첫 소단원 앞은 비어야 합니다"


# ─────────────────────────────────────────────────────────────
# 확인 전에는 재생 가능하다고 말하지 않는다
# ─────────────────────────────────────────────────────────────
@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음 — `ganga assets` 필요")
def test_인덱싱_직후_타입은_전부_미확인(db):
    index_lectures(BOOK, conn=db)
    rows = search(conn=db)
    assert rows, "강의를 하나도 못 뽑았습니다"
    assert all(r["lecture_type"] is None for r in rows)
    assert all(r["stream_ok"] is None for r in rows)

    s = stats(db)
    assert s["playable"] == 0, "확인도 안 했는데 재생 가능으로 셌습니다"
    assert s["type_unchecked"] == s["total"]


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_개념강의와_전자칠판강의를_나눠_담는다(db):
    r = index_lectures(BOOK, conn=db)
    assert r["개념강의"] > 0
    assert r["전자칠판강의"] > 0
    kinds = {x["kind"] for x in search(conn=db)}
    assert kinds == {"개념강의", "전자칠판강의"}


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_강의가_소단원에_연결된다(db):
    index_lectures(BOOK, conn=db)
    for x in search(conn=db):
        assert x["section_name"], f"{x['code']} 가 소단원에 연결되지 않았습니다"
        assert x["unit_name"]


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_재생가능만_추리면_확인전에는_비어야_한다(db):
    index_lectures(BOOK, conn=db)
    assert search(playable_only=True, conn=db) == []


def test_강의표기가_없는_PDF는_그렇게_말한다(db, tmp_path):
    """초5 샘플에는 강의 표기가 0건입니다. 0 을 오류로 보면 안 됩니다."""
    book = BookRef(grade="초5", level="가우스", term=1, volume=1)
    if not (ASSET_DIR / (book.sample_filename() or "x")).exists():
        pytest.skip("본문 PDF 없음")
    r = index_lectures(book, conn=db)
    assert r["total"] == 0
    assert "note" in r and "샘플" in r["note"]


def test_PDF가_없으면_안내한다(db):
    r = index_lectures(BookRef(grade="고3", level="없는레벨"), conn=db)
    assert "error" in r


# ─────────────────────────────────────────────────────────────
# 서버 확인 (가짜 세션)
# ─────────────────────────────────────────────────────────────
class FakeLms:
    """type 3(재생가능) / type 2(앱전용) / 없는 강의를 섞어 돌려줍니다."""

    def __init__(self):
        self.asked: list[str] = []

    def post(self, url, data=None, check=True, **kw):
        key = (data or {}).get("lecture_key", "")
        self.asked.append(key)

        class R:
            pass

        r = R()
        if key.startswith("21"):        # H2109/H2110 → 개념강의
            r.html_content = ('<html><body>{"result":"OK","lecture_type":3,'
                              '"lecture_url":"https://cdn/x.m3u8"}</body></html>')
        elif key == "9999999":
            r.html_content = ('<html><body>{"result":"FAIL",'
                              '"fail_message":"없는 강의입니다."}</body></html>')
        else:                            # 전자칠판 → type 2, URL 없음
            r.html_content = ('<html><body>{"result":"OK","lecture_type":2,'
                              '"lecture_url":""}</body></html>')
        return r


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_서버확인_후에야_재생가능이_채워진다(db):
    index_lectures(BOOK, conn=db)
    lms = FakeLms()
    out = resolve_types(lms, conn=db)

    assert out["checked"] > 0
    assert out["remaining"] == 0
    s = stats(db)
    assert s["playable"] == s["by_kind"]["개념강의"], \
        "개념강의만 재생 가능해야 합니다"
    assert s["type_unchecked"] == 0


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_전자칠판강의는_재생불가로_기록된다(db):
    index_lectures(BOOK, conn=db)
    resolve_types(FakeLms(), conn=db)
    for r in search(conn=db):
        if r["kind"] == "전자칠판강의":
            assert r["lecture_type"] == 2
            assert r["stream_ok"] == 0


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_이미_확인한_것은_다시_묻지_않는다(db):
    index_lectures(BOOK, conn=db)
    lms = FakeLms()
    resolve_types(lms, conn=db)
    n = len(lms.asked)
    resolve_types(lms, conn=db)          # only_unchecked 기본 True
    assert len(lms.asked) == n, "확인된 것을 다시 물었습니다"


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_H코드는_H를_떼고_묻는다(db):
    index_lectures(BOOK, conn=db)
    lms = FakeLms()
    resolve_types(lms, conn=db)
    assert all(not k.startswith("H") for k in lms.asked)


# ─────────────────────────────────────────────────────────────
# 검색
# ─────────────────────────────────────────────────────────────
@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_소단원명으로_검색(db):
    index_lectures(BOOK, conn=db)
    assert search("이등변", conn=db)


@pytest.mark.skipif(not has_pdf(), reason="본문 PDF 없음")
def test_코드로_검색(db):
    index_lectures(BOOK, conn=db)
    rows = search("H21", conn=db)
    assert rows and all(r["code"].startswith("H21") for r in rows)


def test_빈_DB_통계(db):
    s = stats(db)
    assert s == {"total": 0, "by_kind": {}, "type_checked": 0,
                 "type_unchecked": 0, "playable": 0}
