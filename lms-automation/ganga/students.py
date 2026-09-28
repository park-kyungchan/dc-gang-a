# -*- coding: utf-8 -*-
"""
학생 개별 DB — 강사가 소유하는 기록.

⚠️ 이 DB 에는 **미성년 학생의 실명이 들어갑니다.**
   저장 위치 `data/students/` 는 `.gitignore` 로 차단되어 있습니다.
   과거 이 저장소가 학생 실명 DB 를 public 에 노출한 사고가 있었습니다.
   절대 커밋하지 마세요.

경계 — 무엇이 여기 있고 무엇이 LMS 에 있는가
    LMS 가 정본인 것 (여기서는 **캐시**일 뿐, 고쳐도 서버에 안 감)
        이름 · 아이디 · 학년 · 반 · stu_pri_no · 출결 · DT점수 · 진도
    이 DB 가 정본인 것 (LMS 에 없고, 서버로 보내지 않음)
        수업 관찰 메모 · 진도 계획 대비 실적 · 오답 유형 누적
        진도 속도 설정 · 강약점 · 학부모 주의사항

    수업일지에 나가는 값은 LMS 것이고, 그 값을 **만들어내는 재료**가 이 DB 입니다.

확장성
    "생각나는대로 계속 요청할거야" 에 대비해 두 가지를 열어 뒀습니다.
      1. `students.extra` — 스키마 변경 없이 임의 항목을 넣는 JSON 칸
      2. `observations.tags` — 관찰 메모에 자유 태그
    자주 쓰이는 항목이 생기면 그때 정식 컬럼으로 승격하면 됩니다.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import date as Date
from pathlib import Path
from typing import Any

from .config import STUDENT_DIR
from .pedagogy import SCHEMA as PEDAGOGY_SCHEMA

DB_PATH = STUDENT_DIR / "students.db"

#: 오답 유형 — 누적하면 "이 학생은 약분에서 계속 틀림" 이 보입니다.
ERROR_TAGS: tuple[str, ...] = (
    "계산실수", "개념부족", "문제이해", "시간부족", "단순오기", "미응시",
)

#: 진도 실적 상태
PROGRESS_STATUS: tuple[str, ...] = ("완료", "부분", "미실시", "재수업")

#: 문항이 교재의 어느 구획에 있는가. LMS 어휘가 아니라 **이 DB 의 어휘**입니다.
#: 값을 늘릴 때는 여기만 고치면 됩니다 (SQL CHECK 로 박아두지 않은 이유는
#: `item_checklist` 스키마 주석 참고).
ITEM_STAGES: tuple[str, ...] = (
    "CONCEPT_CHECK",    # 개념확인
    "BASIC",            # 기본
    "ESSENTIAL",        # 필수
    "TYPE_PRACTICE",    # 유형연습
    "DAILY",            # 일일테스트
)

#: 문항 결과. "맞았다/틀렸다" 가 아니라 **왜 틀렸는가**까지 담습니다.
#: 계산실수와 개념부족은 처방이 완전히 다릅니다(다시 풀리기 vs 다시 가르치기).
ITEM_RESULTS: tuple[str, ...] = (
    "CORRECT",          # 맞음
    "CALC_ERROR",       # 계산 실수 — 방법은 알았음
    "CONCEPT_GAP",      # 개념 부족 — 접근 자체가 틀림
    "UNSOLVED",         # 손도 못 댐 / 미응시
)

#: 정답 값만 따로 상수로 둡니다. `"CORRECT"` 문자열을 조회마다 박아 넣으면
#: 오타 하나로 약점 집계가 **조용히** 틀립니다(에러 없이 결과만 달라짐).
ITEM_CORRECT: str = "CORRECT"

#: 풀이 노트 통과 기준 줄 수. 원안의 `solution_note_pass = (lines >= 2)` 입니다.
SOLUTION_NOTE_MIN_LINES: int = 2

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
    student_key  TEXT PRIMARY KEY,      -- 안정적인 식별자. LMS login_id 를 씁니다.
    -- ── LMS 가 정본 (여기서는 캐시) ────────────────────────
    login_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    grade        TEXT,
    homeroom     TEXT,                  -- 학반(담당 강사명)
    stu_pri_no   TEXT,                  -- 수업일지 전송에 필요. 배정 후에야 알 수 있음
    course_seq   TEXT,
    cm_seq       TEXT,
    synced_at    TIMESTAMP,
    -- ── 이 DB 가 정본 ─────────────────────────────────────
    book_grade   TEXT,                  -- 중2
    book_level   TEXT,                  -- 가우스
    book_term    INTEGER,               -- 2 (학기)
    book_volume  INTEGER,               -- 3 (권)
    pace         TEXT DEFAULT '보통',    -- 보통(3~4개월) / 특수(6개월)
    per_week     INTEGER DEFAULT 2,
    start_page   INTEGER,
    strengths    TEXT,
    weaknesses   TEXT,
    parent_notes TEXT,
    extra        TEXT DEFAULT '{}',     -- 확장용 JSON
    active       INTEGER DEFAULT 1,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS observations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    text        TEXT NOT NULL,          -- 서버 200자 제한과 무관하게 길게 씁니다
    tags        TEXT DEFAULT '[]',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_obs ON observations(student_key, date DESC);

CREATE TABLE IF NOT EXISTS progress_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key     TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    date            TEXT NOT NULL,
    session_no      INTEGER,            -- 계획상 몇 회차인가
    planned_section TEXT,               -- 계획한 소단원
    actual_section  TEXT,               -- 실제 나간 소단원
    -- 어디까지 갔는가 (ganga/pedagogy.py COVERAGE_LEVELS).
    -- `status` 는 이 값 + 완료 기준으로 **도출**되는 것이지 손으로 쓰는 게
    -- 아닙니다. 기준이 없으면 status 를 비워 둡니다 — '완료' 라고 단정하지
    -- 않으면 그 소단원이 계획에 남아, 빠뜨리는 대신 중복하는 쪽으로 틀립니다.
    reached_level   TEXT,
    status          TEXT NOT NULL,
    note            TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_key, date, session_no)
);
CREATE INDEX IF NOT EXISTS ix_prog ON progress_log(student_key, date DESC);

CREATE TABLE IF NOT EXISTS error_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    lecture_key TEXT,                   -- 문항 인덱스와 연결 (7자리)
    problem_ref TEXT,                   -- 'p.31 5번'
    tag         TEXT NOT NULL,
    note        TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_err  ON error_log(student_key, date DESC);
CREATE INDEX IF NOT EXISTS ix_errt ON error_log(student_key, tag);

-- ── 문항 단위 체크리스트 (제안 P-08 / P-09) ─────────────────────────
--
-- 원안은 시도 개념 없이 (학생·교재·쪽·문항번호) **네 컬럼만으로** UNIQUE 를
-- 걸었습니다. 기각했습니다(P-08). 그 제약이면 같은 문제를 다시 풀 때 이전
-- 기록을 덮어써서 "틀렸다 → 다시 풀어서 맞췄다" 라는 성장 궤적이 통째로
-- 사라집니다. 오답 추적이 이 표의 존재 이유인데 가장 중요한 데이터를 지웁니다.
--
-- (기각된 제약을 여기에 SQL 원문 그대로 옮겨 적지 않은 이유: 승격 원장
--  `proposal_ledger` 의 `forbidden` 스캔이 ganga/*.py 를 훑기 때문에, 설명하려고
--  적어둔 문장이 "기각한 것을 구현했다" 로 잡힙니다. 원장 파일 자신만 스캔에서
--  빠져 있습니다.)
--
-- 그래서 `attempt_no` 를 식별에 넣어 재도전이 **누적**되게 했습니다.
--   · 문항의 정체성 = (student_key, book_code, page, problem_no)
--     unit_number 는 정체성이 아니라 설명입니다. 단원 번호를 잘못 적었다고
--     같은 문제가 다른 문제로 갈라지면 시도 번호가 1 부터 다시 시작합니다.
--   · 한 시도    = 정체성 + attempt_no
-- 이러면 시도는 전부 남고, 같은 시도를 실수로 두 번 기록하는 것은 여전히 막힙니다.
--
-- stage·result 를 SQL CHECK 로 박지 않은 이유
--   CHECK 는 테이블에 얼어붙어 `CREATE TABLE IF NOT EXISTS` 로 못 고칩니다.
--   단계가 하나 늘면 이미 만들어진 DB 는 새 값을 영원히 거부하는데,
--   그때 필요한 건 테이블 재작성이라 마이그레이션 비용이 큽니다.
--   바뀔 수 있는 어휘는 파이썬에서 검사하고(ValueError), 절대 안 바뀌는
--   구조적 불변식(쪽수>0, 시도>=1, 불리언은 0/1)만 CHECK 로 둡니다.
CREATE TABLE IF NOT EXISTS item_checklist (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    student_key          TEXT NOT NULL REFERENCES students(student_key) ON DELETE CASCADE,
    date                 TEXT NOT NULL,
    -- ── 문항의 정체성 ─────────────────────────────────────
    book_code            TEXT NOT NULL,
    page                 INTEGER NOT NULL CHECK (page > 0),
    problem_no           INTEGER NOT NULL CHECK (problem_no > 0),
    attempt_no           INTEGER NOT NULL CHECK (attempt_no >= 1),
    -- ── 설명 ──────────────────────────────────────────────
    unit_number          INTEGER NOT NULL,
    stage                TEXT NOT NULL,
    result               TEXT NOT NULL,
    lecture_key          TEXT,               -- 문항 인덱스와 연결 (7자리)
    solution_note_lines  INTEGER NOT NULL DEFAULT 0 CHECK (solution_note_lines >= 0),
    solution_note_pass   INTEGER NOT NULL CHECK (solution_note_pass IN (0, 1)),
    assigned_as_homework INTEGER NOT NULL DEFAULT 0 CHECK (assigned_as_homework IN (0, 1)),
    note                 TEXT DEFAULT '',
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_key, book_code, page, problem_no, attempt_no)
);
CREATE INDEX IF NOT EXISTS ix_item_date  ON item_checklist(student_key, date DESC);
CREATE INDEX IF NOT EXISTS ix_item_stage ON item_checklist(student_key, stage);

-- 최신 시도만 뽑는 조회. "이 학생이 지금 무엇을 못 하는가" 는 전부가 아니라
-- **마지막 시도**로 판정해야 합니다. 다시 풀어 맞춘 문제까지 약점으로 세면
-- 클리닉 대상이 영원히 부풀어 오릅니다.
--
-- IF NOT EXISTS 를 쓰지 않고 매번 다시 만듭니다. 뷰에는 데이터가 없어
-- 다시 만드는 비용이 0 인데, IF NOT EXISTS 로 두면 나중에 정의를 고쳐도
-- 기존 DB 에는 옛 정의가 남아 코드와 조용히 어긋납니다.
DROP VIEW IF EXISTS item_latest;
CREATE VIEW item_latest AS
SELECT c.* FROM item_checklist c
 WHERE c.attempt_no = (
     SELECT MAX(c2.attempt_no) FROM item_checklist c2
      WHERE c2.student_key = c.student_key
        AND c2.book_code   = c.book_code
        AND c2.page        = c.page
        AND c2.problem_no  = c.problem_no
 );

-- 교육적 판단 기준 (ganga/pedagogy.py) — 정답이 강사의 선택에 달린 것들
{PEDAGOGY_SCHEMA}
"""


@dataclass
class Student:
    student_key: str
    login_id: str
    name: str
    grade: str = ""
    homeroom: str = ""
    stu_pri_no: str = ""
    course_seq: str = ""
    cm_seq: str = ""
    book_grade: str = ""
    book_level: str = ""
    book_term: int | None = None
    book_volume: int | None = None
    pace: str = "보통"
    per_week: int = 2
    start_page: int | None = None
    strengths: str = ""
    weaknesses: str = ""
    parent_notes: str = ""
    extra: dict[str, Any] = field(default_factory=dict)
    active: bool = True

    @property
    def book_label(self) -> str:
        if not self.book_grade:
            return "(교재 미지정)"
        bits = [self.book_grade]
        if self.book_term:
            bits.append(f"{self.book_term}학기")
        bits.append(self.book_level)
        if self.book_volume:
            bits.append(f"{self.book_volume}권")
        return " ".join(b for b in bits if b)

    @property
    def book_code(self) -> str:
        """`item_checklist.book_code` 에 넣을 안정적인 교재 코드.

        왜 필요한가: 문항의 정체성이 `(book_code, page, problem_no)` 라서,
        같은 교재를 부르는 이름이 호출마다 흔들리면(`중2가우스3` / `중2-2 가우스 3권`)
        같은 문제가 다른 문제로 갈라지고 시도 번호가 1 부터 다시 시작합니다.
        표시용 `book_label` 과 달리 이건 **키**이므로 공백 없이 고정합니다.
        """
        if not self.book_grade:
            return ""
        return "-".join(str(x) for x in (
            self.book_grade, self.book_term or 0,
            self.book_level or "", self.book_volume or 0))

    @property
    def can_write_to_lms(self) -> bool:
        """수업일지 전송에 필요한 LMS 식별키가 다 있는가."""
        return all([self.stu_pri_no, self.course_seq, self.cm_seq])

    def missing_keys(self) -> list[str]:
        return [k for k in ("stu_pri_no", "course_seq", "cm_seq")
                if not getattr(self, k)]

    def to_book_ref(self):
        from .curriculum import BookRef

        if not (self.book_grade and self.book_level):
            return None
        return BookRef(grade=self.book_grade, level=self.book_level,
                       term=self.book_term, volume=self.book_volume)


def _apply_pragmas(conn: sqlite3.Connection) -> str:
    """WAL 을 켭니다. 실제로 켜진 저널 모드를 돌려줍니다.

    왜 WAL 인가
        선생님이 **낮에는 폰(Tailscale), 밤에는 PC** 로 같은 파일을 씁니다.
        동시 접근이 가정이 아니라 실재합니다. 기본 rollback journal 은
        읽는 중에 쓰면 서로를 막아 `database is locked` 가 납니다.
        WAL 은 읽기와 쓰기가 서로를 막지 않습니다.

    왜 실패를 삼키는가
        `:memory:` 는 WAL 을 지원하지 않아 그냥 'memory' 를 돌려주고,
        일부 네트워크 파일시스템(SMB·일부 동기화 폴더)은 WAL 을 거부합니다.
        여기서 예외가 올라오면 **DB 를 아예 못 여는** 상태가 됩니다.
        동시성은 있으면 좋은 것이지, 없으면 기록을 포기할 일이 아닙니다.
        그래서 조용히 넘어가되 실제 모드를 돌려줘 확인은 가능하게 둡니다.
    """
    try:
        row = conn.execute("PRAGMA journal_mode = WAL").fetchone()
        mode = str(row[0]) if row else ""
    except sqlite3.Error:
        return ""
    try:
        # WAL + NORMAL 은 정전 시 마지막 몇 트랜잭션만 잃고 DB 가 깨지지는
        # 않습니다. FULL 은 커밋마다 fsync 라 폰에서 눈에 띄게 느립니다.
        conn.execute("PRAGMA synchronous = NORMAL")
    except sqlite3.Error:
        pass
    return mode.lower()


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    p = path or DB_PATH
    # `:memory:` 와 `file:...` URI 는 경로가 아니므로 mkdir 하면 안 됩니다.
    # (테스트에서 흔히 쓰는데 Windows 에서는 ':' 가 파일명에 못 들어갑니다.)
    if isinstance(p, str) and (p == ":memory:" or p.startswith("file:")):
        conn = sqlite3.connect(p, uri=p.startswith("file:"))
    else:
        p = Path(p)
        p.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    # 스키마보다 **먼저** — 이후의 모든 쓰기가 WAL 로 들어가도록.
    _apply_pragmas(conn)
    conn.executescript(SCHEMA.replace('{PEDAGOGY_SCHEMA}', PEDAGOGY_SCHEMA))
    _migrate(conn)
    return conn


#: 나중에 추가된 컬럼들. `(테이블, 컬럼, 정의)`.
#:
#: `CREATE TABLE IF NOT EXISTS` 는 **이미 있는 표에 컬럼을 붙이지 않습니다.**
#: 그래서 스키마만 고치면 새 DB 에서는 되고 기존 DB 에서는 터집니다.
#: 실제로 `reached_level` 을 추가했을 때 그 일이 났습니다 — 선생님 PC 에는
#: 이미 DB 가 있으니, 이 경로가 없으면 다음 실행에서 바로 깨졌을 겁니다.
_ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("progress_log", "reached_level", "TEXT"),
)


def _migrate(conn: sqlite3.Connection) -> list[str]:
    """기존 DB 에 빠진 컬럼을 붙입니다. 데이터는 건드리지 않습니다.

    `ALTER TABLE ADD COLUMN` 은 기존 행에 NULL 을 넣을 뿐이라 안전합니다.
    되돌릴 필요도 없습니다 — 값이 NULL 이면 "아직 모른다" 로 읽힙니다.
    """
    applied: list[str] = []
    for table, column, decl in _ADDED_COLUMNS:
        try:
            cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        except sqlite3.Error:
            continue
        if not cols or column in cols:
            continue
        with conn:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        applied.append(f"{table}.{column}")
    return applied


def _row_to_student(r: sqlite3.Row) -> Student:
    d = dict(r)
    d["extra"] = json.loads(d.get("extra") or "{}")
    d["active"] = bool(d.get("active", 1))
    for k in ("created_at", "updated_at", "synced_at"):
        d.pop(k, None)
    return Student(**d)


# ─────────────────────────────────────────────────────────────
# 등록 / 갱신
# ─────────────────────────────────────────────────────────────
#: 등록 시 물어보는 항목. 화면·CLI 가 이 목록을 공유합니다.
REGISTRATION_FIELDS: tuple[dict[str, Any], ...] = (
    {"key": "book_grade", "label": "교재 학년", "example": "중2", "required": True},
    {"key": "book_level", "label": "교재 레벨", "example": "가우스", "required": True,
     "note": "초등은 가우스=발전, 시그마=기본, 다빈치=심화, 오일러=최상위"},
    {"key": "book_term", "label": "학기", "example": "2", "type": "int"},
    {"key": "book_volume", "label": "권", "example": "3", "type": "int"},
    {"key": "pace", "label": "진도 속도", "example": "보통",
     "choices": ["보통", "특수"], "note": "보통 3~4개월 / 특수 6개월"},
    {"key": "per_week", "label": "주당 횟수", "example": "2", "type": "int"},
    {"key": "start_page", "label": "시작 쪽", "example": "1", "type": "int"},
    {"key": "strengths", "label": "강점 한 줄", "example": "계산이 빠름"},
    {"key": "weaknesses", "label": "약점 한 줄", "example": "서술형에서 근거를 안 씀"},
    {"key": "parent_notes", "label": "학부모 주의사항", "example": "문자보다 전화 선호"},
)


def register(
    conn: sqlite3.Connection,
    *,
    login_id: str,
    name: str,
    **fields: Any,
) -> Student:
    """학생을 등록합니다. 같은 login_id 면 갱신합니다.

    `login_id` 를 키로 쓰는 이유: `stu_pri_no` 가 LMS 의 진짜 식별자지만
    학생이 반에 배정되기 전에는 알 수 없습니다. login_id 는 사용자검색
    화면에서 바로 보이고 바뀌지 않습니다.
    """
    if not login_id or not name:
        raise ValueError("login_id 와 name 은 필수입니다")

    extra = fields.pop("extra", {}) or {}
    known = {c["key"] for c in REGISTRATION_FIELDS} | {
        "grade", "homeroom", "stu_pri_no", "course_seq", "cm_seq", "active"}
    # 모르는 항목은 버리지 않고 extra 로 보냅니다 (확장성)
    unknown = {k: v for k, v in fields.items() if k not in known}
    fields = {k: v for k, v in fields.items() if k in known}
    extra.update(unknown)

    s = Student(student_key=login_id, login_id=login_id, name=name, extra=extra,
                **fields)

    with conn:
        conn.execute(
            """INSERT INTO students
               (student_key, login_id, name, grade, homeroom,
                stu_pri_no, course_seq, cm_seq,
                book_grade, book_level, book_term, book_volume,
                pace, per_week, start_page,
                strengths, weaknesses, parent_notes, extra, active)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(student_key) DO UPDATE SET
                 name=excluded.name,
                 -- 학년·학반은 **LMS 가 정본**입니다. 등록할 때 값을 안 주면
                 -- 기존 것을 유지해야 합니다. 무조건 덮으면 동기화로 받아온
                 -- 정보가 등록 한 번에 날아갑니다.
                 grade=COALESCE(NULLIF(excluded.grade,''), students.grade),
                 homeroom=COALESCE(NULLIF(excluded.homeroom,''), students.homeroom),
                 stu_pri_no=COALESCE(NULLIF(excluded.stu_pri_no,''), students.stu_pri_no),
                 course_seq=COALESCE(NULLIF(excluded.course_seq,''), students.course_seq),
                 cm_seq=COALESCE(NULLIF(excluded.cm_seq,''), students.cm_seq),
                 book_grade=excluded.book_grade, book_level=excluded.book_level,
                 book_term=excluded.book_term, book_volume=excluded.book_volume,
                 pace=excluded.pace, per_week=excluded.per_week,
                 start_page=excluded.start_page,
                 strengths=excluded.strengths, weaknesses=excluded.weaknesses,
                 parent_notes=excluded.parent_notes, extra=excluded.extra,
                 active=excluded.active,
                 updated_at=CURRENT_TIMESTAMP""",
            (s.student_key, s.login_id, s.name, s.grade, s.homeroom,
             s.stu_pri_no, s.course_seq, s.cm_seq,
             s.book_grade, s.book_level, s.book_term, s.book_volume,
             s.pace, s.per_week, s.start_page,
             s.strengths, s.weaknesses, s.parent_notes,
             json.dumps(s.extra, ensure_ascii=False), int(s.active)),
        )
    return get(conn, login_id)  # type: ignore[return-value]


def find_by_pri_no(conn: sqlite3.Connection, stu_pri_no: str) -> Student | None:
    """LMS 식별자로 학생을 찾습니다.

    수업일지 화면은 `login_id` 를 주지 않고 `stu_pri_no` 만 줍니다.
    식별키를 채워 넣을 때 같은 학생을 두 번 만들지 않으려면 이 조회가 필요합니다.
    """
    if not stu_pri_no:
        return None
    row = conn.execute(
        "SELECT * FROM students WHERE stu_pri_no=? LIMIT 1", (stu_pri_no,)
    ).fetchone()
    return _row_to_student(row) if row else None


def sync_from_lms(conn: sqlite3.Connection, roster_students: list[Any]) -> dict[str, int]:
    """LMS 명단으로 캐시 필드만 갱신합니다.

    등록 정보(교재·진도속도·메모)는 **건드리지 않습니다.** LMS 가 정본인
    필드와 이 DB 가 정본인 필드를 섞으면 선생님이 쓴 내용이 덮어써집니다.
    """
    updated = added = 0
    with conn:
        for st in roster_students:
            login = getattr(st, "login_id", "") or ""
            if not login:
                continue
            exists = conn.execute(
                "SELECT 1 FROM students WHERE student_key=?", (login,)).fetchone()
            if exists:
                conn.execute(
                    """UPDATE students SET name=?, grade=?, homeroom=?,
                       synced_at=CURRENT_TIMESTAMP WHERE student_key=?""",
                    (getattr(st, "name", ""), getattr(st, "grade", ""),
                     getattr(st, "homeroom", ""), login))
                updated += 1
            else:
                conn.execute(
                    """INSERT INTO students (student_key, login_id, name, grade,
                       homeroom, synced_at)
                       VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)""",
                    (login, login, getattr(st, "name", ""),
                     getattr(st, "grade", ""), getattr(st, "homeroom", "")))
                added += 1
    return {"added": added, "updated": updated}


def get(conn: sqlite3.Connection, key: str) -> Student | None:
    r = conn.execute("SELECT * FROM students WHERE student_key=?", (key,)).fetchone()
    return _row_to_student(r) if r else None


def list_students(conn: sqlite3.Connection, *, active_only: bool = True,
                  registered_only: bool = False) -> list[Student]:
    sql = "SELECT * FROM students"
    where = []
    if active_only:
        where.append("active=1")
    if registered_only:
        where.append("book_grade IS NOT NULL AND book_grade != ''")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY name"
    return [_row_to_student(r) for r in conn.execute(sql)]


# ─────────────────────────────────────────────────────────────
# 관찰 메모 / 진도 실적 / 오답 유형
# ─────────────────────────────────────────────────────────────
def add_observation(conn: sqlite3.Connection, key: str, text: str, *,
                    date: str | None = None, tags: list[str] | None = None) -> int:
    if not text.strip():
        raise ValueError("빈 관찰 메모는 저장하지 않습니다")
    with conn:
        cur = conn.execute(
            "INSERT INTO observations (student_key, date, text, tags) VALUES (?,?,?,?)",
            (key, date or Date.today().isoformat(), text.strip(),
             json.dumps(tags or [], ensure_ascii=False)))
    return int(cur.lastrowid or 0)


def observations(conn: sqlite3.Connection, key: str, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM observations WHERE student_key=? ORDER BY date DESC, id DESC LIMIT ?",
        (key, limit))
    out = []
    for r in rows:
        d = dict(r)
        d["tags"] = json.loads(d.get("tags") or "[]")
        out.append(d)
    return out


def log_progress(conn: sqlite3.Connection, key: str, *, date: str,
                 status: str | None = None, reached: str | None = None,
                 session_no: int | None = None, planned: str = "",
                 actual: str = "", note: str = "") -> None:
    """진도 실적 1건. `planned` / `actual` 은 **원문 그대로** 저장합니다.

    소단원명을 정규화해서 저장하고 싶어질 수 있지만 하지 않습니다. 선생님이
    적은 문장이 이 기록의 정본이고, 정규화는 되돌릴 수 없는 손실이기 때문입니다
    ("1. 소인수분해 (p.10~15)" 를 눌러 담으면 쪽수가 영영 사라집니다).
    계획과 대조할 때만 `ganga.curriculum.canonical_section_key` 로 키를 만들어
    비교합니다. 대조 지점은 `ganga.syllabus.build_plan` 한 곳입니다.
    """
    from .pedagogy import (
        COVERAGE_LEVELS,
        get_completion_standard,
        judge_progress,
    )

    if reached is not None:
        if reached not in COVERAGE_LEVELS:
            raise ValueError(
                f"reached 는 {COVERAGE_LEVELS} 중 하나여야 합니다: {reached!r}")
        # 도달 수준을 줬으면 status 는 **도출**합니다. 손으로 쓴 status 보다
        # 기준에 따라 계산한 것이 정본입니다.
        derived = judge_progress(
            reached, get_completion_standard(conn, key, scope=actual or ""))
        if derived is not None:
            status = derived
        elif status is None:
            # 기준이 없습니다. '완료' 라고 단정하지 않고 비워 둡니다.
            status = ""
    if status is None:
        raise ValueError("status 또는 reached 중 하나는 있어야 합니다")
    if status and status not in PROGRESS_STATUS:
        raise ValueError(f"status 는 {PROGRESS_STATUS} 중 하나여야 합니다: {status!r}")

    with conn:
        conn.execute(
            """INSERT INTO progress_log
               (student_key, date, session_no, planned_section, actual_section,
                reached_level, status, note) VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(student_key, date, session_no) DO UPDATE SET
                 planned_section=excluded.planned_section,
                 actual_section=excluded.actual_section,
                 reached_level=excluded.reached_level,
                 status=excluded.status, note=excluded.note""",
            (key, date, session_no, planned, actual, reached, status, note))


def log_error(conn: sqlite3.Connection, key: str, *, tag: str, date: str | None = None,
              lecture_key: str = "", problem_ref: str = "", note: str = "") -> None:
    if tag not in ERROR_TAGS:
        raise ValueError(f"tag 는 {ERROR_TAGS} 중 하나여야 합니다: {tag!r}")
    with conn:
        conn.execute(
            """INSERT INTO error_log
               (student_key, date, lecture_key, problem_ref, tag, note)
               VALUES (?,?,?,?,?,?)""",
            (key, date or Date.today().isoformat(), lecture_key, problem_ref, tag, note))


# ─────────────────────────────────────────────────────────────
# 문항 단위 체크리스트 — 한 문제를 몇 번째 시도에서 맞췄는가
# ─────────────────────────────────────────────────────────────
def _row_to_item(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["solution_note_pass"] = bool(d.get("solution_note_pass", 0))
    d["assigned_as_homework"] = bool(d.get("assigned_as_homework", 0))
    #: 조회하는 쪽이 `result == "CORRECT"` 를 손으로 쓰지 않도록 미리 풀어 둡니다.
    d["is_correct"] = d.get("result") == ITEM_CORRECT
    return d


def _positive_int(value: Any, field_name: str) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} 는 정수여야 합니다: {value!r}") from None
    if n < 1:
        raise ValueError(f"{field_name} 는 1 이상이어야 합니다: {n}")
    return n


def log_item(
    conn: sqlite3.Connection,
    key: str,
    *,
    book_code: str,
    unit_number: int,
    page: int,
    problem_no: int,
    stage: str,
    result: str,
    date: str | None = None,
    lecture_key: str = "",
    solution_note_lines: int = 0,
    solution_note_pass: bool | None = None,
    assigned_as_homework: bool = False,
    note: str = "",
) -> int:
    """문항 한 문제의 **한 시도**를 기록하고 그 시도 번호를 돌려줍니다.

    같은 문제를 다시 풀면 덮어쓰지 않고 `attempt_no` 를 +1 해서 쌓습니다.
    그래서 돌려주는 값이 곧 "이 문제를 지금까지 몇 번 풀었는가" 입니다.

    잘못된 `stage`·`result` 는 저장하지 않고 예외를 냅니다. 조용히 저장하면
    나중에 단계별 집계가 틀리는데, **틀린 줄도 모르는 것**이 더 나쁩니다.
    """
    if stage not in ITEM_STAGES:
        raise ValueError(f"stage 는 {ITEM_STAGES} 중 하나여야 합니다: {stage!r}")
    if result not in ITEM_RESULTS:
        raise ValueError(f"result 는 {ITEM_RESULTS} 중 하나여야 합니다: {result!r}")

    book_code = (book_code or "").strip()
    if not book_code:
        raise ValueError("book_code 는 필수입니다 (문항 정체성의 일부)")
    page = _positive_int(page, "page")
    problem_no = _positive_int(problem_no, "problem_no")
    unit_number = int(unit_number)
    lines = max(0, int(solution_note_lines or 0))
    # 기본값은 줄 수에서 **유도**합니다. 유도할 수 있는 값을 손으로 받으면
    # lines=0 인데 pass=1 같은 모순이 남고, 그 상태로 집계가 돌아갑니다.
    # 다만 "한 줄이지만 완결된 풀이" 같은 판단은 강사 몫이라 override 는 둡니다.
    if solution_note_pass is None:
        solution_note_pass = lines >= SOLUTION_NOTE_MIN_LINES

    # 번호를 읽고 쓰는 사이에 다른 프로세스가 끼어들면 두 시도가 같은
    # attempt_no 를 받습니다(폰·PC 동시 사용은 실재합니다). BEGIN IMMEDIATE 로
    # 쓰기 잠금을 먼저 잡아 읽기+쓰기를 한 덩어리로 만듭니다.
    # 이미 호출자가 트랜잭션을 열어 뒀으면 거기에 얹습니다 (중첩 BEGIN 은 에러).
    own_tx = not conn.in_transaction
    if own_tx:
        conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT COALESCE(MAX(attempt_no), 0) FROM item_checklist "
            "WHERE student_key=? AND book_code=? AND page=? AND problem_no=?",
            (key, book_code, page, problem_no)).fetchone()
        attempt_no = int(row[0]) + 1
        conn.execute(
            """INSERT INTO item_checklist
               (student_key, date, book_code, page, problem_no, attempt_no,
                unit_number, stage, result, lecture_key,
                solution_note_lines, solution_note_pass, assigned_as_homework, note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (key, date or Date.today().isoformat(), book_code, page, problem_no,
             attempt_no, unit_number, stage, result, lecture_key,
             lines, int(bool(solution_note_pass)), int(bool(assigned_as_homework)),
             note))
        if own_tx:
            conn.commit()
    except Exception:
        if own_tx:
            conn.rollback()
        raise
    return attempt_no


def item_history(conn: sqlite3.Connection, key: str, *, book_code: str,
                 page: int, problem_no: int) -> list[dict]:
    """한 문항의 시도 이력 **전부**를 시도순(오래된 것 먼저)으로.

    다른 조회는 최신순이지만 여기만 오름차순인 이유: 이 목록의 쓸모가
    "UNSOLVED → CALC_ERROR → CORRECT" 같은 **궤적**을 읽는 것이라
    시간 순서대로 나와야 읽힙니다.
    """
    rows = conn.execute(
        "SELECT * FROM item_checklist "
        "WHERE student_key=? AND book_code=? AND page=? AND problem_no=? "
        "ORDER BY attempt_no",
        (key, (book_code or "").strip(), page, problem_no))
    return [_row_to_item(r) for r in rows]


def item_status(conn: sqlite3.Connection, key: str, *, book_code: str,
                page: int, problem_no: int) -> dict | None:
    """한 문항의 **최신 시도**. 기록이 없으면 None.

    돌려주는 `attempt_no` 가 곧 지금까지의 총 시도 횟수입니다
    (시도가 1 부터 빠짐없이 올라가므로 따로 세지 않아도 됩니다).
    """
    r = conn.execute(
        "SELECT * FROM item_latest "
        "WHERE student_key=? AND book_code=? AND page=? AND problem_no=?",
        (key, (book_code or "").strip(), page, problem_no)).fetchone()
    return _row_to_item(r) if r else None


def weak_items(conn: sqlite3.Connection, key: str, *, limit: int = 20) -> list[dict]:
    """아직 못 맞춘 문항 — **최신 시도**가 CORRECT 가 아닌 것만.

    전체 시도가 아니라 최신 시도로 판정하는 이유: 한 번 틀렸다가 다시 풀어
    맞춘 문제는 더 이상 약점이 아닙니다. 시도 전체를 보면 고친 문제까지
    영원히 약점으로 남아 클리닉 대상이 계속 부풀어 오릅니다.
    """
    rows = conn.execute(
        "SELECT * FROM item_latest WHERE student_key=? AND result != ? "
        "ORDER BY date DESC, attempt_no DESC, id DESC LIMIT ?",
        (key, ITEM_CORRECT, limit))
    return [_row_to_item(r) for r in rows]


def item_summary(conn: sqlite3.Connection, key: str, *, date: str | None = None,
                 latest_only: bool | None = None) -> dict[str, Any]:
    """단계별 정답/오답 집계.

    무엇을 세는지가 두 가지라 기본값을 `date` 에 맞춰 갈라 뒀습니다.

    * `date` 를 주면 → **그 날 기록한 시도**를 셉니다. 하루치 수업 기록은
      "오늘 어느 단계에서 몇 개 틀렸나" 이므로 시도가 단위입니다.
    * `date` 가 없으면 → **문항별 최신 시도**를 셉니다. 전 기간 시도를 다
      더하면 3번 틀리고 4번째에 맞춘 한 문제가 '오답 3 · 정답 1' 로 잡혀
      실제보다 훨씬 못하는 것처럼 보입니다.

    헷갈릴 여지가 있어 무엇을 셌는지를 결과의 `scope` 에 적어 돌려줍니다.
    `latest_only` 로 이 기본값을 뒤집을 수 있습니다.
    `correct_rate` 는 기록이 없으면 0.0 이 아니라 **None** 입니다
    (0% 와 "아직 안 풀었음" 은 다릅니다).
    """
    if latest_only is None:
        latest_only = date is None
    # 테이블명은 리터럴 두 개 중 하나라 주입 여지가 없습니다.
    source = "item_latest" if latest_only else "item_checklist"

    sql = f"SELECT stage, result, COUNT(*) AS n FROM {source} WHERE student_key=?"  # noqa: S608
    params: list[Any] = [key]
    if date:
        sql += " AND date=?"
        params.append(date)
    sql += " GROUP BY stage, result"

    by_stage: dict[str, dict[str, Any]] = {}
    by_result: dict[str, int] = {}
    total = correct = 0
    for r in conn.execute(sql, params):
        stage, res, n = r["stage"], r["result"], int(r["n"])
        slot = by_stage.setdefault(
            stage, {"total": 0, "correct": 0, "wrong": 0, "by_result": {}})
        slot["total"] += n
        slot["by_result"][res] = slot["by_result"].get(res, 0) + n
        by_result[res] = by_result.get(res, 0) + n
        total += n
        if res == ITEM_CORRECT:
            slot["correct"] += n
            correct += n
        else:
            slot["wrong"] += n

    return {
        "scope": "latest" if latest_only else "attempts",
        "date": date,
        "total": total,
        "correct": correct,
        "wrong": total - correct,
        "correct_rate": (correct / total) if total else None,
        "by_stage": by_stage,
        "by_result": by_result,
    }


def error_profile(conn: sqlite3.Connection, key: str) -> dict[str, Any]:
    """오답 유형 분포. 누적되면 '이 학생은 무엇에서 계속 틀리는지'가 보입니다."""
    rows = conn.execute(
        "SELECT tag, COUNT(*) n FROM error_log WHERE student_key=? "
        "GROUP BY tag ORDER BY n DESC", (key,)).fetchall()
    total = sum(r["n"] for r in rows)
    return {
        "total": total,
        "by_tag": {r["tag"]: r["n"] for r in rows},
        "dominant": rows[0]["tag"] if rows else None,
    }


# ─────────────────────────────────────────────────────────────
# 진도 계획 대비 실적
# ─────────────────────────────────────────────────────────────
@dataclass
class ProgressStatus:
    student: str
    book: str
    planned_total: int = 0
    done_sessions: int = 0
    #: 경과 주수를 주지 않으면 None. 0 과 구분해야 합니다.
    expected_sessions: int | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def delta(self) -> int | None:
        """계획 대비 회차 차이. 음수면 뒤처진 것.

        비교 기준(expected_sessions)이 없으면 None 입니다.
        기준 없이 0 과 비교해 '앞섬' 이라고 말하면 거짓 보고입니다.
        """
        if self.expected_sessions is None:
            return None
        return self.done_sessions - self.expected_sessions

    @property
    def label(self) -> str:
        if not self.planned_total:
            return "계획 없음"
        d = self.delta
        if d is None:
            return "계획 대비 미산출 (경과 주수 필요)"
        if d == 0:
            return "계획대로"
        return f"{abs(d)}회 {'앞섬' if d > 0 else '지연'}"

    def summary(self) -> str:
        return (f"{self.student} · {self.book} · "
                f"{self.done_sessions}/{self.planned_total}회 · {self.label}")


def progress_status(conn: sqlite3.Connection, key: str, *,
                    weeks_elapsed: float | None = None) -> ProgressStatus:
    """계획 대비 실적을 냅니다.

    `weeks_elapsed` 를 주면 "지금쯤이면 몇 회차여야 하는지" 와 비교합니다.
    안 주면 실적 회차만 셉니다.
    """
    s = get(conn, key)
    if s is None:
        raise KeyError(f"학생을 찾을 수 없습니다: {key}")

    st = ProgressStatus(student=s.name, book=s.book_label)
    book = s.to_book_ref()
    if book is None:
        st.warnings.append("교재가 지정되지 않아 계획을 세울 수 없습니다")
        return st

    from .syllabus import build_plan, load_syllabus

    syl = load_syllabus(book)
    if not len(syl):
        st.warnings.extend(syl.warnings or ["교재 목차를 읽지 못했습니다"])
        return st

    plan = build_plan(syl, pace=s.pace, per_week=s.per_week)
    st.planned_total = plan.total_sessions

    # 회차 수는 '완료' 든 '부분' 이든 **수업을 한 횟수**라 둘 다 셉니다.
    # (아래 `completed_sections` 와 다릅니다 — 그쪽은 계획에서 뺄 것을 고르는
    #  일이라 '부분' 을 빼면 나머지를 영영 안 나갑니다.)
    st.done_sessions = conn.execute(
        "SELECT COUNT(*) FROM progress_log WHERE student_key=? "
        "AND status IN ('완료','부분')", (key,)).fetchone()[0]

    if weeks_elapsed is not None:
        st.expected_sessions = min(plan.total_sessions,
                                   round(weeks_elapsed * s.per_week))
    return st


# ─────────────────────────────────────────────────────────────
# 진도 — 계획에서 뺄 것과 세기만 할 것을 가릅니다
# ─────────────────────────────────────────────────────────────
"""
한때 두 질문에 **같은 답**을 쓰고 있었습니다.

    "수업을 몇 회 했나"          → status IN ('완료','부분')   ← 맞음
    "계획에서 무엇을 뺄까"        → status IN ('완료','부분')   ← 틀림

두 번째가 버그였습니다. `build_plan(done_sections=...)` 에 '부분' 이 넘어가서
**절반만 나간 소단원이 남은 계획에서 통째로 빠졌습니다.** 나머지 절반을
영영 안 나가게 됩니다 — 이 프로젝트가 정의한 실패 그 자체입니다.

이제 갈라 놓습니다.
    `completed_sections`  계획에서 뺄 것.  '완료' 만.
    `partial_sections`    아직 안 끝난 것. **계획에 남아야** 하고, 이왕이면
                          먼저 마저 나가야 합니다.
"""


def completed_sections(conn: sqlite3.Connection, key: str) -> set[str]:
    """계획에서 **빼도 되는** 소단원. `'완료'` 만입니다.

    `'부분'` 을 여기 넣으면 안 됩니다. 반만 나간 것을 뺐다가는 나머지를
    영영 안 나갑니다.
    """
    return {r["actual_section"] for r in conn.execute(
        "SELECT DISTINCT actual_section FROM progress_log "
        "WHERE student_key=? AND status='완료' AND actual_section!=''", (key,))}


def partial_sections(conn: sqlite3.Connection, key: str) -> list[str]:
    """아직 안 끝난 소단원. **계획에 남아 있어야 합니다.**

    최근에 하던 것부터 돌려줍니다 — 마저 끝내는 것이 새 단원을 시작하는
    것보다 먼저입니다.
    """
    seen: list[str] = []
    for r in conn.execute(
            "SELECT actual_section FROM progress_log WHERE student_key=? "
            "AND status='부분' AND actual_section!='' ORDER BY date DESC", (key,)):
        if r["actual_section"] not in seen:
            seen.append(r["actual_section"])
    done = completed_sections(conn, key)
    return [s for s in seen if s not in done]


def unjudged_sections(conn: sqlite3.Connection, key: str) -> list[str]:
    """완료 기준이 없어 판정하지 못한 것.

    비어 있지 않으면 선생님이 아직 "완료가 무엇인지" 를 정하지 않은 것입니다.
    이것들은 계획에서 빠지지 않으므로 누락은 안 나지만, 계속 다시 나오게 됩니다.
    """
    seen: list[str] = []
    for r in conn.execute(
            "SELECT actual_section FROM progress_log WHERE student_key=? "
            "AND (status IS NULL OR status='') AND actual_section!='' "
            "ORDER BY date DESC", (key,)):
        if r["actual_section"] not in seen:
            seen.append(r["actual_section"])
    return seen
