# -*- coding: utf-8 -*-
"""
수업일지 조회 회귀 테스트.

**이 파일이 막으려는 사고는 딱 하나입니다:**
서버에 데이터가 있는데 "행 0개" 로 읽고 없다고 판단하는 것.

실제로 그 일이 있었습니다. 8월 25일 수업일지에 출결·진도·숙제·메모가 전부
들어가 있었는데, 조회를 `GET std_date=2026-08-25` 로 보내서 0행이 나왔고
"아직 입력 안 하셨나요" 라고 되물었습니다. 선생님이 "리로드 안 한 것 아닌가"
라고 지적해 주셔서 드러났습니다.

성공기준이 "빠뜨리지 않는 것" 인데, **조회가 틀리면 빠진 것도 못 찾습니다.**
아래 HTML 은 2026-08-25 실제 응답의 구조만 옮긴 것입니다 (값은 대체).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.lms.endpoints import (  # noqa: E402
    ATTENDANCE_VALUES,
    DAY_RECORD_READ,
    DailyTestScaleError,
    daily_test_to_label,
    daily_test_to_wire,
)
from ganga.lms.reader import parse_day_record, read_day_record  # noqa: E402


def _page(*, attn="Y", dt="-1", prg="진도내용", hw="숙제내용", mm="메모내용"):
    """실측 구조 재현.

    일부러 **깨진 채로** 둡니다. 실제 서버가 td 안 table 을 닫을 때
    `</table></td>` 순서를 어겨서 lxml 이 tr 을 0개로 파싱합니다.
    표를 순회하는 구현은 이 픽스처에서 반드시 실패해야 합니다.
    """
    return f"""
<html><body>
<input type="hidden" name="teacher_pri_no" id="teacher_pri_no" value="1292923">
<input type="hidden" name="std_ymd" id="std_ymd" value="20260825">
<select name="grp_seq" id="grp_seq" onchange="javascript:onReload();">
  <option value="0">선택</option><option value="1" selected>a1</option>
</select>
<script>
function onAttn(i , course_seq, stu_pri_no, record_seq, cm_seq) {{
  var value = document.getElementById("attn"+i).value;
}}
</script>
<table class="table_title">
<tr><td>
  <table><tr><td>
    <input type="checkbox" id="check_daily_report_0" name="check_daily_report" value="3479920">
  </td><td>
    <img onclick="javascript:onDailyReport(3479920,1235920,1,82128);">
    <img onclick="javascript:onOneAlimtalk(3479920);">
    <img id="report_url_0" onclick="javascript:copyDailyReportUrl('홍길동', 'https://uga.kr/aK0Y');">
  </td></tr>
  </table></td>
  <td class="contents1">
    <select id="attn0" name="attn0" onchange="javascript:onAttn('0', '8', '1235920', '1', '82128' );">
      <option value=" ">선택</option>
      <option value="Y"{' selected' if attn == 'Y' else ''}>출석</option>
      <option value="N"{' selected' if attn == 'N' else ''}>결석</option>
      <option value="L"{' selected' if attn == 'L' else ''}>지각</option>
    </select></td>
  <td class="contents1">
    <img id="imgDailyTest_0" onclick="setDailyTest(1,82128,0)">
    <input type="hidden" name="h_daily_test" id="h_daily_test_0" value="{dt}"></td>
  <td class="contents1"><textarea id="prg_txt0" class="txt_area"
      onfocusout="javascript:onFoPrg('0', '8', '1235920', '1','82128');">{prg}</textarea></td>
  <td class="contents1"><textarea id="hw_txt0" class="txt_area"
      onfocusout="javascript:onFoHw('0', '8', '1235920', '1','82128');">{hw}</textarea></td>
  <td class="contents1"><textarea id="memo_txt0" class="txt_area"
      onfocusout="javascript:onFoMm('0', '8', '1235920', '1','82128');">{mm}</textarea></td>
  <td class="contents1"><textarea id="stu_memo_txt0" name="stu_memo_txt0"
      onfocusout="javascript:onFoStuMemo('0', '1235920', '8' );"></textarea></td>
</tr>
</table>
</body></html>"""


EMPTY = """
<html><body>
<input type="hidden" name="teacher_pri_no" id="teacher_pri_no" value="1292923">
<select name="grp_seq" id="grp_seq"><option value="0">선택</option>
<option value="1" selected>a1</option></select>
<script>
function onAttn(i , course_seq, stu_pri_no, record_seq, cm_seq) {}
function onFoPrg(i , course_seq, stu_pri_no, record_seq, cm_seq) {}
</script>
<table class="table_title"></table>
</body></html>"""


# ─────────────────────────────────────────────────────────────
# 이 파일의 핵심 — 값이 있으면 반드시 읽힌다
# ─────────────────────────────────────────────────────────────
def test_입력된_값을_전부_읽는다():
    p = parse_day_record(_page(), date="2026-08-25", grp_seq="1")
    assert len(p.records) == 1, "표 구조가 깨져 있어도 행을 찾아야 합니다"
    r = p.records[0]
    assert r.attendance == "Y"
    assert r.progress_text == "진도내용"
    assert r.homework_text == "숙제내용"
    assert r.memo_text == "메모내용"


def test_표_구조에_의존하지_않는다():
    """파싱이 표 마크업과 **무관**해야 합니다.

    실측: 2026-08-25 실제 응답에서 `table.table_title` 의 직계 tr 은 **0개**였습니다
    (td 안에 table 을 중첩하면서 태그 순서가 어긋나 lxml 이 행을 재배치함).
    그래서 표를 순회하는 구현은 데이터가 있어도 0행을 돌려줍니다.

    여기서는 표를 통째로 들어내고도 같은 결과가 나오는지 봅니다.
    같으면 표 구조가 어떻게 깨지든 영향이 없다는 뜻입니다.
    """
    html = _page()
    stripped = (html.replace("<table class=\"table_title\">", "")
                    .replace("<table>", "").replace("</table>", "")
                    .replace("<tr>", "").replace("</tr>", ""))
    a = parse_day_record(html, date="2026-08-25", grp_seq="1").records[0]
    b = parse_day_record(stripped, date="2026-08-25", grp_seq="1").records[0]
    assert vars(a) == vars(b), "표가 없어지면 결과가 달라진다 = 표에 의존하고 있다"


def test_식별키를_onAttn_인자에서_뽑는다():
    r = parse_day_record(_page(), date="2026-08-25", grp_seq="1").records[0]
    assert r.keys() == {"course_seq": "8", "stu_pri_no": "1235920",
                        "record_seq": "1", "cm_seq": "82128"}


def test_함수정의부는_행으로_세지_않는다():
    """`function onAttn(i , course_seq, ...)` 를 행으로 착각하면 유령 행이 생깁니다."""
    p = parse_day_record(EMPTY, date="2026-08-25", grp_seq="1")
    assert p.records == []
    assert p.has_groups, "그룹은 있는데 그날 수업이 없는 상태와 구분돼야 합니다"


# ─────────────────────────────────────────────────────────────
# 미입력과 0점은 다르다
# ─────────────────────────────────────────────────────────────
def test_DT_마이너스1은_미입력이지_0점이_아니다():
    r = parse_day_record(_page(dt="-1"), date="2026-08-25", grp_seq="1").records[0]
    assert r.daily_test is None
    assert "daily_test" in r.missing()


def test_DT_0은_미실시이고_입력된_것이다():
    """0 은 '0점' 이 아니라 '미실시' — 선생님이 확인은 한 상태입니다."""
    r = parse_day_record(_page(dt="0"), date="2026-08-25", grp_seq="1").records[0]
    assert r.daily_test == 0
    assert daily_test_to_label(0) == "미실시"
    assert "daily_test" not in r.missing(), "미실시를 미입력으로 보면 또 물어보게 됩니다"


# ─────────────────────────────────────────────────────────────
# 점수 단위 — 화면은 90점, 전송값은 9
# ─────────────────────────────────────────────────────────────
def test_90점은_9로_나간다():
    """실측: 화면에서 '90점' 을 고르면 서버에 9 가 저장되고 lv_09.png 가 뜹니다."""
    assert daily_test_to_wire(90) == 9
    assert daily_test_to_wire("90점") == 9
    assert daily_test_to_label(9) == "90점"


def test_100점과_10점을_섞지_않는다():
    assert daily_test_to_wire(100) == 10
    assert daily_test_to_wire("10점") == 1, "단위가 붙으면 점수로 확정됩니다"
    assert daily_test_to_label(1) == "10점"
    assert daily_test_to_label(10) == "100점"


def test_맨숫자_1에서_10은_애매해서_거부한다():
    """`9` 가 9점인지 90점인지 알 수 없습니다. 애매하면 실패로 판정합니다."""
    for ambiguous in (1, 5, 9, 10, "9", "10"):
        with pytest.raises(DailyTestScaleError):
            daily_test_to_wire(ambiguous)


def test_0점은_존재하지_않는다():
    with pytest.raises(DailyTestScaleError, match="미실시"):
        daily_test_to_wire(0)


def test_10점단위가_아니면_거부한다():
    for bad in (85, 95, 101, 7000):
        with pytest.raises(DailyTestScaleError):
            daily_test_to_wire(bad)


def test_미실시와_미확인은_다르다():
    assert daily_test_to_wire("미실시") == 0
    assert daily_test_to_wire("미확인") == -1


# ─────────────────────────────────────────────────────────────
# 출결 — 지각(L) 이 있다
# ─────────────────────────────────────────────────────────────
def test_출결값은_Y_N_L_세_가지():
    assert set(ATTENDANCE_VALUES) == {" ", "Y", "N", "L"}


def test_지각을_읽는다():
    r = parse_day_record(_page(attn="L"), date="2026-08-25", grp_seq="1").records[0]
    assert r.attendance == "L" and r.attendance_label == "지각"
    assert not r.is_absent, "지각은 결석이 아닙니다"


def test_결석이면_출결만_있으면_완결():
    html = _page(attn="N", dt="-1", prg="", hw="", mm="")
    r = parse_day_record(html, date="2026-08-25", grp_seq="1").records[0]
    assert r.is_absent
    assert r.missing() == (), "결석인데 진도·숙제를 요구하면 안 됩니다"


def test_출석인데_비어있으면_전부_빠짐으로_잡는다():
    html = _page(attn="Y", dt="-1", prg="", hw="", mm="")
    r = parse_day_record(html, date="2026-08-25", grp_seq="1").records[0]
    assert set(r.missing()) == {"daily_test", "progress", "homework", "memo"}


# ─────────────────────────────────────────────────────────────
# 리포트
# ─────────────────────────────────────────────────────────────
def test_리포트_URL_과_학생명을_읽는다():
    r = parse_day_record(_page(), date="2026-08-25", grp_seq="1").records[0]
    assert r.report_seq == "3479920"
    assert r.report_url == "https://uga.kr/aK0Y"
    assert r.student_name == "홍길동"


def test_강사식별자를_읽는다():
    """DT·숙제완성도 전송에 `tutor_pri_no` 가 필수입니다 (없으면 서버가 거부)."""
    p = parse_day_record(_page(), date="2026-08-25", grp_seq="1")
    assert p.teacher_pri_no == "1292923"


# ─────────────────────────────────────────────────────────────
# 요청 형태 — 이게 틀려서 사고가 났습니다
# ─────────────────────────────────────────────────────────────
class FakeSession:
    def __init__(self, html):
        self.html = html
        self.gets: list[tuple] = []
        self.posts: list[tuple] = []

    def get(self, url, **kw):
        self.gets.append((url, kw))
        raise AssertionError("수업일지 조회를 GET 으로 보냈습니다 (실제는 POST)")

    def post(self, url, *, data=None, **kw):
        self.posts.append((url, data or {}))
        return type("R", (), {"html_content": self.html, "status": 200})()


def test_조회는_POST_이고_날짜는_하이픈이_없다():
    s = FakeSession(_page())
    read_day_record(s, date="2026-08-25", grp_seq="1")

    assert not s.gets
    url, data = s.posts[0]
    assert url.endswith("controller.cct.tutor.DayRecordServlet")
    assert data["std_ymd"] == "20260825", "하이픈이 붙으면 서버가 그날을 못 찾습니다"
    assert data["p_process"] == "Main"
    assert data["grp_seq"] == "1"


def test_이미_하이픈없는_날짜도_받는다():
    s = FakeSession(_page())
    p = read_day_record(s, date="20260825", grp_seq="1")
    assert s.posts[0][1]["std_ymd"] == "20260825"
    assert p.date == "20260825"


def test_엔드포인트_스펙이_POST로_기록돼_있다():
    """스펙과 구현이 갈라지면 다음 사람이 또 GET 으로 짭니다."""
    assert DAY_RECORD_READ["method"] == "POST"
    assert "std_ymd" in DAY_RECORD_READ["params"]
    assert "std_date" not in DAY_RECORD_READ["params"]


def test_미완결_학생만_추린다():
    p = parse_day_record(_page(dt="-1"), date="2026-08-25", grp_seq="1")
    assert len(p.incomplete) == 1
    p2 = parse_day_record(_page(dt="7"), date="2026-08-25", grp_seq="1")
    assert p2.incomplete == []
