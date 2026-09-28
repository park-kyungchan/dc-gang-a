# -*- coding: utf-8 -*-
"""
교육적 판단 기준 — 정답이 강사의 선택에 달린 것들.

배경 (사용자, 2026-08-20)
    "이등변삼각형의 뜻과 성질은 결국에는 동치인 것을 알고 있나? 동치명제 중에
     어떠한 것을 정의로 사용할 것인지에 대해서는, 강사가 학생 상태에 따라
     결정할 수 있다."

    외부 제안서의 `distinction_def_vs_prop: bool` 은 "정답이 절대적" 이라고
    전제한 모델링이라 기각했습니다(원장 P-07). 무엇이 정의인지가 학생마다
    다르므로 불리언으로는 표현할 수 없습니다.

이 파일이 지키는 규율
    **판정 기준이 강사의 선택에 달린 항목은, 선택을 먼저 기록하고 나서
    판정한다. 선택이 없으면 판정하지 않는다.**
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from conftest import needs_pdf  # noqa: E402

from ganga import students as S  # noqa: E402
from ganga.pedagogy import (  # noqa: E402
    EVIDENCE_KINDS,
    KNOWN_EQUIVALENCES,
    NOTE_DEFECTS,
    ConceptEvaluation,
    ConventionMissing,
    convention_history,
    get_convention,
    judge_mastery,
    log_mastery,
    set_convention,
)

ISO = "이등변삼각형"
A = "두 변의 길이가 같다"
B = "두 밑각의 크기가 같다"


@pytest.fixture
def db(tmp_path):
    conn = S.connect(tmp_path / "s.db")
    S.register(conn, login_id="gildong01", name="홍길동")
    yield conn
    conn.close()


# ─────────────────────────────────────────────────────────────
# 관례가 없으면 판정하지 않는다 — 이 파일의 핵심
# ─────────────────────────────────────────────────────────────
def test_관례를_안_정하면_판정을_거부한다(db):
    """무엇이 정의인지 모르면 '순환논법인가' 를 판정할 근거가 없습니다."""
    with pytest.raises(ConventionMissing) as e:
        log_mastery(db, "gildong01", concept_key=ISO,
                    ev=ConceptEvaluation(equivalence_known=True))
    assert "정의로 잡을지" in str(e.value)


def test_관례를_정하면_판정할_수_있다(db):
    set_convention(db, "gildong01", concept_key=ISO, definition=A,
                   set_by="박경찬")
    r = log_mastery(db, "gildong01", concept_key=ISO,
                    ev=ConceptEvaluation(equivalence_known=True,
                                         derived_from_def=True, circular=False,
                                         converse_proved=True,
                                         logical_chain_ok=True,
                                         math_translation_ok=True))
    assert r["mastery_level"] == "FULLY_MASTERED"


def test_관례가_없으면_None을_돌려준다(db):
    assert get_convention(db, "gildong01", ISO) is None


# ─────────────────────────────────────────────────────────────
# 학생×개념 단위 — 학생마다, 개념마다 다를 수 있다
# ─────────────────────────────────────────────────────────────
def test_학생마다_다른_정의를_잡을_수_있다(db):
    S.register(db, login_id="chulsoo02", name="김철수")
    set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="박경찬")
    set_convention(db, "chulsoo02", concept_key=ISO, definition=B, set_by="박경찬",
                   reason="선행 학생이라 성질에서 출발")

    assert get_convention(db, "gildong01", ISO).definition == A
    assert get_convention(db, "chulsoo02", ISO).definition == B


def test_한_학생도_개념마다_다를_수_있다(db):
    set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="박경찬")
    set_convention(db, "gildong01", concept_key="평행사변형",
                   definition="두 쌍의 대변이 각각 평행하다",
                   others=["두 쌍의 대변의 길이가 각각 같다"], set_by="박경찬")

    assert get_convention(db, "gildong01", ISO).definition == A
    assert "평행" in get_convention(db, "gildong01", "평행사변형").definition


# ─────────────────────────────────────────────────────────────
# 관례를 바꿔도 과거 판정을 소급하지 않는다
# ─────────────────────────────────────────────────────────────
def test_관례를_바꾸면_옛것은_종료표시만_된다(db):
    """덮어쓰면 **바꾸기 전 판정들이 거짓말이 됩니다.**

    옛 판정은 옛 관례 아래에서 내려진 것입니다. 소급하면
    "그때는 순환논법이 아니었는데 지금 보니 순환논법" 이 됩니다.
    """
    first = set_convention(db, "gildong01", concept_key=ISO, definition=A,
                           set_by="박경찬", on="2026-03-01")
    second = set_convention(db, "gildong01", concept_key=ISO, definition=B,
                            set_by="박경찬", on="2026-06-01",
                            reason="역을 스스로 증명해서 출발점을 바꿈")

    hist = convention_history(db, "gildong01", ISO)
    assert len(hist) == 2
    assert hist[0].superseded_on == "2026-06-01"
    assert not hist[0].is_current
    assert hist[1].is_current
    assert second.id != first.id


def test_판정은_그때의_관례에_묶인다(db):
    set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="박경찬",
                   on="2026-03-01")
    r1 = log_mastery(db, "gildong01", concept_key=ISO, date="2026-03-10",
                     ev=ConceptEvaluation(equivalence_known=True))
    set_convention(db, "gildong01", concept_key=ISO, definition=B, set_by="박경찬",
                   on="2026-06-01")
    r2 = log_mastery(db, "gildong01", concept_key=ISO, date="2026-06-10",
                     ev=ConceptEvaluation(equivalence_known=True))

    rows = db.execute(
        "SELECT convention_id FROM concept_mastery_log ORDER BY id").fetchall()
    assert rows[0][0] != rows[1][0], "옛 판정이 새 관례에 묶였습니다"
    assert A in r1["convention"] and B in r2["convention"]


# ─────────────────────────────────────────────────────────────
# 동치 — 알려진 명제를 채워 주되 지어내지 않는다
# ─────────────────────────────────────────────────────────────
def test_알려진_동치명제를_자동으로_채운다(db):
    c = set_convention(db, "gildong01", concept_key=ISO, definition=A,
                       set_by="박경찬")
    assert c.others == [B]
    assert set(c.equivalents) == {A, B}


def test_모르는_개념은_지어내지_않는다(db):
    c = set_convention(db, "gildong01", concept_key="처음보는개념",
                       definition="어떤 성질", set_by="박경찬")
    assert c.others == [], "모르는 개념의 동치명제를 지어냈습니다"


def test_정의로_잡은_것이_나머지에_중복되지_않는다(db):
    c = set_convention(db, "gildong01", concept_key=ISO, definition=A,
                       others=[A, B], set_by="박경찬")
    assert c.others == [B]


def test_무엇이_정의인지_물어볼_수_있다(db):
    c = set_convention(db, "gildong01", concept_key=ISO, definition=A,
                       set_by="박경찬")
    assert c.is_definitional(A)
    assert not c.is_definitional(B), "B 를 정의로 잡지 않았는데 정의라고 합니다"


# ─────────────────────────────────────────────────────────────
# None 은 '확인 안 함' 이지 '못 함' 이 아니다
# ─────────────────────────────────────────────────────────────
def test_확인_안_한_것을_실패로_세지_않는다():
    """DT 의 -1(미입력) vs 0(미실시) 과 같은 구조입니다."""
    ev = ConceptEvaluation()
    assert len(ev.unchecked) == 6
    level, defects = judge_mastery(ev)
    assert level == "PARTIAL", "안 물어본 것이 RETRY 가 되면 안 됩니다"
    assert defects == []


def test_확인_안_한_것이_남으면_완전숙달이_아니다():
    ev = ConceptEvaluation(equivalence_known=True, derived_from_def=True)
    assert judge_mastery(ev)[0] == "PARTIAL"
    assert "circular" in ev.unchecked


def test_전부_확인하고_통과해야_완전숙달():
    ev = ConceptEvaluation(equivalence_known=True, converse_proved=True,
                           derived_from_def=True, circular=False,
                           logical_chain_ok=True, math_translation_ok=True)
    assert ev.unchecked == []
    assert judge_mastery(ev)[0] == "FULLY_MASTERED"


# ─────────────────────────────────────────────────────────────
# 순환논법은 결함 (사용자 결정 2026-08-20)
# ─────────────────────────────────────────────────────────────
def test_순환논법은_재도전이고_결함으로_남는다():
    """'두 밑각이 같으니 두 변이 같고, 그래서 두 밑각이 같다' 는 증명이 아닙니다."""
    ev = ConceptEvaluation(equivalence_known=True, derived_from_def=True,
                           circular=True, converse_proved=True,
                           logical_chain_ok=True, math_translation_ok=True)
    level, defects = judge_mastery(ev)
    assert level == "RETRY"
    assert "DEFECT_CIRCULAR" in defects


def test_정의에서_유도하지_못하면_재도전():
    ev = ConceptEvaluation(equivalence_known=True, derived_from_def=False,
                           circular=False, converse_proved=True,
                           logical_chain_ok=True, math_translation_ok=True)
    assert judge_mastery(ev)[0] == "RETRY"


def test_동치를_모르면_부분숙달():
    ev = ConceptEvaluation(equivalence_known=False, derived_from_def=True,
                           circular=False, converse_proved=False,
                           logical_chain_ok=True, math_translation_ok=True)
    assert judge_mastery(ev)[0] == "PARTIAL"


# ─────────────────────────────────────────────────────────────
# 확인 방법 — 실제로 쓰는 것만
# ─────────────────────────────────────────────────────────────
def test_확인방법은_사용자가_쓰는_두_가지(db):
    """하브루타에서 말로 묻기 + 역을 증명시키기 (사용자 확인 2026-08-20)."""
    assert set(EVIDENCE_KINDS) == {"havruta", "proved_converse"}


def test_모르는_확인방법은_거부한다(db):
    set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="박경찬")
    with pytest.raises(ValueError, match="확인 방법"):
        log_mastery(db, "gildong01", concept_key=ISO,
                    ev=ConceptEvaluation(equivalence_by=["관상"]))


def test_모르는_결함코드는_거부한다(db):
    set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="박경찬")
    with pytest.raises(ValueError, match="결함 코드"):
        log_mastery(db, "gildong01", concept_key=ISO,
                    ev=ConceptEvaluation(note_defects=["DEFECT_아무거나"]))


def test_기각된_정의성질_결함코드가_없다():
    """P-07 — 정답이 절대적이라고 전제한 항목입니다."""
    assert "DEFECT_CONFUSED_DEF" not in NOTE_DEFECTS
    assert "DEFECT_CIRCULAR" in NOTE_DEFECTS


# ─────────────────────────────────────────────────────────────
# 위생
# ─────────────────────────────────────────────────────────────
def test_정의가_비면_거부한다(db):
    with pytest.raises(ValueError):
        set_convention(db, "gildong01", concept_key=ISO, definition="  ",
                       set_by="박경찬")


def test_누가_정했는지_필요하다(db):
    with pytest.raises(ValueError):
        set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="")


def test_알려진_동치는_실측된_것만_담는다():
    """모르는 것을 목록에 채워 넣지 않습니다 (규칙 1-6)."""
    assert set(KNOWN_EQUIVALENCES) == {ISO}
    assert set(KNOWN_EQUIVALENCES[ISO]) == {A, B}


def test_결과에_안_물어본_항목이_드러난다(db):
    set_convention(db, "gildong01", concept_key=ISO, definition=A, set_by="박경찬")
    r = log_mastery(db, "gildong01", concept_key=ISO,
                    ev=ConceptEvaluation(equivalence_known=True))
    assert r["unchecked"], "무엇을 안 물어봤는지 알려주지 않습니다"
    assert "circular" in r["unchecked"]


# ═════════════════════════════════════════════════════════════
# "진도를 나갔다" 의 기준 — 완료란 무엇인가
# ═════════════════════════════════════════════════════════════
"""
`PROGRESS_STATUS` 에 '완료' 가 있었지만 **완료가 무엇인지는 없었습니다.**
그래서 코드가 `status IN ('완료','부분')` 으로 둘을 같이 셌고,
`build_plan(done_sections=...)` 에 '부분' 까지 넘어가 **절반만 나간 소단원이
남은 계획에서 통째로 빠졌습니다.** 나머지를 영영 안 나가게 됩니다.
"""
from ganga.pedagogy import (  # noqa: E402
    COVERAGE_LEVELS,
    CompletionStandard,
    get_completion_standard,
    judge_progress,
    level_rank,
    set_completion_standard,
)

SEC = "이등변삼각형의 성질"


# ─────────────────────────────────────────────────────────────
# 부분은 계획에서 빠지면 안 된다 — 이 절의 핵심
# ─────────────────────────────────────────────────────────────
def test_부분은_계획에서_빠지지_않는다(db):
    """한때 '완료' 와 같이 세어 계획에서 빠졌습니다. 그게 누락의 경로였습니다."""
    set_completion_standard(db, "gildong01", min_level="PRACTICED",
                            set_by="박경찬")
    S.log_progress(db, "gildong01", date="2026-08-25", session_no=1,
                   actual=SEC, reached="EXPLAINED")     # 설명만 함 → 부분

    assert S.completed_sections(db, "gildong01") == set(), \
        "반만 나간 소단원이 '완료' 로 잡혔습니다"
    assert SEC in S.partial_sections(db, "gildong01")


def test_기준을_채우면_완료가_된다(db):
    set_completion_standard(db, "gildong01", min_level="PRACTICED",
                            set_by="박경찬")
    S.log_progress(db, "gildong01", date="2026-08-25", session_no=1,
                   actual=SEC, reached="PRACTICED")

    assert S.completed_sections(db, "gildong01") == {SEC}
    assert S.partial_sections(db, "gildong01") == []


def test_마저_끝내면_부분에서_빠진다(db):
    set_completion_standard(db, "gildong01", min_level="PRACTICED",
                            set_by="박경찬")
    S.log_progress(db, "gildong01", date="2026-08-25", session_no=1,
                   actual=SEC, reached="EXPLAINED")
    S.log_progress(db, "gildong01", date="2026-08-27", session_no=2,
                   actual=SEC, reached="PRACTICED")

    assert S.completed_sections(db, "gildong01") == {SEC}
    assert S.partial_sections(db, "gildong01") == [], \
        "완료됐는데 아직 '안 끝난 것' 으로 남아 있습니다"


# ─────────────────────────────────────────────────────────────
# 기준이 없으면 '완료' 라고 단정하지 않는다
# ─────────────────────────────────────────────────────────────
def test_기준이_없으면_완료로_치지_않는다(db):
    """빠뜨리는 대신 **중복하는 쪽**으로 틀립니다."""
    S.log_progress(db, "gildong01", date="2026-08-25", session_no=1,
                   actual=SEC, reached="REPRODUCED")

    assert S.completed_sections(db, "gildong01") == set()
    assert SEC in S.unjudged_sections(db, "gildong01"), \
        "판정 못 한 것이 드러나지 않습니다"


@needs_pdf
def test_판정하지_못한_것이_초안에_경고로_뜬다(db):
    from ganga.pipeline.draft import build_context

    S.register(db, login_id="gildong01", name="홍길동",
               book_grade="중2", book_level="가우스", book_term=2, book_volume=3)
    S.log_progress(db, "gildong01", date="2026-08-25", session_no=1,
                   actual=SEC, reached="PRACTICED")
    _, blockers = build_context(db, "gildong01", date="2026-08-27", session_no=2)
    assert any("완료 기준" in b for b in blockers), blockers


def test_judge_progress는_기준_없으면_None():
    assert judge_progress("PRACTICED", None) is None
    assert judge_progress("NOT_STARTED", None) == "미실시", \
        "미실시는 기준 없이도 판정할 수 있습니다"


# ─────────────────────────────────────────────────────────────
# 기준은 학생마다·개념마다 다를 수 있다
# ─────────────────────────────────────────────────────────────
def test_학생마다_다른_기준을_잡을_수_있다(db):
    S.register(db, login_id="chulsoo02", name="김철수")
    set_completion_standard(db, "gildong01", min_level="PRACTICED",
                            set_by="박경찬", reason="처음 배우는 학생")
    set_completion_standard(db, "chulsoo02", min_level="REPRODUCED",
                            set_by="박경찬", reason="선행 학생이라 더 요구")

    assert get_completion_standard(db, "gildong01").min_level == "PRACTICED"
    assert get_completion_standard(db, "chulsoo02").min_level == "REPRODUCED"


def test_개념별_기준이_전체기본을_덮어쓴다(db):
    set_completion_standard(db, "gildong01", min_level="EXPLAINED",
                            set_by="박경찬")
    set_completion_standard(db, "gildong01", scope="증명", min_level="REPRODUCED",
                            set_by="박경찬", reason="증명은 스스로 해야 함")

    assert get_completion_standard(db, "gildong01").min_level == "EXPLAINED"
    assert get_completion_standard(db, "gildong01", scope="증명"
                                   ).min_level == "REPRODUCED"


def test_개념별_기준이_없으면_전체기본으로_떨어진다(db):
    set_completion_standard(db, "gildong01", min_level="PRACTICED",
                            set_by="박경찬")
    assert get_completion_standard(db, "gildong01", scope="아무개념"
                                   ).min_level == "PRACTICED"


def test_기준을_바꿔도_옛것은_종료표시만(db):
    set_completion_standard(db, "gildong01", min_level="EXPLAINED",
                            set_by="박경찬", on="2026-03-01")
    set_completion_standard(db, "gildong01", min_level="REPRODUCED",
                            set_by="박경찬", on="2026-06-01")
    rows = db.execute(
        "SELECT min_level, superseded_on FROM completion_standard "
        "WHERE student_key='gildong01' ORDER BY id").fetchall()
    assert len(rows) == 2
    assert rows[0]["superseded_on"] == "2026-06-01"
    assert rows[1]["superseded_on"] is None


# ─────────────────────────────────────────────────────────────
# 수준의 서열
# ─────────────────────────────────────────────────────────────
def test_수준에_서열이_있다():
    assert level_rank("NOT_STARTED") < level_rank("EXPLAINED")
    assert level_rank("EXPLAINED") < level_rank("PRACTICED")
    assert level_rank("PRACTICED") < level_rank("REPRODUCED")


def test_모르는_수준은_가장_약하게_본다():
    """안전한 방향입니다 — 모르는 값이 '완료' 를 통과하면 안 됩니다."""
    assert level_rank("무슨수준") == 0
    std = CompletionStandard(id=1, student_key="x", scope="",
                             min_level="EXPLAINED")
    assert not std.meets("무슨수준")


def test_미실시를_완료기준으로_삼을_수_없다(db):
    with pytest.raises(ValueError, match="미실시"):
        set_completion_standard(db, "gildong01", min_level="NOT_STARTED",
                                set_by="박경찬")


def test_모르는_수준은_거부한다(db):
    with pytest.raises(ValueError):
        set_completion_standard(db, "gildong01", min_level="아무거나",
                                set_by="박경찬")
    with pytest.raises(ValueError):
        S.log_progress(db, "gildong01", date="2026-08-25", reached="아무거나")


def test_수준_목록이_네_단계(db):
    assert COVERAGE_LEVELS == ("NOT_STARTED", "EXPLAINED", "PRACTICED",
                               "REPRODUCED")


# ─────────────────────────────────────────────────────────────
# 하위호환 — 기존 호출은 그대로 동작
# ─────────────────────────────────────────────────────────────
def test_예전처럼_status만_줘도_된다(db):
    S.log_progress(db, "gildong01", date="2026-08-25", session_no=1,
                   status="완료", actual=SEC)
    assert S.completed_sections(db, "gildong01") == {SEC}


def test_status도_reached도_없으면_거부(db):
    with pytest.raises(ValueError, match="status 또는 reached"):
        S.log_progress(db, "gildong01", date="2026-08-25")


def test_기존_DB에_컬럼을_붙인다(tmp_path):
    """`CREATE TABLE IF NOT EXISTS` 는 기존 표에 컬럼을 안 붙입니다.

    선생님 PC 에는 이미 DB 가 있으므로, 이 경로가 없으면 다음 실행에서
    바로 깨집니다. 실제로 한 번 깨졌습니다.
    """
    import sqlite3 as sq

    p = tmp_path / "old.db"
    old = sq.connect(p)
    old.executescript("""
        CREATE TABLE students (student_key TEXT PRIMARY KEY, login_id TEXT,
                               name TEXT);
        CREATE TABLE progress_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_key TEXT NOT NULL, date TEXT NOT NULL, session_no INTEGER,
            planned_section TEXT, actual_section TEXT, status TEXT NOT NULL,
            note TEXT, UNIQUE(student_key, date, session_no));
        INSERT INTO students VALUES ('old01','old01','옛학생');
        INSERT INTO progress_log (student_key, date, session_no, actual_section,
                                  status) VALUES ('old01','2026-01-01',1,'옛진도','완료');
    """)
    old.commit()
    old.close()

    conn = S.connect(p)
    try:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(progress_log)")}
        assert "reached_level" in cols
        # 기존 데이터가 살아 있어야 합니다
        assert conn.execute("SELECT COUNT(*) FROM progress_log").fetchone()[0] == 1
        assert S.completed_sections(conn, "old01") == {"옛진도"}
        # 그리고 새 컬럼을 쓰는 기록이 바로 들어가야 합니다
        S.log_progress(conn, "old01", date="2026-08-25", session_no=2,
                       actual="새진도", reached="PRACTICED")
    finally:
        conn.close()
