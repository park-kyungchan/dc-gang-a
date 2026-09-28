# -*- coding: utf-8 -*-
"""
학생 DB 테스트.

가장 중요한 것: **LMS 가 정본인 필드와 이 DB 가 정본인 필드가 섞이지 않는가.**
동기화가 선생님이 쓴 메모를 덮어쓰면 그건 데이터 손실입니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import needs_git  # noqa: E402

from conftest import needs_pdf  # noqa: E402

from ganga.students import (  # noqa: E402
    ERROR_TAGS,
    REGISTRATION_FIELDS,
    Student,
    add_observation,
    connect,
    error_profile,
    get,
    list_students,
    log_error,
    log_progress,
    observations,
    progress_status,
    register,
    sync_from_lms,
)


@pytest.fixture
def db(tmp_path):
    conn = connect(tmp_path / "students.db")
    yield conn
    conn.close()


class FakeRosterStudent:
    def __init__(self, login_id, name, grade="", homeroom=""):
        self.login_id, self.name = login_id, name
        self.grade, self.homeroom = grade, homeroom


# ─────────────────────────────────────────────────────────────
# 등록
# ─────────────────────────────────────────────────────────────
def test_등록하고_다시_읽는다(db):
    s = register(db, login_id="minjun01", name="김민준",
                 book_grade="중2", book_level="가우스", book_term=2, book_volume=3)
    assert s.name == "김민준"
    assert s.book_label == "중2 2학기 가우스 3권"
    assert get(db, "minjun01").book_level == "가우스"


def test_같은_아이디는_갱신된다(db):
    register(db, login_id="a", name="가", book_grade="초5")
    register(db, login_id="a", name="가", book_grade="중1")
    assert len(list_students(db, active_only=False)) == 1
    assert get(db, "a").book_grade == "중1"


def test_login_id와_name은_필수(db):
    with pytest.raises(ValueError):
        register(db, login_id="", name="가")
    with pytest.raises(ValueError):
        register(db, login_id="a", name="")


def test_모르는_항목은_버리지_않고_extra로_간다(db):
    """'생각나는대로 계속 요청' 에 대비 — 스키마 변경 없이 받아둡니다."""
    s = register(db, login_id="a", name="가", 좋아하는과목="기하", 형제="쌍둥이")
    assert s.extra["좋아하는과목"] == "기하"
    assert get(db, "a").extra["형제"] == "쌍둥이"


def test_등록항목_명세가_비어있지_않다():
    keys = {f["key"] for f in REGISTRATION_FIELDS}
    for must in ("book_grade", "book_level", "pace", "per_week"):
        assert must in keys
    assert all(f.get("label") for f in REGISTRATION_FIELDS)


def test_교재미지정이면_라벨이_그렇게_나온다(db):
    assert register(db, login_id="a", name="가").book_label == "(교재 미지정)"


# ─────────────────────────────────────────────────────────────
# LMS 식별키 — 수업일지 전송 가능 여부
# ─────────────────────────────────────────────────────────────
def test_식별키가_없으면_전송_불가로_표시(db):
    s = register(db, login_id="a", name="가")
    assert not s.can_write_to_lms
    assert set(s.missing_keys()) == {"stu_pri_no", "course_seq", "cm_seq"}


def test_식별키가_다_있으면_전송_가능(db):
    s = register(db, login_id="a", name="가",
                 stu_pri_no="98765", course_seq="12345", cm_seq="11223")
    assert s.can_write_to_lms
    assert s.missing_keys() == []


def test_일부만_있으면_여전히_불가(db):
    s = register(db, login_id="a", name="가", stu_pri_no="98765")
    assert not s.can_write_to_lms
    assert "course_seq" in s.missing_keys()


# ─────────────────────────────────────────────────────────────
# 동기화 — 경계가 지켜지는가 (가장 중요)
# ─────────────────────────────────────────────────────────────
def test_동기화가_내가_쓴_등록정보를_덮어쓰지_않는다(db):
    """LMS 명단을 다시 읽었다고 교재·메모가 날아가면 데이터 손실입니다."""
    register(db, login_id="a", name="가", book_grade="중2", book_level="가우스",
             weaknesses="서술형 근거 부족", pace="특수")
    sync_from_lms(db, [FakeRosterStudent("a", "가", "중2", "박경찬")])

    s = get(db, "a")
    assert s.book_grade == "중2", "교재가 날아갔습니다"
    assert s.weaknesses == "서술형 근거 부족", "약점 메모가 날아갔습니다"
    assert s.pace == "특수"
    assert s.homeroom == "박경찬", "LMS 필드는 갱신돼야 합니다"


def test_동기화가_새_학생을_추가한다(db):
    r = sync_from_lms(db, [FakeRosterStudent("a", "가"), FakeRosterStudent("b", "나")])
    assert r == {"added": 2, "updated": 0}
    assert len(list_students(db)) == 2


def test_두번_동기화하면_추가가_아니라_갱신(db):
    sync_from_lms(db, [FakeRosterStudent("a", "가")])
    r = sync_from_lms(db, [FakeRosterStudent("a", "가")])
    assert r == {"added": 0, "updated": 1}


def test_login_id가_없는_행은_건너뛴다(db):
    r = sync_from_lms(db, [FakeRosterStudent("", "무명")])
    assert r["added"] == 0


def test_등록된_학생만_추리기(db):
    sync_from_lms(db, [FakeRosterStudent("a", "가"), FakeRosterStudent("b", "나")])
    register(db, login_id="a", name="가", book_grade="중2", book_level="가우스")
    assert len(list_students(db, registered_only=True)) == 1


# ─────────────────────────────────────────────────────────────
# 관찰 메모
# ─────────────────────────────────────────────────────────────
def test_관찰메모는_200자_제한이_없다(db):
    """서버 메모는 200자지만 이 DB 는 강사 소유라 제한이 없습니다."""
    register(db, login_id="a", name="가")
    long_text = "관찰" * 500
    add_observation(db, "a", long_text)
    assert len(observations(db, "a")[0]["text"]) == len(long_text)


def test_빈_메모는_저장하지_않는다(db):
    register(db, login_id="a", name="가")
    with pytest.raises(ValueError):
        add_observation(db, "a", "   ")


def test_메모에_태그를_붙인다(db):
    register(db, login_id="a", name="가")
    add_observation(db, "a", "약분 원리를 스스로 설명", tags=["개념이해", "칭찬"])
    assert observations(db, "a")[0]["tags"] == ["개념이해", "칭찬"]


def test_최신순으로_나온다(db):
    register(db, login_id="a", name="가")
    add_observation(db, "a", "먼저", date="2026-08-01")
    add_observation(db, "a", "나중", date="2026-08-20")
    assert observations(db, "a")[0]["text"] == "나중"


# ─────────────────────────────────────────────────────────────
# 오답 유형
# ─────────────────────────────────────────────────────────────
def test_오답유형_누적과_분포(db):
    register(db, login_id="a", name="가")
    for t in ("계산실수", "계산실수", "개념부족"):
        log_error(db, "a", tag=t)
    p = error_profile(db, "a")
    assert p["total"] == 3
    assert p["by_tag"]["계산실수"] == 2
    assert p["dominant"] == "계산실수"


def test_정의되지_않은_오답유형은_거부(db):
    register(db, login_id="a", name="가")
    with pytest.raises(ValueError):
        log_error(db, "a", tag="아무거나")


def test_오답을_문항인덱스와_연결한다(db):
    register(db, login_id="a", name="가")
    log_error(db, "a", tag="개념부족", lecture_key="1319771", problem_ref="p.31 5번")
    rows = db.execute("SELECT * FROM error_log WHERE student_key='a'").fetchall()
    assert rows[0]["lecture_key"] == "1319771"


def test_기록이_없으면_dominant는_None(db):
    register(db, login_id="a", name="가")
    assert error_profile(db, "a")["dominant"] is None


# ─────────────────────────────────────────────────────────────
# 진도 실적
# ─────────────────────────────────────────────────────────────
def test_진도기록과_상태검증(db):
    register(db, login_id="a", name="가")
    log_progress(db, "a", date="2026-08-20", status="완료", session_no=1,
                 planned="1-1", actual="1-1")
    with pytest.raises(ValueError):
        log_progress(db, "a", date="2026-08-21", status="이상한상태")


def test_같은_회차를_다시_기록하면_갱신(db):
    register(db, login_id="a", name="가")
    log_progress(db, "a", date="2026-08-20", session_no=1, status="부분")
    log_progress(db, "a", date="2026-08-20", session_no=1, status="완료")
    rows = db.execute("SELECT * FROM progress_log WHERE student_key='a'").fetchall()
    assert len(rows) == 1 and rows[0]["status"] == "완료"


def test_교재가_없으면_계획을_못세운다고_말한다(db):
    register(db, login_id="a", name="가")
    st = progress_status(db, "a")
    assert st.planned_total == 0
    assert any("교재" in w for w in st.warnings)


def test_없는_학생은_예외(db):
    with pytest.raises(KeyError):
        progress_status(db, "nobody")


def test_미실시는_진도로_세지_않는다(db):
    register(db, login_id="a", name="가")
    log_progress(db, "a", date="2026-08-20", session_no=1, status="완료")
    log_progress(db, "a", date="2026-08-22", session_no=2, status="미실시")
    n = db.execute(
        "SELECT COUNT(*) FROM progress_log WHERE student_key='a' "
        "AND status IN ('완료','부분')").fetchone()[0]
    assert n == 1


def test_학생을_지우면_기록도_따라_지워진다(db):
    register(db, login_id="a", name="가")
    add_observation(db, "a", "메모")
    log_error(db, "a", tag="계산실수")
    with db:
        db.execute("DELETE FROM students WHERE student_key='a'")
    assert db.execute("SELECT COUNT(*) FROM observations").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM error_log").fetchone()[0] == 0


# ─────────────────────────────────────────────────────────────
# 개인정보
# ─────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────
# 경계 위반 회귀 — 실제로 터진 버그들
# ─────────────────────────────────────────────────────────────
def test_등록이_LMS에서_받은_학년담당을_지우지_않는다(db):
    """실제로 터진 버그: 동기화로 학년·담당을 받아온 뒤 등록하니
    '홍길동 (gildong01) · · 담당 ' 처럼 비어버렸습니다.
    동기화→등록 방향도 등록→동기화 방향만큼 지켜야 합니다."""
    sync_from_lms(db, [FakeRosterStudent("a", "홍길동", "중1", "박경찬")])
    register(db, login_id="a", name="홍길동", book_grade="중2", book_level="가우스")

    s = get(db, "a")
    assert s.grade == "중1", "LMS 에서 받은 학년이 등록으로 지워졌습니다"
    assert s.homeroom == "박경찬", "담당 강사가 등록으로 지워졌습니다"
    assert s.book_grade == "중2"


def test_등록에서_학년을_명시하면_반영된다(db):
    sync_from_lms(db, [FakeRosterStudent("a", "가", "중1", "박경찬")])
    register(db, login_id="a", name="가", grade="중2")
    assert get(db, "a").grade == "중2"


@needs_pdf
def test_비교기준이_없으면_앞섬이라고_말하지_않는다(db):
    """실제로 터진 버그: weeks_elapsed 를 안 줬는데 '2회 앞섬' 이라고 보고했습니다.
    기준 없이 0 과 비교한 결과였습니다."""
    register(db, login_id="a", name="가", book_grade="중2", book_level="가우스",
             book_term=2, book_volume=3)
    log_progress(db, "a", date="2026-08-20", session_no=1, status="완료")
    log_progress(db, "a", date="2026-08-22", session_no=2, status="완료")

    st = progress_status(db, "a")          # weeks_elapsed 없음
    assert st.delta is None
    assert "앞섬" not in st.label
    assert "미산출" in st.label


@needs_pdf
def test_경과주수를_주면_비교한다(db):
    register(db, login_id="a", name="가", book_grade="중2", book_level="가우스",
             book_term=2, book_volume=3, per_week=2)
    for i in (1, 2, 3, 4):
        log_progress(db, "a", date=f"2026-08-{10+i}", session_no=i, status="완료")

    ahead = progress_status(db, "a", weeks_elapsed=1)   # 기대 2회, 실적 4회
    assert ahead.delta == 2 and "앞섬" in ahead.label

    behind = progress_status(db, "a", weeks_elapsed=5)  # 기대 10회, 실적 4회
    assert behind.delta == -6 and "지연" in behind.label


@needs_pdf
def test_기대회차는_총계획을_넘지_않는다(db):
    register(db, login_id="a", name="가", book_grade="중2", book_level="가우스",
             book_term=2, book_volume=3, per_week=2)
    st = progress_status(db, "a", weeks_elapsed=999)
    assert st.expected_sessions == st.planned_total
