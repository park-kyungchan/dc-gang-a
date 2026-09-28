# -*- coding: utf-8 -*-
"""
원자 단위 스키마 테스트 — **LLM 이 채울 수 있는 칸을 좁혔는가.**

여기서 고정하는 계약 세 가지

    1. 재료가 없으면 그 부분이 문장에서 **통째로 빠진다.** 추측해서 채우지 않는다.
       (없는 쪽수 'p.999' 가 학부모 리포트로 나가는 것이 이 프로젝트의 최악입니다.)
    2. `format()` 은 **어떤 경우에도 자르지 않는다.**
       실측(P-02): 250자를 보내면 서버는 250자를 그대로 저장합니다. 200자는
       화면 JS 의 검사일 뿐이고, 사용자 결정(2026-08-20)으로 길이 제한도 없습니다.
    3. EUC-KR 에 없는 수학기호가 **살아남는다.**
       실측(P-01): 이 LMS 는 UTF-8 이라 '𝑥 ⟂ ℝ ✔' 가 무손실 왕복합니다.
       바이트 단위로 잘라 담으면 그 문자들이 말없이 사라집니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.lms.endpoints import reallength  # noqa: E402
from ganga.pipeline.completeness import check_row  # noqa: E402
from ganga.pipeline.schema import (  # noqa: E402
    AtomicHomework,
    AtomicMemo,
    AtomicProgress,
)

PROGRESS = dict(
    textbook_name="중2-2 가우스 3권",
    chapter="도형의 성질",
    sub_unit_no=3,
    sub_unit_title="이등변삼각형의 성질",
    page_start=42,
    page_end=47,
    stages_covered=["개념", "기본문제"],
)

HOMEWORK = dict(
    textbook_name="중2-2 가우스 3권",
    page_range="p.48~50",
    problem_scope="1~12번",
    mandatory_tags=["오답노트", "서술형"],
    next_preview="삼각형의 외심",
)

MEMO = dict(
    pre_class_note_feedback="정의를 자기 말로 정리해 옴",
    in_class_reaction="보조선 아이디어를 먼저 제안함",
    solution_habit_coaching="조건을 그림에 표시하고 시작하도록 지도",
)


# ─────────────────────────────────────────────────────────────
# 다 채웠을 때 — 조립은 코드가 결정론적으로 합니다
# ─────────────────────────────────────────────────────────────
def test_진도_한줄():
    assert AtomicProgress(**PROGRESS).format() == (
        "[중2-2 가우스 3권] 도형의 성질 > 3. 이등변삼각형의 성질 "
        "p.42~47 개념·기본문제 진행"
    )


def test_숙제_한줄():
    assert AtomicHomework(**HOMEWORK).format() == (
        "[중2-2 가우스 3권] p.48~50 1~12번 (필수: 오답노트, 서술형) "
        "다음 예고: 삼각형의 외심"
    )


def test_메모_한줄():
    assert AtomicMemo(**MEMO).format() == (
        "예습노트: 정의를 자기 말로 정리해 옴 / "
        "수업반응: 보조선 아이디어를 먼저 제안함 / "
        "풀이습관: 조건을 그림에 표시하고 시작하도록 지도"
    )


def test_다_채우면_빠진_칸이_없다():
    assert AtomicProgress(**PROGRESS).is_complete
    assert AtomicHomework(**HOMEWORK).is_complete
    assert AtomicMemo(**MEMO).is_complete


# ─────────────────────────────────────────────────────────────
# 재료가 없으면 만들지 않는다
# ─────────────────────────────────────────────────────────────
def test_쪽수를_모르면_쪽표기가_통째로_빠진다():
    p = AtomicProgress(**{k: v for k, v in PROGRESS.items()
                          if k not in ("page_start", "page_end")})
    out = p.format()
    assert "p." not in out
    assert "이등변삼각형의 성질" in out          # 아는 것은 그대로 남습니다
    assert p.missing_slots() == ("page_start", "page_end")
    assert p.missing_labels() == ("시작쪽", "끝쪽")
    assert not p.is_complete


def test_모르는_쪽수를_숫자로_지어내지_않는다():
    """빈 칸을 0 이나 1 로 채우면 '1쪽부터 했다'는 없는 사실이 생깁니다."""
    out = AtomicProgress(textbook_name="중2-2 가우스 3권").format()
    assert "0" not in out and "1" not in out


def test_한쪽만_아는_쪽수는_열린_끝으로_드러낸다():
    """'p.42' 로 닫아 쓰면 42쪽만 나간 것으로 읽혀 없는 사실이 생깁니다."""
    assert AtomicProgress(page_start=42).format() == "p.42~ 진행"
    assert AtomicProgress(page_end=47).format() == "~p.47 진행"


def test_시작과_끝이_같으면_한쪽만_쓴다():
    assert AtomicProgress(page_start=42, page_end=42).format() == "p.42 진행"


def test_소단원_제목을_모르면_번호만_남긴다():
    out = AtomicProgress(chapter="도형의 성질", sub_unit_no=3).format()
    assert out == "도형의 성질 > 소단원 3 진행"


def test_재료가_하나도_없으면_빈_문자열():
    """기본값 '진행' 만으로 채워진 척하면 안 됩니다.

    여기서 '진행' 을 돌려주면 완결성 검사가 진도를 '입력됨' 으로 읽어,
    아무것도 안 쓴 칸이 통과합니다. 누락을 놓치는 것이 가장 나쁜 실패입니다.
    """
    assert AtomicProgress().format() == ""
    assert AtomicHomework().format() == ""
    assert AtomicMemo().format() == ""


def test_빈_진도는_완결성_검사에서_누락으로_잡힌다():
    r = check_row({
        "student_name": "김민준", "attendance": "Y", "dt_score": 9,
        "progress_text": AtomicProgress().format(),
        "homework_text": AtomicHomework(**HOMEWORK).format(),
        "daily_memo": AtomicMemo(**MEMO).format(),
    })
    assert "progress_text" in r.missing


def test_메모는_관찰한_칸만_나온다():
    m = AtomicMemo(in_class_reaction="질문이 많았음")
    assert m.format() == "수업반응: 질문이 많았음"
    assert "예습노트" not in m.format()
    assert m.missing_slots() == ("pre_class_note_feedback",
                                 "solution_habit_coaching")


def test_빈_태그는_찌꺼기를_남기지_않는다():
    h = AtomicHomework(page_range="p.48~50", mandatory_tags=["", "   "])
    assert h.format() == "p.48~50"


def test_다음예고는_없어도_되는_칸이다():
    """다음 진도를 모르면서 예고를 지어내면 학부모가 약속으로 읽습니다."""
    h = AtomicHomework(**{k: v for k, v in HOMEWORK.items()
                          if k != "next_preview"})
    assert h.is_complete
    assert "다음 예고" not in h.format()


# ─────────────────────────────────────────────────────────────
# 진도는 계획일 뿐 실적이 아니다
# ─────────────────────────────────────────────────────────────
def test_상태_기본값은_진행이고_완료를_단정하지_않는다():
    p = AtomicProgress(**PROGRESS)
    assert p.status == "진행"
    assert "학습했습니다" not in p.format()
    assert "완료" not in p.format()


# ─────────────────────────────────────────────────────────────
# 자르지 않는다 (P-02) · 수학기호를 지우지 않는다 (P-01)
# ─────────────────────────────────────────────────────────────
def test_길어도_자르지_않는다():
    long_text = "가" * 1000
    m = AtomicMemo(in_class_reaction=long_text)
    out = m.format()
    assert long_text in out
    assert "…" not in out
    assert len(out) == len("수업반응: ") + 1000


def test_수학기호가_살아남는다():
    """EUC-KR 로 담으려 하면 이 문자들이 말없이 사라집니다."""
    sym = "𝑥 ⟂ ℝ ✔ ∠ABC ≡ ∠ACB"
    for made in (AtomicProgress(sub_unit_title=sym).format(),
                 AtomicHomework(problem_scope=sym).format(),
                 AtomicMemo(solution_habit_coaching=sym).format()):
        assert sym in made


def test_display_length_는_화면_JS_와_같은_계산():
    p = AtomicProgress(**PROGRESS)
    assert p.display_length == reallength(p.format())
    # 비ASCII=2, ASCII=1
    assert AtomicMemo(in_class_reaction="ab").display_length == reallength("수업반응: ab")


def test_display_length_는_알려줄_뿐_막지_않는다():
    m = AtomicMemo(in_class_reaction="가" * 500)
    assert m.exceeds_screen_hint is True      # 화면 JS 라면 경고할 길이
    assert len(m.format()) == len("수업반응: ") + 500   # 그래도 온전합니다


def test_기각된_바이트절단을_쓰지_않는다():
    """P-01 은 기각됐습니다. 이 모듈에 되살아나지 않았는지 직접 확인합니다.

    기각된 이름을 이 파일에 그대로 적으면, 원장 검사 범위가 나중에 tests/ 까지
    넓어졌을 때 '구현했다' 로 오독됩니다. 그래서 조각으로 만들어 씁니다.
    """
    src = (Path(__file__).resolve().parents[1]
           / "ganga" / "pipeline" / "schema.py").read_text(encoding="utf-8")
    for bad in ("safe_slice" + "_euckr", "euc" + "_kr_len", "cp949"):
        assert bad not in src
    lowered = src.lower().replace(" ", "").replace('"', "'")
    for bad in ("encode('euc-" + "kr')", "encode('cp" + "949')"):
        assert bad not in lowered


def test_as_dict_는_칸_그대로_돌려준다():
    d = AtomicProgress(**PROGRESS).as_dict()
    assert d["page_start"] == 42 and d["status"] == "진행"
    assert set(PROGRESS) <= set(d)
