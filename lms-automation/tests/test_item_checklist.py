# -*- coding: utf-8 -*-
"""
문항 단위 체크리스트 + WAL (제안 P-08 / P-09).

이 파일이 지키는 것은 하나입니다: **재도전 기록이 사라지지 않는가.**

원안은 시도 개념 없이 (학생·교재·쪽·문항번호) 네 컬럼만으로 UNIQUE 를 걸었습니다.
그러면 같은 문제를 다시 풀 때 이전 행을 덮어써서 "틀렸다 → 다시 풀어 맞췄다" 라는
성장 궤적이 통째로 없어집니다. 오답 추적이 목적인 표가 하필 가장 중요한
데이터를 지우는 셈이라 기각했고, `attempt_no` 를 식별에 넣었습니다.

그래서 아래 테스트들은 "잘 저장되는가" 보다 **"덮어써지지 않는가"** 를 봅니다.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.students import (  # noqa: E402
    ITEM_CORRECT,
    ITEM_RESULTS,
    ITEM_STAGES,
    SOLUTION_NOTE_MIN_LINES,
    _apply_pragmas,
    add_observation,
    connect,
    get,
    item_history,
    item_status,
    item_summary,
    log_error,
    log_item,
    log_progress,
    register,
    weak_items,
)

BOOK = "중2-2-가우스-3"


@pytest.fixture
def db(tmp_path):
    conn = connect(tmp_path / "students.db")
    register(conn, login_id="a", name="가", book_grade="중2", book_level="가우스",
             book_term=2, book_volume=3)
    yield conn
    conn.close()


def _log(conn, result, *, page=31, problem_no=5, stage="ESSENTIAL", **kw):
    return log_item(conn, "a", book_code=BOOK, unit_number=3, page=page,
                    problem_no=problem_no, stage=stage, result=result, **kw)


# ─────────────────────────────────────────────────────────────
# WAL — 폰(낮)과 PC(밤)가 같은 DB 를 씁니다
# ─────────────────────────────────────────────────────────────
def test_파일DB는_WAL로_열린다(tmp_path):
    conn = connect(tmp_path / "students.db")
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL
    finally:
        conn.close()


def test_WAL은_파일에_남아_다음에_열어도_유지된다(tmp_path):
    """WAL 은 파일 포맷 설정이라 기존 DB 도 한 번 열면 전환됩니다."""
    p = tmp_path / "students.db"
    connect(p).close()
    raw = sqlite3.connect(p)
    try:
        assert raw.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    finally:
        raw.close()


def test_메모리DB에서도_깨지지_않는다():
    """`:memory:` 는 WAL 을 지원하지 않습니다. 그래도 열려야 합니다."""
    conn = connect(":memory:")
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
        assert mode != "wal"          # 안 켜지는 게 정상
        # 그런데도 표는 다 만들어져 있어야 합니다
        conn.execute("INSERT INTO students (student_key, login_id, name) "
                     "VALUES ('a','a','가')")
        assert log_item(conn, "a", book_code=BOOK, unit_number=1, page=1,
                        problem_no=1, stage="BASIC", result=ITEM_CORRECT) == 1
    finally:
        conn.close()


def test_WAL_설정_실패가_연결을_죽이지_않는다():
    """SMB·일부 동기화 폴더는 WAL 을 거부합니다.

    거기서 예외가 올라오면 **DB 를 아예 못 여는** 상태가 됩니다.
    동시성은 있으면 좋은 것이지, 없으면 기록을 포기할 일이 아닙니다.
    """
    class Broken:
        def execute(self, sql):
            raise sqlite3.OperationalError("disk I/O error")

    assert _apply_pragmas(Broken()) == ""   # 예외가 나오면 안 됩니다


# ─────────────────────────────────────────────────────────────
# 재도전 누적 — 이 표의 존재 이유
# ─────────────────────────────────────────────────────────────
def test_같은_문제를_세번_풀면_세건이_다_남는다(db):
    """P-08 기각의 핵심. 원안 UNIQUE 였다면 여기서 1건만 남습니다."""
    assert _log(db, "UNSOLVED", date="2026-08-01") == 1
    assert _log(db, "CALC_ERROR", date="2026-08-08") == 2
    assert _log(db, ITEM_CORRECT, date="2026-08-15") == 3

    n = db.execute("SELECT COUNT(*) FROM item_checklist").fetchone()[0]
    assert n == 3, "재도전이 이전 기록을 덮어썼습니다 — 성장 궤적이 사라집니다"


def test_시도_이력이_시간순_궤적으로_읽힌다(db):
    for r in ("UNSOLVED", "CALC_ERROR", ITEM_CORRECT):
        _log(db, r)
    h = item_history(db, "a", book_code=BOOK, page=31, problem_no=5)
    assert [x["attempt_no"] for x in h] == [1, 2, 3]
    assert [x["result"] for x in h] == ["UNSOLVED", "CALC_ERROR", "CORRECT"]


def test_시도번호는_문항마다_따로_센다(db):
    _log(db, "CALC_ERROR", page=31, problem_no=5)
    _log(db, "CALC_ERROR", page=31, problem_no=5)
    assert _log(db, "CALC_ERROR", page=31, problem_no=6) == 1, \
        "다른 문항인데 시도 번호가 이어졌습니다"
    assert _log(db, "CALC_ERROR", page=32, problem_no=5) == 1
    assert _log(db, "CALC_ERROR", page=31, problem_no=5) == 3


def test_단원번호는_문항의_정체성이_아니다(db):
    """단원을 잘못 적었다고 같은 문제가 갈라지면 시도 번호가 1 부터 다시 시작합니다."""
    log_item(db, "a", book_code=BOOK, unit_number=3, page=31, problem_no=5,
             stage="BASIC", result="CALC_ERROR")
    n = log_item(db, "a", book_code=BOOK, unit_number=4, page=31, problem_no=5,
                 stage="BASIC", result=ITEM_CORRECT)
    assert n == 2
    assert len(item_history(db, "a", book_code=BOOK, page=31, problem_no=5)) == 2


def test_같은_시도를_두번_기록하는_것은_여전히_막힌다(db):
    """누적은 허용하되 **중복**은 막아야 합니다."""
    _log(db, "CALC_ERROR")
    with pytest.raises(sqlite3.IntegrityError):
        with db:
            db.execute(
                """INSERT INTO item_checklist
                   (student_key, date, book_code, page, problem_no, attempt_no,
                    unit_number, stage, result, solution_note_pass)
                   VALUES ('a','2026-08-20',?,31,5,1,3,'BASIC','CORRECT',0)""",
                (BOOK,))


def test_호출자가_연_트랜잭션_안에서도_기록된다(db):
    """시도 번호를 원자적으로 잡으려고 `BEGIN IMMEDIATE` 를 씁니다.

    그런데 호출자가 이미 트랜잭션을 열어 뒀으면 중첩 BEGIN 이라 에러가 납니다.
    여러 학생 기록을 한 덩어리로 커밋하는 일괄 입력에서 실제로 생깁니다.
    """
    with db:
        db.execute("UPDATE students SET pace='특수' WHERE student_key='a'")
        assert db.in_transaction, "이 테스트의 전제가 깨졌습니다"
        assert _log(db, "CALC_ERROR") == 1
        assert _log(db, ITEM_CORRECT) == 2

    assert get(db, "a").pace == "특수"
    assert len(item_history(db, "a", book_code=BOOK, page=31, problem_no=5)) == 2


def test_교재코드가_다르면_다른_문항이다(db):
    _log(db, "CALC_ERROR")
    assert log_item(db, "a", book_code="초5-1-가우스-1", unit_number=1, page=31,
                    problem_no=5, stage="BASIC", result="CALC_ERROR") == 1


def test_교재코드는_학생_필드에서_안정적으로_나온다(db):
    """호출마다 이름이 흔들리면 같은 문제가 다른 문제로 갈라집니다."""
    s = get(db, "a")
    assert s.book_code == BOOK
    assert " " not in s.book_code


# ─────────────────────────────────────────────────────────────
# 최신 시도 조회
# ─────────────────────────────────────────────────────────────
def test_최신_시도만_뽑는다(db):
    _log(db, "UNSOLVED", date="2026-08-01")
    _log(db, "CALC_ERROR", date="2026-08-08")
    _log(db, ITEM_CORRECT, date="2026-08-15")

    cur = item_status(db, "a", book_code=BOOK, page=31, problem_no=5)
    assert cur["result"] == ITEM_CORRECT
    assert cur["attempt_no"] == 3, "최신 시도 번호가 곧 총 시도 횟수여야 합니다"
    assert cur["is_correct"] is True
    assert cur["date"] == "2026-08-15"


def test_기록이_없는_문항의_최신시도는_None(db):
    assert item_status(db, "a", book_code=BOOK, page=99, problem_no=1) is None


def test_최신시도_뷰는_문항당_한_행만_준다(db):
    for _ in range(4):
        _log(db, "CALC_ERROR")
    _log(db, "CALC_ERROR", page=32, problem_no=1)
    rows = db.execute("SELECT * FROM item_latest WHERE student_key='a'").fetchall()
    assert len(rows) == 2


# ─────────────────────────────────────────────────────────────
# 약점 — 다시 맞춘 문제는 빠져야 한다
# ─────────────────────────────────────────────────────────────
def test_다시_풀어_맞춘_문제는_약점에서_빠진다(db):
    _log(db, "CONCEPT_GAP", page=31, problem_no=5)
    _log(db, ITEM_CORRECT, page=31, problem_no=5)   # 재도전 성공
    _log(db, "CONCEPT_GAP", page=31, problem_no=7)  # 아직 못 맞춤

    weak = weak_items(db, "a")
    assert [w["problem_no"] for w in weak] == [7], \
        "고친 문제까지 약점으로 세면 클리닉 대상이 영원히 부풀어 오릅니다"


def test_한번_맞췄다가_다시_틀리면_약점으로_돌아온다(db):
    _log(db, ITEM_CORRECT)
    _log(db, "CONCEPT_GAP")
    assert [w["problem_no"] for w in weak_items(db, "a")] == [5]


def test_약점_개수_제한이_먹는다(db):
    for i in range(1, 6):
        _log(db, "UNSOLVED", problem_no=i)
    assert len(weak_items(db, "a", limit=3)) == 3


def test_약점이_없으면_빈_목록(db):
    _log(db, ITEM_CORRECT)
    assert weak_items(db, "a") == []


# ─────────────────────────────────────────────────────────────
# 어휘 검증 — 조용히 저장하면 집계가 틀립니다
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bad", ["개념확인", "concept_check", "", "REVIEW", None])
def test_정의되지_않은_stage는_거부(db, bad):
    with pytest.raises(ValueError):
        _log(db, ITEM_CORRECT, stage=bad)


@pytest.mark.parametrize("bad", ["맞음", "correct", "", "WRONG", None])
def test_정의되지_않은_result는_거부(db, bad):
    with pytest.raises(ValueError):
        _log(db, bad)


def test_거부된_값은_한_행도_남기지_않는다(db):
    with pytest.raises(ValueError):
        _log(db, "아무거나")
    assert db.execute("SELECT COUNT(*) FROM item_checklist").fetchone()[0] == 0


@pytest.mark.parametrize("empty", ["", "   ", None])
def test_교재코드가_비면_거부(db, empty):
    """book_code 는 문항 정체성의 일부라 비면 문항을 특정할 수 없습니다."""
    with pytest.raises(ValueError):
        log_item(db, "a", book_code=empty, unit_number=1, page=1,
                 problem_no=1, stage="BASIC", result=ITEM_CORRECT)


@pytest.mark.parametrize("bad", [0, -1, "쪽"])
def test_쪽수와_문항번호는_1_이상(db, bad):
    with pytest.raises(ValueError):
        _log(db, ITEM_CORRECT, page=bad)
    with pytest.raises(ValueError):
        _log(db, ITEM_CORRECT, problem_no=bad)


def test_정답값_상수가_어휘에_들어_있다():
    """오타 하나로 약점 집계가 조용히 틀리는 것을 막는 상수입니다."""
    assert ITEM_CORRECT in ITEM_RESULTS
    assert len(set(ITEM_STAGES)) == len(ITEM_STAGES)
    assert len(set(ITEM_RESULTS)) == len(ITEM_RESULTS)


# ─────────────────────────────────────────────────────────────
# 풀이 노트
# ─────────────────────────────────────────────────────────────
def test_풀이노트_통과는_줄수에서_유도된다(db):
    _log(db, ITEM_CORRECT, page=1, problem_no=1,
         solution_note_lines=SOLUTION_NOTE_MIN_LINES)
    _log(db, ITEM_CORRECT, page=1, problem_no=2,
         solution_note_lines=SOLUTION_NOTE_MIN_LINES - 1)

    assert item_status(db, "a", book_code=BOOK, page=1,
                       problem_no=1)["solution_note_pass"] is True
    assert item_status(db, "a", book_code=BOOK, page=1,
                       problem_no=2)["solution_note_pass"] is False


def test_강사가_통과를_직접_정할_수_있다(db):
    """'한 줄이지만 완결된 풀이' 같은 판단은 강사 몫입니다."""
    _log(db, ITEM_CORRECT, solution_note_lines=1, solution_note_pass=True)
    assert item_status(db, "a", book_code=BOOK, page=31,
                       problem_no=5)["solution_note_pass"] is True


def test_숙제_지정_플래그가_불리언으로_돌아온다(db):
    _log(db, "CONCEPT_GAP", assigned_as_homework=True)
    assert weak_items(db, "a")[0]["assigned_as_homework"] is True


# ─────────────────────────────────────────────────────────────
# 집계
# ─────────────────────────────────────────────────────────────
def test_단계별_정답_오답_집계(db):
    _log(db, ITEM_CORRECT, page=1, problem_no=1, stage="BASIC", date="2026-08-20")
    _log(db, "CALC_ERROR", page=1, problem_no=2, stage="BASIC", date="2026-08-20")
    _log(db, "CONCEPT_GAP", page=2, problem_no=1, stage="ESSENTIAL",
         date="2026-08-20")

    s = item_summary(db, "a", date="2026-08-20")
    assert s["total"] == 3 and s["correct"] == 1 and s["wrong"] == 2
    assert s["by_stage"]["BASIC"] == {
        "total": 2, "correct": 1, "wrong": 1,
        "by_result": {"CORRECT": 1, "CALC_ERROR": 1}}
    assert s["by_stage"]["ESSENTIAL"]["wrong"] == 1
    assert s["by_result"]["CONCEPT_GAP"] == 1


def test_날짜를_주면_그날_시도만_센다(db):
    _log(db, "CALC_ERROR", date="2026-08-01")
    _log(db, ITEM_CORRECT, date="2026-08-20")
    assert item_summary(db, "a", date="2026-08-01")["total"] == 1
    assert item_summary(db, "a", date="2026-08-20")["correct"] == 1


def test_전기간_집계는_최신시도만_센다(db):
    """3번 틀리고 4번째에 맞춘 한 문제를 '오답 3 정답 1' 로 세면
    실제보다 훨씬 못하는 것처럼 보입니다."""
    for r in ("UNSOLVED", "CALC_ERROR", "CALC_ERROR", ITEM_CORRECT):
        _log(db, r)

    s = item_summary(db, "a")
    assert s["scope"] == "latest"
    assert s["total"] == 1 and s["correct"] == 1 and s["wrong"] == 0
    assert s["correct_rate"] == 1.0

    allx = item_summary(db, "a", latest_only=False)
    assert allx["scope"] == "attempts"
    assert allx["total"] == 4 and allx["correct"] == 1


def test_기록이_없으면_정답률은_0이_아니라_None(db):
    """0% 와 '아직 안 풀었음' 은 다릅니다 (`ProgressStatus.delta` 와 같은 원칙)."""
    s = item_summary(db, "a")
    assert s["total"] == 0
    assert s["correct_rate"] is None


def test_다른_학생_기록이_섞이지_않는다(db):
    register(db, login_id="b", name="나")
    _log(db, "CONCEPT_GAP")
    log_item(db, "b", book_code=BOOK, unit_number=3, page=31, problem_no=5,
             stage="ESSENTIAL", result=ITEM_CORRECT)

    assert len(weak_items(db, "a")) == 1
    assert weak_items(db, "b") == []
    assert item_summary(db, "b")["correct"] == 1


# ─────────────────────────────────────────────────────────────
# 기존 DB 마이그레이션 — 데이터가 보존되는가
# ─────────────────────────────────────────────────────────────
#: 새 표가 생기기 **전** 스키마의 스냅샷. 현재 SCHEMA 를 재사용하면
#: 이미 새 표가 들어 있어 마이그레이션을 검증한 게 아니게 됩니다.
LEGACY_SCHEMA = """
CREATE TABLE students (
    student_key TEXT PRIMARY KEY, login_id TEXT NOT NULL, name TEXT NOT NULL,
    grade TEXT, homeroom TEXT, stu_pri_no TEXT, course_seq TEXT, cm_seq TEXT,
    synced_at TIMESTAMP, book_grade TEXT, book_level TEXT, book_term INTEGER,
    book_volume INTEGER, pace TEXT DEFAULT '보통', per_week INTEGER DEFAULT 2,
    start_page INTEGER, strengths TEXT, weaknesses TEXT, parent_notes TEXT,
    extra TEXT DEFAULT '{}', active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_key TEXT NOT NULL, date TEXT NOT NULL,
    text TEXT NOT NULL, tags TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE progress_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_key TEXT NOT NULL, date TEXT NOT NULL,
    session_no INTEGER, planned_section TEXT, actual_section TEXT,
    status TEXT NOT NULL, note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_key, date, session_no)
);
CREATE TABLE error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, student_key TEXT NOT NULL, date TEXT NOT NULL,
    lecture_key TEXT, problem_ref TEXT, tag TEXT NOT NULL, note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


@pytest.fixture
def legacy_db(tmp_path):
    """새 표가 없던 시절의 DB 를 만들어 둡니다."""
    p = tmp_path / "old.db"
    raw = sqlite3.connect(p)
    raw.executescript(LEGACY_SCHEMA)
    raw.execute("INSERT INTO students (student_key, login_id, name, grade, "
                "book_grade, weaknesses) VALUES "
                "('a','a','가','중2','중2','서술형 근거 부족')")
    raw.execute("INSERT INTO observations (student_key, date, text) "
                "VALUES ('a','2026-08-01','예전 메모')")
    raw.execute("INSERT INTO progress_log (student_key, date, session_no, status) "
                "VALUES ('a','2026-08-01',1,'완료')")
    raw.execute("INSERT INTO error_log (student_key, date, tag) "
                "VALUES ('a','2026-08-01','계산실수')")
    raw.commit()
    raw.close()
    return p


def test_기존_DB에_새_표가_안전하게_추가된다(legacy_db):
    conn = connect(legacy_db)
    try:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
        assert "item_checklist" in names
        assert "item_latest" in names
    finally:
        conn.close()


def test_기존_네_표의_데이터가_보존된다(legacy_db):
    conn = connect(legacy_db)
    try:
        s = get(conn, "a")
        assert s.name == "가"
        assert s.weaknesses == "서술형 근거 부족", "등록 정보가 날아갔습니다"
        for table in ("observations", "progress_log", "error_log"):
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: S608
            assert n == 1, f"{table} 의 기존 행이 사라졌습니다"
    finally:
        conn.close()


def test_기존_DB에서도_바로_기록할_수_있다(legacy_db):
    conn = connect(legacy_db)
    try:
        assert log_item(conn, "a", book_code=BOOK, unit_number=1, page=1,
                        problem_no=1, stage="BASIC", result="CALC_ERROR") == 1
        # 기존 기능도 그대로
        add_observation(conn, "a", "새 메모")
        log_progress(conn, "a", date="2026-08-20", session_no=2, status="완료")
        log_error(conn, "a", tag="개념부족")
    finally:
        conn.close()


def test_두번_열어도_표가_망가지지_않는다(legacy_db):
    """`connect()` 는 매번 스키마를 다시 실행합니다 (뷰는 매번 재생성)."""
    conn = connect(legacy_db)
    log_item(conn, "a", book_code=BOOK, unit_number=1, page=1, problem_no=1,
             stage="BASIC", result="CALC_ERROR")
    conn.close()

    conn = connect(legacy_db)
    try:
        assert len(item_history(conn, "a", book_code=BOOK, page=1,
                                problem_no=1)) == 1
        assert log_item(conn, "a", book_code=BOOK, unit_number=1, page=1,
                        problem_no=1, stage="BASIC", result=ITEM_CORRECT) == 2
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────
# 개인정보 경계
# ─────────────────────────────────────────────────────────────
def test_학생을_지우면_문항기록도_따라_지워진다(db):
    _log(db, "CONCEPT_GAP")
    with db:
        db.execute("DELETE FROM students WHERE student_key='a'")
    assert db.execute("SELECT COUNT(*) FROM item_checklist").fetchone()[0] == 0


def test_없는_학생에게는_기록되지_않는다(db):
    """외래키가 없으면 오타 하나로 유령 학생의 기록이 쌓입니다."""
    with pytest.raises(sqlite3.IntegrityError):
        log_item(db, "nobody", book_code=BOOK, unit_number=1, page=1,
                 problem_no=1, stage="BASIC", result=ITEM_CORRECT)
