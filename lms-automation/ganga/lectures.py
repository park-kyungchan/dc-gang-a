# -*- coding: utf-8 -*-
"""
강의 코드 인덱싱 — 본문 PDF 에 박힌 강의번호를 소단원과 연결합니다.

본문 PDF 의 강의 표기 구조 (실측, 중2-2 가우스 3권 17쪽)

    01. 삼각형의 성질
    17
    영상강의
    전자칠판강의
    H2109        ← 영상강의 (개념강의)
    1367422      ← 전자칠판강의 1
    1367423      ← 전자칠판강의 2

두 종류를 구분해서 담습니다. 재생 가능 여부가 다르기 때문입니다.

lecture_type 체계 (전부 실측 확인, 2026-08-20)

    type 1  전자칠판강의     URL 없음 → 네이티브 강아 앱 전용
    type 2  문항별 해설강의   URL 없음 → 네이티브 강아 앱 전용
    type 3  개념강의(H코드)   HLS URL 있음 → **웹/폰에서 재생 가능**

    ⚠️ 한때 전자칠판강의를 type 2 로 적었으나 실제로는 **type 1** 입니다.
       URL 이 없다는 결과는 같지만 값이 다르므로 판정에 쓰면 안 됩니다.
       **재생 가능 여부는 type 번호가 아니라 `lecture_url` 유무로 판단하세요.**
       서버가 새 타입을 추가해도 그쪽이 안전합니다.

⚠️ 타입은 서버에 물어봐야 확정됩니다. PDF 만 보고는 알 수 없습니다.
   그래서 `lecture_type` 은 기본 NULL 이고, `resolve_types()` 로 채웁니다.
   확인 전에는 "재생 가능" 이라고 말하지 않습니다.

⚠️ 샘플교재에는 앞부분 몇 쪽만 들어 있어 강의 표기도 몇 건뿐입니다
   (중2-2 3권 샘플 37쪽 중 2쪽). 전권 PDF 가 들어오면 훨씬 많아집니다.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from .config import ASSET_DIR, INDEX_DB
from .curriculum import BookRef

#: 강의 표기가 있는 쪽인지
_MARKER = re.compile(r"영상강의|전자칠판")

#: H 로 시작하는 개념강의 코드
_H_CODE = re.compile(r"\bH(\d{3,5})\b")

#: 7자리 전자칠판/해설 강의 코드
_NUM_CODE = re.compile(r"\b(\d{7})\b")

SCHEMA = """
CREATE TABLE IF NOT EXISTS lectures (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    book         TEXT NOT NULL,
    source_pdf   TEXT NOT NULL,
    pdf_page     INTEGER NOT NULL,
    unit_name    TEXT,
    section_name TEXT,
    kind         TEXT NOT NULL,     -- 개념강의 / 전자칠판강의
    code         TEXT NOT NULL,     -- H2109 또는 1367422
    lecture_key  TEXT NOT NULL,     -- 서버 조회용 (H 제거한 숫자)
    lecture_type INTEGER,           -- NULL=미확인, 2=앱전용, 3/4=웹재생
    stream_ok    INTEGER,           -- NULL=미확인, 1=URL 나옴, 0=안 나옴
    checked_at   TIMESTAMP,
    UNIQUE(source_pdf, code)
);
CREATE INDEX IF NOT EXISTS ix_lec_book ON lectures(book, pdf_page);
CREATE INDEX IF NOT EXISTS ix_lec_key  ON lectures(lecture_key);
"""


@dataclass
class LectureRef:
    book: str
    source_pdf: str
    pdf_page: int
    unit_name: str
    section_name: str
    kind: str
    code: str
    lecture_key: str

    @property
    def is_concept(self) -> bool:
        return self.kind == "개념강의"


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or INDEX_DB
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def _open(path: Path):
    try:
        import pymupdf
    except ImportError:  # pragma: no cover
        import fitz as pymupdf  # type: ignore[no-redef]
    return pymupdf.open(path)


def _section_at(toc_sections: list[tuple[int, str, str]], page: int
                ) -> tuple[str, str]:
    """쪽번호로 그 쪽이 속한 (대단원, 소단원)을 찾습니다."""
    unit = section = ""
    for start, u, s in toc_sections:
        if start <= page:
            unit, section = u, s
        else:
            break
    return unit, section


def parse_lectures(pdf: Path, book: BookRef) -> Iterator[LectureRef]:
    """본문 PDF 에서 강의 코드를 뽑아 소단원과 연결합니다."""
    from .syllabus import parse_toc

    syl = parse_toc(pdf, book)
    toc_sections = sorted(
        [(s.page, s.unit_name, s.section_name) for s in syl.sections if s.page],
        key=lambda x: x[0])

    doc = _open(pdf)
    label = book.label()
    try:
        for pno in range(len(doc)):
            text = doc[pno].get_text()
            if not _MARKER.search(text):
                continue
            unit, section = _section_at(toc_sections, pno + 1)

            seen: set[str] = set()
            for m in _H_CODE.finditer(text):
                code = f"H{m.group(1)}"
                if code in seen:
                    continue
                seen.add(code)
                yield LectureRef(label, pdf.name, pno + 1, unit, section,
                                 "개념강의", code, m.group(1))
            for m in _NUM_CODE.finditer(text):
                code = m.group(1)
                if code in seen:
                    continue
                seen.add(code)
                yield LectureRef(label, pdf.name, pno + 1, unit, section,
                                 "전자칠판강의", code, code)
    finally:
        doc.close()


def index_lectures(book: BookRef, *, conn: sqlite3.Connection | None = None
                   ) -> dict[str, Any]:
    own = conn is None
    conn = conn or connect()
    fn = book.sample_filename()
    if not fn:
        return {"error": f"{book.label()}: 본문 파일명을 만들 수 없습니다"}
    pdf = ASSET_DIR / fn
    if not pdf.exists():
        return {"error": f"{fn} 이 로컬에 없습니다. `ganga assets` 를 먼저 실행하세요"}

    rows = list(parse_lectures(pdf, book))
    with conn:
        conn.execute("DELETE FROM lectures WHERE source_pdf=?", (fn,))
        conn.executemany(
            """INSERT OR IGNORE INTO lectures
               (book, source_pdf, pdf_page, unit_name, section_name,
                kind, code, lecture_key)
               VALUES (?,?,?,?,?,?,?,?)""",
            [(r.book, r.source_pdf, r.pdf_page, r.unit_name, r.section_name,
              r.kind, r.code, r.lecture_key) for r in rows])

    result: dict[str, Any] = {
        "book": book.label(), "source_pdf": fn, "total": len(rows),
        "개념강의": sum(1 for r in rows if r.is_concept),
        "전자칠판강의": sum(1 for r in rows if not r.is_concept),
    }
    if not rows:
        result["note"] = (
            "이 PDF 에 강의 표기가 없습니다. 샘플교재는 앞부분 일부만 담고 있어 "
            "표기가 아예 없을 수 있습니다.")
    if own:
        conn.close()
    return result


def resolve_types(lms, *, conn: sqlite3.Connection | None = None,
                  limit: int = 50, only_unchecked: bool = True) -> dict[str, Any]:
    """서버에 물어 재생 가능 여부를 확정합니다.

    **PDF 만 보고는 알 수 없습니다.** 확인 전에는 재생 가능하다고 말하지 않습니다.
    """
    import json as _json

    from .lms.endpoints import BASE_URL

    own = conn is None
    conn = conn or connect()
    sql = "SELECT * FROM lectures"
    if only_unchecked:
        sql += " WHERE lecture_type IS NULL"
    sql += " LIMIT ?"
    rows = conn.execute(sql, (limit,)).fetchall()

    url = f"{BASE_URL}/servlet/controller.first.RegAppCommandServlet"
    checked = playable = failed = 0
    for r in rows:
        try:
            resp = lms.post(url, data={"reqCmd": "getVideoLecture",
                                       "lecture_key": r["lecture_key"]}, check=False)
            m = re.search(r"\{.*\}", resp.html_content, re.S)
            d = _json.loads(m.group(0)) if m else {}
        except Exception:  # noqa: BLE001
            failed += 1
            continue
        if d.get("result") != "OK":
            with conn:
                conn.execute(
                    "UPDATE lectures SET lecture_type=-1, stream_ok=0, "
                    "checked_at=CURRENT_TIMESTAMP WHERE id=?", (r["id"],))
            failed += 1
            continue
        ltype = int(d.get("lecture_type") or 0)
        ok = 1 if (d.get("lecture_url") or "") else 0
        with conn:
            conn.execute(
                "UPDATE lectures SET lecture_type=?, stream_ok=?, "
                "checked_at=CURRENT_TIMESTAMP WHERE id=?", (ltype, ok, r["id"]))
        checked += 1
        playable += ok

    out = {"checked": checked, "playable": playable, "failed": failed,
           "remaining": conn.execute(
               "SELECT COUNT(*) FROM lectures WHERE lecture_type IS NULL"
           ).fetchone()[0]}
    if own:
        conn.close()
    return out


def search(q: str = "", *, playable_only: bool = False, limit: int = 50,
           conn: sqlite3.Connection | None = None) -> list[dict]:
    own = conn is None
    conn = conn or connect()
    where, args = [], []
    if q:
        where.append("(code LIKE ? OR section_name LIKE ? OR unit_name LIKE ?)")
        args += [f"%{q}%"] * 3
    if playable_only:
        where.append("stream_ok = 1")
    sql = "SELECT * FROM lectures"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY book, pdf_page LIMIT ?"
    args.append(limit)
    rows = [dict(r) for r in conn.execute(sql, args)]
    if own:
        conn.close()
    return rows


def stats(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    own = conn is None
    conn = conn or connect()
    total = conn.execute("SELECT COUNT(*) FROM lectures").fetchone()[0]
    by_kind = {r["kind"]: r["n"] for r in conn.execute(
        "SELECT kind, COUNT(*) n FROM lectures GROUP BY kind")}
    checked = conn.execute(
        "SELECT COUNT(*) FROM lectures WHERE lecture_type IS NOT NULL").fetchone()[0]
    playable = conn.execute(
        "SELECT COUNT(*) FROM lectures WHERE stream_ok=1").fetchone()[0]
    if own:
        conn.close()
    return {"total": total, "by_kind": by_kind,
            "type_checked": checked, "type_unchecked": total - checked,
            "playable": playable}
