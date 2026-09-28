# -*- coding: utf-8 -*-
"""
문항 단위 인덱서 — 정답지 PDF → 검색 가능한 SQLite.

무엇이 되고 무엇이 안 되는지 (실측)
    ✅ 정답지 PDF 는 텍스트가 살아 있습니다. 문항번호·정답·**7자리 강의코드**·
       해설 본문을 뽑을 수 있습니다. 중2 가우스 합본에서 938문항 추출됨.
    ⚠️ 수식이 **PUA(사설영역) 폰트**라 `get_text()` 로는 빠집니다.
       "가 유한소수가 되려면 분모의 소인수가  또는 뿐이어야" 처럼 숫자가 사라집니다.
       → 그래서 해설은 텍스트가 아니라 **페이지 이미지**를 정본으로 봅니다.
          텍스트는 검색용 색인으로만 씁니다.
    ❌ 본문(샘플교재) PDF 는 텍스트가 0자인 순수 이미지입니다.
       문제 자체는 OCR 없이는 검색 불가이며, 이미지로만 제공합니다.

강의코드로 무엇을 할 수 있나 (실측)
    · 개념강의(`lecture_type=3`) → HLS URL 이 나와 폰에서 바로 재생됩니다.
    · **문항별 해설강의(`lecture_type=2`) → URL 이 비어 있습니다.**
      `direct_exam_play1()` 이 websocket 으로 **네이티브 강아 앱**을 호출하는
      구조라, 브라우저·휴대폰에서 링크로 열 수 없습니다. 표본 25/25 전부 type 2.
      → QR 은 '재생 링크' 가 아니라 '강의번호 전달' 용도로 씁니다.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .config import ASSET_DIR, INDEX_DB
from .curriculum import BookRef

#: 중등 대단원 머리글 — "Ⅰ. 수와 식"
#: 단원명 뒤에 쪽번호가 붙어 나오는 레이아웃이 있어 끝의 숫자를 잘라냅니다.
_UNIT_MID = re.compile(r"(?m)^([ⅠⅡⅢⅣⅤⅥⅦⅧ]+)\.\s*([^\n\d]{1,30})")

#: 초등 대단원 머리글 — "1 자연수의 혼합 계산"
_UNIT_ELEM = re.compile(r"(?m)^(\d{1,2})\s+([가-힣][^\n]{2,28})$")

#: 초등 소단원/회차 — "[1회] 1. 덧셈과 뺄셈 / 곱셈과 나눗셈이 섞여 있는 식"
_SECTION = re.compile(r"(?m)^\[(\d+)회\]\s*([^\n]{1,60})$")

#: 교재 실제 쪽수 — "6쪽". PDF 쪽과 다르며, 선생님이 실제로 부르는 번호입니다.
_BOOK_PAGE = re.compile(r"(?m)^(\d{1,3})쪽\s*$")

#: 문항번호 + 정답(복수 가능) ... 7자리 강의코드
#: "01 ④"          → 단일 정답
#: "01 ①, ②, ⑤"   → 복수 정답
#: "11"            → 서술형(정답 기호 없음)
_ITEM = re.compile(
    r"(?m)^(?P<no>\d{2})\s*(?P<ans>[①②③④⑤](?:\s*[,，]\s*[①②③④⑤])*)?\s*\n"
    r"(?:[^\n]*\n){0,2}?(?P<code>\d{7})\s*$"
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS problems (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    book          TEXT NOT NULL,     -- '중2 2학기 가우스 3권'
    grade         TEXT NOT NULL,     -- 중2
    level         TEXT NOT NULL,     -- 가우스
    unit_no       TEXT,              -- Ⅰ
    unit_name     TEXT,              -- 수와 식
    pdf_page      INTEGER NOT NULL,  -- 정답지 PDF 상의 쪽 (1-base)
    book_page     INTEGER,           -- 실제 교재 쪽수. 선생님이 부르는 번호
    problem_no    TEXT NOT NULL,     -- '01'
    answer        TEXT,              -- ④ (서술형은 빈 값)
    lecture_key   TEXT,              -- 1319840
    lecture_type  INTEGER,           -- 2=네이티브앱 전용, 3/4=웹재생 가능
    solution_text TEXT,              -- 검색용. 수식 누락 있음
    source_pdf    TEXT NOT NULL,
    UNIQUE(source_pdf, lecture_key)
);
CREATE INDEX IF NOT EXISTS ix_lecture ON problems(lecture_key);
CREATE INDEX IF NOT EXISTS ix_book    ON problems(book, unit_no, pdf_page);
CREATE INDEX IF NOT EXISTS ix_bookpg  ON problems(book, book_page, problem_no);

CREATE VIRTUAL TABLE IF NOT EXISTS problems_fts
    USING fts5(unit_name, solution_text, content='problems', content_rowid='id');

CREATE TABLE IF NOT EXISTS books (
    source_pdf TEXT PRIMARY KEY,
    book       TEXT NOT NULL,
    grade      TEXT, level TEXT, term INTEGER, volume INTEGER,
    pages      INTEGER,
    body_pdf   TEXT,               -- 본문(샘플) PDF 파일명
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


@dataclass
class Problem:
    book: str
    grade: str
    level: str
    unit_no: str
    unit_name: str
    pdf_page: int
    book_page: int | None
    problem_no: str
    answer: str
    lecture_key: str
    solution_text: str
    source_pdf: str


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or INDEX_DB
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def _open_pdf(path: Path):
    try:
        import pymupdf
    except ImportError:  # pragma: no cover
        import fitz as pymupdf  # type: ignore[no-redef]
    return pymupdf.open(path)


def _solution_slice(text: str, code: str, next_code: str | None) -> str:
    """강의코드 다음부터 다음 문항 코드 전까지를 해설로 봅니다."""
    i = text.find(code)
    if i < 0:
        return ""
    start = i + len(code)
    end = text.find(next_code, start) if next_code else -1
    seg = text[start:end if end > 0 else start + 900]
    # 줄바꿈·공백 정리. 수식이 빠져 공백만 남은 구간을 압축합니다.
    return re.sub(r"\s+", " ", seg).strip()[:800]


def parse_answer_pdf(pdf: Path, book: BookRef) -> Iterator[Problem]:
    """정답지 PDF 를 문항 단위로 훑습니다.

    두 가지 함정을 피합니다.
      · 각 쪽의 **첫 줄은 쪽번호**입니다("90\\n가우스 중2-2\\n03 ④\\n1331880").
        그대로 두면 90 이 문항번호로 잡힙니다. 첫 줄을 잘라내고 시작합니다.
      · 단원명 뒤에 쪽번호가 이어붙는 레이아웃이 있어 "도형의 성질101" 같은
        이름이 생깁니다. 단원명에서 숫자를 제외합니다.
    """
    doc = _open_pdf(pdf)
    is_elem = book.school == "초등"
    unit_no = unit_name = section = ""
    book_page: int | None = None
    label = book.label()

    try:
        for pno in range(len(doc)):
            raw = doc[pno].get_text()
            # 첫 줄(쪽번호) 제거 — 문항번호 오인의 주범
            lines = raw.split("\n")
            head, text = lines[0].strip(), "\n".join(lines[1:])

            if is_elem:
                m = _UNIT_ELEM.search(text)
                if m:
                    unit_no, unit_name = m.group(1), m.group(2).strip()
                s = _SECTION.search(text)
                if s:
                    section = f"[{s.group(1)}회] {s.group(2).strip()}"
            else:
                m = _UNIT_MID.search(text)
                if m:
                    unit_no = m.group(1)
                    unit_name = re.sub(r"\d+$", "", m.group(2)).strip()

            # 교재 쪽수("6쪽")는 **초등 정답지에만** 있는 표기입니다.
            # 중등에도 적용하면 앞쪽에서 우연히 잡은 값이 끝까지 따라다녀
            # 947문항 전부가 '교재 1쪽'이 되는 오염이 생깁니다.
            if is_elem:
                bp = _BOOK_PAGE.search(text)
                if bp:
                    book_page = int(bp.group(1))

            items = list(_ITEM.finditer(text))
            for idx, it in enumerate(items):
                nxt = items[idx + 1].group("code") if idx + 1 < len(items) else None
                ans = re.sub(r"\s+", "", it.group("ans") or "")
                yield Problem(
                    book=label, grade=book.grade, level=book.level,
                    unit_no=unit_no,
                    unit_name=(f"{unit_name} {section}".strip() if section else unit_name),
                    pdf_page=pno + 1,
                    book_page=book_page,
                    problem_no=it.group("no"),
                    answer=ans,
                    lecture_key=it.group("code"),
                    solution_text=_solution_slice(text, it.group("code"), nxt),
                    source_pdf=pdf.name,
                )
    finally:
        doc.close()


def index_book(book: BookRef, *, conn: sqlite3.Connection | None = None) -> dict[str, object]:
    """교재 1권의 정답지를 인덱싱합니다."""
    own = conn is None
    conn = conn or connect()
    fn = book.answer_filename()
    if not fn:
        return {"error": f"{book.label()}: 정답지 파일명을 만들 수 없습니다"}
    pdf = ASSET_DIR / fn
    if not pdf.exists():
        return {"error": f"{fn} 이 로컬에 없습니다. assets.ensure() 를 먼저 실행하세요"}

    rows = list(parse_answer_pdf(pdf, book))
    with conn:
        conn.execute("DELETE FROM problems WHERE source_pdf = ?", (fn,))
        conn.executemany(
            """INSERT OR IGNORE INTO problems
               (book,grade,level,unit_no,unit_name,pdf_page,book_page,problem_no,
                answer,lecture_key,solution_text,source_pdf)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(p.book, p.grade, p.level, p.unit_no, p.unit_name, p.pdf_page,
              p.book_page, p.problem_no, p.answer, p.lecture_key, p.solution_text,
              p.source_pdf)
             for p in rows],
        )
        # ⚠️ external-content FTS5 테이블은 `DELETE FROM ...` 로 비우면
        #    인덱스가 손상됩니다("database disk image is malformed").
        #    반드시 rebuild 명령을 써야 합니다.
        conn.execute("INSERT INTO problems_fts(problems_fts) VALUES('rebuild')")
        doc = _open_pdf(pdf)
        pages = len(doc)
        doc.close()
        conn.execute(
            """INSERT OR REPLACE INTO books
               (source_pdf,book,grade,level,term,volume,pages,body_pdf)
               VALUES (?,?,?,?,?,?,?,?)""",
            (fn, book.label(), book.grade, book.level, book.term, book.volume,
             pages, book.sample_filename()),
        )

    units = conn.execute(
        "SELECT unit_no, unit_name, COUNT(*) n FROM problems WHERE source_pdf=? "
        "GROUP BY 1,2 ORDER BY 1", (fn,)
    ).fetchall()
    result = {
        "book": book.label(), "source_pdf": fn, "pages": pages,
        "problems": len(rows),
        "with_answer": sum(1 for p in rows if p.answer),
        "units": [{"no": u["unit_no"], "name": u["unit_name"], "count": u["n"]} for u in units],
    }
    if own:
        conn.close()
    return result


def search(q: str, *, book: str | None = None, limit: int = 50,
           conn: sqlite3.Connection | None = None) -> list[dict]:
    """문항 검색.

    · 7자리 숫자면 강의코드 정확 조회
    · '12번' / '3-12' 같으면 문항번호
    · 그 외는 단원명·해설 전문검색
    """
    own = conn is None
    conn = conn or connect()
    q = (q or "").strip()
    where, args = [], []
    if book:
        where.append("book = ?")
        args.append(book)

    if re.fullmatch(r"\d{7}", q):
        where.append("lecture_key = ?")
        args.append(q)
        sql = f"SELECT * FROM problems WHERE {' AND '.join(where)} LIMIT ?"
    elif re.fullmatch(r"\d{1,2}\s*번?", q):
        where.append("problem_no = ?")
        args.append(q.rstrip("번 ").zfill(2))
        sql = f"SELECT * FROM problems WHERE {' AND '.join(where)} ORDER BY pdf_page LIMIT ?"
    elif q:
        where.append("id IN (SELECT rowid FROM problems_fts WHERE problems_fts MATCH ?)")
        args.append(q)
        sql = f"SELECT * FROM problems WHERE {' AND '.join(where)} ORDER BY pdf_page LIMIT ?"
    else:
        sql = (f"SELECT * FROM problems{' WHERE ' + ' AND '.join(where) if where else ''} "
               "ORDER BY pdf_page, problem_no LIMIT ?")

    args.append(limit)
    try:
        rows = [dict(r) for r in conn.execute(sql, args)]
    except sqlite3.OperationalError:
        # FTS 구문 오류(특수문자 등) → LIKE 폴백
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM problems WHERE solution_text LIKE ? OR unit_name LIKE ? LIMIT ?",
            (f"%{q}%", f"%{q}%", limit))]
    if own:
        conn.close()
    return rows


def page_image(source_pdf: str, page: int, *, dpi: int = 150) -> bytes:
    """정답지/본문 PDF 의 한 쪽을 PNG 로 렌더합니다.

    수식이 PUA 폰트라 텍스트로는 못 읽으므로, **이미지가 정본**입니다.
    """
    pdf = ASSET_DIR / source_pdf
    if not pdf.exists():
        raise FileNotFoundError(source_pdf)
    doc = _open_pdf(pdf)
    try:
        if not 1 <= page <= len(doc):
            raise ValueError(f"{page} 쪽은 범위(1~{len(doc)}) 밖입니다")
        pix = doc[page - 1].get_pixmap(dpi=dpi)
        return pix.tobytes("png")
    finally:
        doc.close()


def stats(conn: sqlite3.Connection | None = None) -> dict[str, object]:
    own = conn is None
    conn = conn or connect()
    books = [dict(r) for r in conn.execute(
        "SELECT b.*, (SELECT COUNT(*) FROM problems p WHERE p.source_pdf=b.source_pdf) n "
        "FROM books b")]
    total = conn.execute("SELECT COUNT(*) FROM problems").fetchone()[0]
    if own:
        conn.close()
    return {"total_problems": total, "books": books}
