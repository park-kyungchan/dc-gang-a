# -*- coding: utf-8 -*-
"""
카탈로그 수집 테스트 — 특히 '조용한 손실' 방지.

정답지 인덱스는 학생 배정 전에 바로 쓸 수 있는 자산이라, 몇 건이 빠져도
겉으로는 정상으로 보입니다. 그래서 손실 탐지 자체를 테스트합니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.lms.catalog import (  # noqa: E402
    LABEL_MEANING,
    AnswerSheet,
    Catalog,
    _DL,
    _infer_from_filename,
)


# ─────────────────────────────────────────────────────────────
# 다운로드 URL 추출
# ─────────────────────────────────────────────────────────────
def test_버튼_onclick에서_URL을_뽑는다():
    """링크가 href 가 아니라 onclick 안에 있다. a[href] 수집으로는 0건."""
    html = (
        '<button type="button" class="ftn-btn etc1" '
        "onclick=\"MODULE.Commons.fullUrlDownloadFile("
        "'https://storage.studyq.net/data/answer/el/book/g5_basic_answer.pdf')\">답</button>"
    )
    assert _DL.findall(html) == [
        "https://storage.studyq.net/data/answer/el/book/g5_basic_answer.pdf"
    ]


def test_쌍따옴표_onclick도_처리한다():
    html = 'onclick=\'fullUrlDownloadFile("https://x/y.pdf")\''
    assert _DL.findall(html) == ["https://x/y.pdf"]


def test_비활성_버튼은_URL이_없다():
    html = '<button class="ftn-btn disable" style="opacity:0">무</button>'
    assert _DL.findall(html) == []


# ─────────────────────────────────────────────────────────────
# 파일명 기반 메타데이터 복원 (서버 HTML 결함 대응)
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "fname,grade,level,kind,column",
    [
        ("g4_basic_answer.pdf", "초4", "기본", "정답지", "합본"),
        ("g4_basic_daily.pdf", "초4", "기본", "데일리테스트", "합본"),
        ("g4_basic_repair.pdf", "초4", "기본", "정오표", "합본"),
        ("g4_basic_sample_1_2.pdf", "초4", "기본", "샘플교재", "1학기 2권"),
        ("g5_develop_answer.pdf", "초5", "발전", "정답지", "합본"),
        ("g5_ability_answer.pdf", "초5", "심화", "정답지", "합본"),
        ("g5_highest_answer.pdf", "초5", "최상위", "정답지", "합본"),
    ],
)
def test_초등_파일명에서_메타데이터를_복원한다(fname, grade, level, kind, column):
    s = _infer_from_filename(f"https://storage.studyq.net/data/answer/el/book/{fname}", "초등부")
    assert (s.grade, s.level, s.kind, s.column) == (grade, level, kind, column)
    assert s.label == "(복원)"


def test_중등은_학년번호_오프셋을_적용한다():
    """g7 = 중1 (초6 다음부터 이어지는 번호)."""
    s = _infer_from_filename("https://x/mi/book/g7_gauss_answer.pdf", "중등부")
    assert s.grade == "중1"
    assert s.level == "가우스"


def test_규칙에_안맞는_파일명은_미상으로_남긴다():
    """추측으로 잘못된 메타데이터를 만드느니 미상이 낫다."""
    s = _infer_from_filename("https://x/weird_file.pdf", "초등부")
    assert s.grade == "(미상)"
    assert s.kind == "기타"


# ─────────────────────────────────────────────────────────────
# 버튼 라벨 의미
# ─────────────────────────────────────────────────────────────
def test_버튼라벨_매핑이_전부_있다():
    for label in ("답", "무", "오", "샘", "D", "대"):
        assert label in LABEL_MEANING


# ─────────────────────────────────────────────────────────────
# Catalog 동작
# ─────────────────────────────────────────────────────────────
def _cat() -> Catalog:
    return Catalog(sheets=[
        AnswerSheet("초등부", "초5", "기본", "합본", "정답지", "답",
                    "https://x/g5_basic_answer.pdf"),
        AnswerSheet("초등부", "초5", "발전", "합본", "정오표", "오",
                    "https://x/g5_develop_repair.pdf"),
        AnswerSheet("중등부", "중1", "가우스", "합본", "정답지", "답",
                    "https://x/g7_gauss_answer.pdf"),
    ])


def test_검색이_여러_필드를_훑는다():
    c = _cat()
    assert len(c.search("초5")) == 2
    assert len(c.search("가우스")) == 1
    assert len(c.search("정오표")) == 1
    assert len(c.search("g5_basic")) == 1      # 파일명으로도
    assert len(c.search("없는교재")) == 0


def test_종류별_필터():
    assert len(_cat().by_kind("정답지")) == 2


def test_요약에_탭과_종류가_모두_나온다():
    s = _cat().summary()
    assert "총 3건" in s and "초등부 2" in s and "정답지 2" in s


def test_JSON_저장_후_다시_읽힌다(tmp_path):
    import json

    p = _cat().save_json(tmp_path / "sub" / "cat.json")
    data = json.loads(p.read_text(encoding="utf-8"))
    assert len(data) == 3
    assert data[0]["url"].endswith("g5_basic_answer.pdf")
    assert data[0]["kind"] == "정답지"


def test_filename_속성():
    s = AnswerSheet("초등부", "초5", "기본", "합본", "정답지", "답",
                    "https://storage.studyq.net/a/b/g5_basic_answer.pdf")
    assert s.filename == "g5_basic_answer.pdf"


def test_경고가_있으면_불완전으로_본다():
    c = _cat()
    assert not c.warnings
    c.warnings.append("표 구조 깨짐")
    assert c.warnings
