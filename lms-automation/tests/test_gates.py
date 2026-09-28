# -*- coding: utf-8 -*-
"""
검증 게이트 테스트.

⚠️ 이 파일이 이전 tests/test_day_record_adversarial.py 와 다른 점:
   이전 테스트는 검증 함수를 **테스트 파일 안에 다시 정의해 놓고** 그것을
   테스트했습니다. 프로덕션 코드(core/day_record_sync.py)는 그 함수를 부르지
   않았으므로, 테스트가 통과해도 실제 전송 경로는 전혀 검증되지 않았습니다.
   여기서는 `ganga.pipeline.gates` 의 실제 함수만 import 해서 씁니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.lms.session import is_authenticated, parse_teacher_info  # noqa: E402
from ganga.lms.writer import WriteStatus, judge_response  # noqa: E402
from ganga.pipeline.gates import (  # noqa: E402
    GateError,
    clamp_int,
    gate_day_record,
    gate_llm_output,
    gate_page_range,
    normalize_text,
)

VALID_KEYS = {
    "course_seq": "12345",
    "stu_pri_no": "98765",
    "record_seq": "54321",
    "cm_seq": "11223",
}


# ─────────────────────────────────────────────────────────────
# 식별키 — 엉뚱한 학생에게 쓰는 사고 방지
# ─────────────────────────────────────────────────────────────
def test_식별키가_비면_전송을_차단한다():
    """이전 구현은 빈 문자열이어도 그대로 전송했다."""
    r = gate_day_record({**VALID_KEYS, "stu_pri_no": "", "progress_text": "p.31 완료"})
    assert not r.ok
    assert any("stu_pri_no" in e for e in r.errors)


def test_식별키가_숫자가_아니면_차단한다():
    r = gate_day_record({**VALID_KEYS, "cm_seq": "'; DROP--", "progress_text": "x" * 10})
    assert not r.ok
    assert any("형식 오류" in e for e in r.errors)


def test_쓸_내용이_없으면_차단한다():
    r = gate_day_record(VALID_KEYS)
    assert not r.ok
    assert any("전송할 필드가 하나도 없" in e for e in r.errors)


def test_정상_페이로드는_통과한다():
    r = gate_day_record({**VALID_KEYS, "progress_text": "5-1 다빈치 2권 p.31 실력쌓기 5~8번"})
    assert r.ok
    assert r.value["progress_text"].startswith("5-1 다빈치")
    assert r.value["stu_pri_no"] == "98765"


# ─────────────────────────────────────────────────────────────
# 점수 클램핑 — 프로덕션 경로에서 실제로 동작하는지
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "raw,expected",
    [(999, 10), (-5, 0), (7, 7), ("3", 3), (10, 10), (0, 0)],
)
def test_DT점수는_0에서_10으로_보정된다(raw, expected):
    r = gate_day_record({**VALID_KEYS, "dt_score": raw})
    assert r.ok
    assert r.value["dt_score"] == expected


@pytest.mark.parametrize("raw,expected", [(99, 5), (-1, 0), (3, 3)])
def test_숙제완성도는_0에서_5로_보정된다(raw, expected):
    r = gate_day_record({**VALID_KEYS, "hw_rate": raw})
    assert r.ok
    assert r.value["hw_rate"] == expected


def test_해석불가_점수는_전송에서_제외된다():
    """이전 구현은 파싱 실패 시 만점(10)으로 기본값을 넣었다 — 위험하다."""
    r = gate_day_record({**VALID_KEYS, "dt_score": "몰라요", "progress_text": "진도 기록"})
    assert "dt_score" not in r.value
    assert any("정수로 해석 불가" in w for w in r.warnings)


# ─────────────────────────────────────────────────────────────
# 텍스트 정규화
# ─────────────────────────────────────────────────────────────
def test_PUA_특수문자를_제거한다():
    """교재 PDF 의 사설영역 수학 폰트가 서버로 새어나가면 깨진다."""
    dirty = "약분과 통분 완료"
    clean, warns = normalize_text(dirty, limit=100, label="진도")
    assert "" not in clean and "" not in clean
    assert any("PUA" in w for w in warns)


def test_제어문자를_제거한다():
    clean, _ = normalize_text("진도\x00기록\x07", limit=100, label="진도")
    assert "\x00" not in clean and "\x07" not in clean


def test_길이초과여도_자르지_않고_알리기만_한다():
    """한때 여기서 잘랐습니다. 서버가 안 자르는데 **우리만** 자르고 있었습니다.

    경고는 붙지만 `ok=True` 로 통과해서, 선생님이 쓴 문장 뒷부분이
    학부모 리포트에서 조용히 사라졌습니다. 성공 기준이 "빠뜨리지 않는 것"
    인데 게이트가 스스로 내용을 빠뜨린 셈입니다.
    """
    clean, warns = normalize_text("가" * 3000, limit=2000, label="메모")
    assert len(clean) == 3000, "잘렸습니다"
    assert clean == "가" * 3000
    assert warns and any("자르지 않고" in w for w in warns)
    assert not any("…" in w for w in warns)


def test_가운데_공백을_뭉치지_않는다():
    """서버가 연속 공백을 보존합니다(실측). 뭉치면 역검증이 실패합니다."""
    clean, _ = normalize_text("A    B\t\tC", limit=0, label="메모")
    assert clean == "A    B\t\tC"


def test_앞뒤_공백은_정리한다():
    clean, _ = normalize_text("  진도 내용  ", limit=0, label="진도")
    assert clean == "진도 내용"


def test_제어문자를_지우면_알린다():
    """조용한 수정이 문제입니다. 지웠으면 지웠다고 말해야 합니다."""
    clean, warns = normalize_text("진도\x00내용", limit=0, label="진도")
    assert "\x00" not in clean
    assert any("제어문자" in w for w in warns)


def _dead_marker_for_old_truncation_test():
    assert True
    assert any("초과" in w for w in warns)


def test_LaTeX_수식은_보존된다():
    src = r"$\frac{1}{128} \times 6$ 원리를 스스로 설명함"
    clean, _ = normalize_text(src, limit=500, label="메모")
    assert r"\frac{1}{128}" in clean


def test_한글_자모분리를_NFC로_정규화한다():
    decomposed = "강"  # ㄱ+ㅏ+ㅇ 조합형
    clean, _ = normalize_text(decomposed, limit=50, label="진도")
    assert clean == "강"


# ─────────────────────────────────────────────────────────────
# LLM 출력 게이트
# ─────────────────────────────────────────────────────────────
def test_LLM_메타발화를_차단한다():
    r = gate_llm_output("As an AI language model, I cannot...", limit=500)
    assert not r.ok


def test_LLM_스크립트주입을_차단한다():
    r = gate_llm_output("진도 완료 <script>alert(1)</script>", limit=500)
    assert not r.ok


def test_LLM_빈출력을_차단한다():
    assert not gate_llm_output("", limit=500).ok
    assert not gate_llm_output("   ", limit=500).ok


def test_정상_LLM_문장은_통과한다():
    r = gate_llm_output("p.31 실력쌓기 5~8번을 스스로 풀고 약분 원리를 설명했습니다.", limit=500)
    assert r.ok


def test_교재페이지_환각을_차단한다():
    """LLM 이 '9999쪽'을 적어 학부모 리포트에 나가는 사고 방지."""
    assert not gate_page_range(9999).ok
    assert not gate_page_range("삼십일").ok
    assert gate_page_range(31).ok


# ─────────────────────────────────────────────────────────────
# 세션 판정 — 200 을 성공으로 믿지 않는다
# ─────────────────────────────────────────────────────────────
def test_세션만료_표식을_잡아낸다():
    assert not is_authenticated("<html>normal_session_error</html>")


def test_로그인폼이_있으면_미인증으로_본다():
    html = '<html><form><input type="password" name="pw"></form></html>'
    assert not is_authenticated(html)


def _pad(html: str) -> str:
    """정상 페이지 최소 길이(200자)를 채운 픽스처."""
    return html + "<!-- " + "본문" * 120 + " -->"


def test_LoginServlet_문자열만으로_만료판정하지_않는다():
    """실측 확인: 로그아웃 링크에도 LoginServlet 이 들어 있다.
    이걸 만료 신호로 쓰면 정상 세션을 만료로 오판한다."""
    html = _pad('<a href="/servlet/controller.login.LoginServlet?p=out">로그아웃</a>')
    assert is_authenticated(html)


def test_정상페이지를_인증됨으로_판정한다():
    assert is_authenticated(_pad("<html>박경찬- [로그아웃] TutorMenuIndexServlet</html>"))


def test_공통헤더가_없는_팝업도_인증됨으로_본다():
    """실측: DayRecordServlet 팝업에는 로그아웃 링크도 메뉴 프레임도 없다.
    긍정 신호를 필수로 걸면 정상 팝업을 만료로 오판한다."""
    popup = _pad('<html><body><table class="content-table"><tbody></tbody></table></body></html>')
    assert is_authenticated(popup)


def test_빈응답과_너무짧은응답은_미인증이다():
    assert not is_authenticated("")
    assert not is_authenticated("<html>ok</html>")


def test_강사식별자를_hidden_input에서_추출한다():
    html = (
        '<input type="hidden" name="fran_no" value="1680">'
        '<input type="hidden" name="pri_no" value="1292923">'
        '<input type="hidden" name="mem_type" value="1">'
        '<a href="#" class="user-name">\n\t박경찬-\n</a>'
        '<span class="logOutSend">[로그아웃]</span>'
    )
    info = parse_teacher_info(html)
    assert info.fran_no == "1680"
    assert info.pri_no == "1292923"
    assert info.name == "박경찬"
    assert info.is_complete


def test_로그아웃_span이_떨어져있어도_이름을_뽑는다():
    """실측: 이름은 <a class="user-name"> 안, [로그아웃] 은 별도 span.
    둘 사이에 태그가 끼므로 인접 정규식은 실패한다."""
    html = '<a onclick="userclick();" class="user-name">\n   박경찬-\n  </a>   <span>[로그아웃]</span>'
    assert parse_teacher_info(html).name == "박경찬"


# ─────────────────────────────────────────────────────────────
# 쓰기 응답 판정
# ─────────────────────────────────────────────────────────────
def test_빈응답은_성공이_아니다():
    ok, _ = judge_response("")
    assert not ok


def test_에러문구가_있으면_실패로_본다():
    ok, detail = judge_response("error: invalid record_seq")
    assert not ok


def test_판정불가_응답은_성공으로_치지_않는다():
    """이전 구현이 200 이면 무조건 OK 라고 보고하던 자리.

    부정어도 실패마커도 없는 중립적 HTML 이라 '판정 불가'로 떨어져야 합니다.
    """
    ok, detail = judge_response("<html><body>처리 결과 페이지</body></html>")
    assert not ok
    assert "판정 불가" in detail


def test_부정문은_성공으로_읽히지_않는다():
    ok, detail = judge_response("저장되지 않았습니다")
    assert not ok
    assert "부정" in detail


def test_성공응답을_인식한다():
    ok, _ = judge_response("OK")
    assert ok


# ─────────────────────────────────────────────────────────────
# GateResult 계약
# ─────────────────────────────────────────────────────────────
def test_실패한_게이트는_예외를_던진다():
    r = gate_day_record({"progress_text": "내용"})
    with pytest.raises(GateError):
        r.raise_if_failed()


def test_clamp_int_경계값():
    assert clamp_int(5, 0, 10, "x")[0] == 5
    assert clamp_int(0, 0, 10, "x")[0] == 0
    assert clamp_int(10, 0, 10, "x")[0] == 10
    assert clamp_int(None, 0, 10, "x")[0] is None
