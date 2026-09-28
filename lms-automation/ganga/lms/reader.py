# -*- coding: utf-8 -*-
"""
LMS 읽기 어댑터 — 결정론적 수집 계층.

이 계층에는 LLM 이 개입하지 않습니다. 서버 HTML → 정규화된 파이썬 객체까지가
전부이며, 실패는 조용히 넘어가지 않고 예외로 올라옵니다.

이전 구현에서 고친 것
  · `table.content-table tbody tr` 는 셀 안의 툴팁 테이블 행까지 잡아
    10행짜리 표에서 30행이 나왔습니다. → `> tbody > tr` 로 직계 자식만 선택.
  · 페이지네이션을 처리하지 않아 항상 앞 10명만 읽혔습니다.
    실제로는 16페이지, 151명입니다. → POST + p_pageno 순회.
  · 파싱 결과를 만들어 놓고 개수만 반환해 데이터를 버렸습니다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterator

from .endpoints import (
    BASE_URL,
    COURSE,
    DAY_RECORD_READ,
    STUDY,
    TESTPOOL,
    USER,
)
from .session import LmsSession

#: 표 본문 행 — 반드시 직계 자식으로 한정 (중첩 툴팁 테이블 배제)
ROWS = "table.content-table > tbody > tr"

#: 페이지네이션 링크에서 페이지 번호 추출
_GO_PAGE = re.compile(r"goPage\(['\"]?(\d+)")

#: 안전장치: 무한 페이지 순회 방지
MAX_PAGES = 200


def _cells(row) -> list[str]:
    return [td.get_all_text(strip=True) for td in row.css("td")]


def _split_lines(text: str) -> list[str]:
    return [p.strip() for p in text.split("\n") if p.strip()]


def last_page(html: str) -> int:
    """페이지네이션 영역에서 마지막 페이지 번호를 구합니다."""
    nums = [int(n) for n in _GO_PAGE.findall(html)]
    return max(nums) if nums else 1


# ─────────────────────────────────────────────────────────────
# 학생 명단
# ─────────────────────────────────────────────────────────────
@dataclass
class Student:
    login_id: str
    name: str
    grade: str
    homeroom: str          # 학반 = 담당 강사명이 들어옴
    status: str = ""

    @property
    def is_placeholder(self) -> bool:
        """'test/test' 같은 테스트 계정."""
        return self.login_id.lower() == "test" or not self.name


@dataclass
class Roster:
    students: list[Student] = field(default_factory=list)
    pages_read: int = 0
    #: 수집이 불완전할 수 있는 사유. 비어 있지 않으면 명단을 신뢰하지 마세요.
    warnings: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.students)

    @property
    def is_complete(self) -> bool:
        return not self.warnings

    def by_teacher(self, teacher_name: str) -> list[Student]:
        return [s for s in self.students if s.homeroom == teacher_name]

    def real(self) -> list[Student]:
        return [s for s in self.students if not s.is_placeholder]


def _parse_student_rows(page) -> list[Student]:
    out: list[Student] = []
    for row in page.css(ROWS):
        c = _cells(row)
        if len(c) < 4:
            continue
        parts = _split_lines(c[0])
        if not parts:
            continue
        out.append(
            Student(
                login_id=parts[0],
                name=parts[1] if len(parts) > 1 else "",
                grade=c[1],
                homeroom=c[2],
                status=_split_lines(c[3])[0] if c[3] else "",
            )
        )
    return out


def read_roster(lms: LmsSession, *, grp_no: str = "2", max_pages: int = MAX_PAGES) -> Roster:
    """지점 전체 학생 명단을 **모든 페이지** 읽어옵니다.

    주의: 이 화면은 담당 학생이 아니라 지점 전체 명단입니다.
    담당 학생만 필요하면 `Roster.by_teacher(강사명)` 을 쓰세요.
    """
    ep = USER["search"]
    url = f"{BASE_URL}/servlet/controller.tutor.base.UserSearchServlet"
    base_form = {
        "p_process": "Main", "grp_no": grp_no, "grade_no": "", "cls_no": "",
        "name": "", "status": "", "lecture_status": "", "login_status": "",
    }

    first = lms.post(url, data={**base_form, "p_pageno": "1"})
    roster = Roster(students=_parse_student_rows(first), pages_read=1)

    # ⚠️ 페이지네이터가 10칸 슬라이딩 윈도우면 1페이지에서는 '11'까지만 보입니다.
    #    총 페이지 수를 1회만 계산하면 뒷부분을 조용히 놓칩니다.
    #    → 매 페이지마다 상한을 다시 계산해 확장합니다.
    total_pages = min(last_page(first.html_content), max_pages)
    seen_ids: set[str] = {s.login_id for s in roster.students}

    pg = 2
    while pg <= total_pages:
        page = lms.post(url, data={**base_form, "p_pageno": str(pg)})
        rows = _parse_student_rows(page)
        if not rows:
            roster.warnings.append(f"{pg}페이지가 비어 있어 중단했습니다 (총 {total_pages}p 예상)")
            break

        new = [s for s in rows if s.login_id not in seen_ids]
        if not new:
            # 서버가 p_pageno 를 무시하고 같은 페이지를 반복 반환하는 경우
            roster.warnings.append(f"{pg}페이지가 이전 페이지와 동일 — 페이지 이동 실패로 판단")
            break

        seen_ids.update(s.login_id for s in new)
        roster.students.extend(new)
        roster.pages_read += 1

        total_pages = min(max(total_pages, last_page(page.html_content)), max_pages)
        pg += 1

    if roster.pages_read < total_pages:
        roster.warnings.append(
            f"{total_pages}페이지 중 {roster.pages_read}페이지만 읽었습니다 — 명단이 불완전합니다"
        )
    return roster


# ─────────────────────────────────────────────────────────────
# 수업일지 — 실측 재작성 (2026-08-20, 8/25 실데이터 확인)
# ─────────────────────────────────────────────────────────────
"""
이전 구현이 틀렸던 3가지. 전부 "행이 0개" 라는 같은 증상으로 나타나
**데이터가 없는 것**으로 오판하게 만들었습니다.

  1. GET + `std_date=2026-08-25` 로 호출 → 실제는 **POST + `std_ymd=20260825`**
     (하이픈 없음). 근거: 페이지의 `onReload()` / `onNextDay()` 가
     `document.form1.p_process.value="Main"` 후 `form1.submit()` (method=post).
  2. 표 클래스가 `content-table` 이 아니라 **`table_title`**.
  3. 애초에 **표를 순회하면 안 됩니다.** 이 화면은 td 안에 table 을 중첩하면서
     `</table></td>` 순서가 어긋난 깨진 HTML 이라 lxml 이 tr 을 0개로 파싱합니다.
     → 표 구조 대신 **`id="{필드}{행번호}"` 규칙**으로 직접 뽑습니다.
       서버가 표 마크업을 바꿔도 id 규칙이 유지되면 계속 동작합니다.

값이 어디 있는지 (실측)

    id="attn{i}"                select   출결      " "/Y/N/L
    id="prg_txt{i}"             textarea 진도
    id="hw_txt{i}"              textarea 숙제
    id="memo_txt{i}"            textarea 메모
    id="stu_memo_txt{i}"        textarea 지속사항
    id="h_daily_test_{i}"       hidden   일일테스트 (-1 = 미입력)
    id="h_homework_rate_{i}"    hidden   숙제완성도 (없을 수도 있음)
    id="check_daily_report_{i}" checkbox value = report_seq
    id="report_url_{i}"         img      onclick=copyDailyReportUrl(이름, 리포트URL)

식별키는 `attn{i}` 의 onchange 인자에서 나옵니다::

    onAttn('0', '8', '1235920', '1', '82128')
           i   course_seq stu_pri_no record_seq cm_seq
"""

#: 출결 드롭다운 실측값. **`L`(지각) 이 있습니다** — Y/N 만 있다고 보면 안 됩니다.
ATTENDANCE_CHOICES: dict[str, str] = {
    " ": "선택", "Y": "출석", "N": "결석", "L": "지각",
}

#: 일일테스트/숙제완성도 미입력 표식
UNSET = "-1"

_ATTN_ID = re.compile(r'id="attn(\d+)"')
_ATTN_ARGS = re.compile(
    r"onAttn\(\s*'(\d+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'"
)
_COPY_URL = re.compile(r"copyDailyReportUrl\('([^']*)',\s*'([^']*)'\)")


def _tag_at(html: str, ident: str) -> tuple[str, int, int] | None:
    """`id="{ident}"` 를 담은 여는 태그와 그 범위를 돌려줍니다."""
    i = html.find(f'id="{ident}"')
    if i < 0:
        return None
    st = html.rfind("<", 0, i)
    en = html.find(">", i)
    if st < 0 or en < 0:
        return None
    return html[st:en + 1], st, en


def _attr(tag: str, name: str) -> str:
    m = re.search(rf'{name}\s*=\s*"([^"]*)"', tag, re.I)
    return m.group(1) if m else ""


def _textarea(html: str, ident: str) -> str:
    """`<textarea id=...>` 의 내용. 깨진 표 구조와 무관하게 동작합니다."""
    found = _tag_at(html, ident)
    if not found:
        return ""
    _, _, en = found
    j = html.find("</textarea>", en)
    return html[en + 1:j].strip() if j > 0 else ""


def _selected(html: str, ident: str) -> str:
    """`<select id=...>` 에서 selected 된 option 의 value."""
    found = _tag_at(html, ident)
    if not found:
        return ""
    _, _, en = found
    j = html.find("</select>", en)
    if j < 0:
        return ""
    m = re.search(r'<option[^>]*value="([^"]*)"[^>]*\bselected\b', html[en:j], re.I)
    return m.group(1).strip() if m else ""


def _hidden(html: str, ident: str) -> str:
    found = _tag_at(html, ident)
    return _attr(found[0], "value") if found else ""


def _score(raw: str) -> int | None:
    """`-1`/빈값은 **미입력**입니다. 0 점과 구분해야 합니다."""
    if raw in ("", UNSET):
        return None
    try:
        return int(raw)
    except ValueError:
        return None


@dataclass
class DayRecordGroup:
    value: str
    label: str


@dataclass
class DayRecordRow:
    """수업일지 한 행 = 학생 1명의 그날 기록."""

    index: int
    course_seq: str
    stu_pri_no: str
    record_seq: str
    cm_seq: str
    student_name: str = ""
    report_seq: str = ""
    report_url: str = ""
    attendance: str = ""            # "" | Y | N | L
    daily_test: int | None = None   # None = 미입력 (0점과 다름)
    homework_rate: int | None = None
    progress_text: str = ""
    homework_text: str = ""
    memo_text: str = ""
    student_memo: str = ""

    def keys(self) -> dict[str, str]:
        return {
            "course_seq": self.course_seq, "stu_pri_no": self.stu_pri_no,
            "record_seq": self.record_seq, "cm_seq": self.cm_seq,
        }

    @property
    def attendance_label(self) -> str:
        return ATTENDANCE_CHOICES.get(self.attendance or " ", "미입력")

    @property
    def is_absent(self) -> bool:
        return self.attendance == "N"

    def filled(self) -> dict[str, bool]:
        """필수 5항목이 서버에 실제로 들어가 있는지."""
        return {
            "attendance": self.attendance not in ("", " "),
            "daily_test": self.daily_test is not None,
            "progress": bool(self.progress_text),
            "homework": bool(self.homework_text),
            "memo": bool(self.memo_text),
        }

    def missing(self) -> tuple[str, ...]:
        """빠진 항목. 결석이면 출결만 있으면 됩니다."""
        f = self.filled()
        if self.is_absent:
            return () if f["attendance"] else ("attendance",)
        return tuple(k for k, ok in f.items() if not ok)


@dataclass
class DayRecordPage:
    date: str
    grp_seq: str
    groups: list[DayRecordGroup]
    records: list[DayRecordRow]
    teacher_pri_no: str = ""

    @property
    def rows(self) -> list[list[str]]:
        """하위호환. 예전 코드가 문자열 행을 기대합니다."""
        return [[r.student_name, r.attendance_label, r.progress_text,
                 r.homework_text, r.memo_text] for r in self.records]

    @property
    def has_groups(self) -> bool:
        return any(g.value not in ("", "0") for g in self.groups)

    @property
    def incomplete(self) -> list[DayRecordRow]:
        return [r for r in self.records if r.missing()]


def parse_day_record(html: str, *, date: str, grp_seq: str) -> DayRecordPage:
    """수업일지 HTML → 구조화. 네트워크와 분리해 테스트 가능하게 둡니다."""
    groups = []
    found = _tag_at(html, "grp_seq") or _tag_at(html, "sel_grp_seq")
    if found:
        _, _, en = found
        j = html.find("</select>", en)
        for m in re.finditer(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)<', html[en:j]):
            groups.append(DayRecordGroup(m.group(1).strip(), m.group(2).strip()))

    # 인자에 따옴표가 있는 것만 = 실제 렌더된 행. 함수 정의부는 걸리지 않습니다.
    args = {m.group(1): m.groups()[1:] for m in _ATTN_ARGS.finditer(html)}

    records: list[DayRecordRow] = []
    for i in sorted(set(_ATTN_ID.findall(html)), key=int):
        a = args.get(i)
        if not a:
            continue
        row = DayRecordRow(
            index=int(i), course_seq=a[0], stu_pri_no=a[1],
            record_seq=a[2], cm_seq=a[3],
            attendance=_selected(html, f"attn{i}"),
            daily_test=_score(_hidden(html, f"h_daily_test_{i}")),
            homework_rate=_score(_hidden(html, f"h_homework_rate_{i}")),
            progress_text=_textarea(html, f"prg_txt{i}"),
            homework_text=_textarea(html, f"hw_txt{i}"),
            memo_text=_textarea(html, f"memo_txt{i}"),
            student_memo=_textarea(html, f"stu_memo_txt{i}"),
            report_seq=_hidden(html, f"check_daily_report_{i}"),
        )
        tag = _tag_at(html, f"report_url_{i}")
        if tag:
            m = _COPY_URL.search(tag[0])
            if m:
                row.student_name, row.report_url = m.group(1), m.group(2)
        records.append(row)

    return DayRecordPage(
        date=date, grp_seq=grp_seq, groups=groups, records=records,
        teacher_pri_no=_hidden(html, "teacher_pri_no"),
    )


def read_day_record(lms: LmsSession, date: str, grp_seq: str = "0") -> DayRecordPage:
    """수업일지 화면을 읽습니다.

    `date` 는 `2026-08-25` / `20260825` 둘 다 받습니다 (서버엔 하이픈 없이 나감).
    학생그룹을 고르지 않으면(`grp_seq='0'`) 서버가 행을 0개 돌려줍니다.
    `has_groups` 가 False 면 아직 학생그룹이 만들어지지 않은 것입니다.
    """
    ymd = date.replace("-", "")
    page = lms.post(
        f"{BASE_URL}/servlet/{DAY_RECORD_READ['servlet']}",
        data={"p_process": "Main", "std_ymd": ymd, "std_date": date,
              "grp_seq": grp_seq, "visit": "1",
              "teacher_pri_no": "", "course_seq": ""},
    )
    return parse_day_record(page.html_content, date=date, grp_seq=grp_seq)


# ─────────────────────────────────────────────────────────────
# 문제지 목록
# ─────────────────────────────────────────────────────────────
@dataclass
class TestPaper:
    grade: str
    title: str
    item_count: str
    author: str
    created: str


def read_test_papers(lms: LmsSession, *, max_pages: int = 5) -> list[TestPaper]:
    """문제지 조회 목록. 지점 전체 강사의 제작물이 함께 나옵니다.

    실측 셀 구조 (헤더가 5열로 보이지만 td 는 9개):
        [0] "학년\\n시험지 제목"  [1] 문항수  [2] 제작선생님  [3] 제작일
        [4] "삭제"                [5..8] 툴팁/검색어 등 부가정보
    """
    page = lms.get(TESTPOOL["list"].url)
    papers: list[TestPaper] = []
    for row in page.css(ROWS):
        c = _cells(row)
        if len(c) < 5:
            continue
        head = _split_lines(c[0])
        papers.append(
            TestPaper(
                grade=head[0] if head else "",
                title=head[1] if len(head) > 1 else "",
                item_count=c[1],
                author=c[2],
                created=c[3],
            )
        )
    return papers


# ─────────────────────────────────────────────────────────────
# 자가진단
# ─────────────────────────────────────────────────────────────
def probe_endpoints(lms: LmsSession) -> Iterator[tuple[str, str, bool, int]]:
    """주요 읽기 엔드포인트가 살아 있는지 순회 점검합니다.

    yield: (그룹, 라벨, 성공여부, 응답길이)
    """
    groups = {"수업관리": COURSE, "학습관리": STUDY, "문제지제작": TESTPOOL, "사용자관리": USER}
    for gname, group in groups.items():
        for ep in group.values():
            if not ep.path or ep.method != "GET":
                continue
            try:
                r = lms.get(ep.url)
                yield gname, ep.label, True, len(r.html_content)
            except Exception:
                yield gname, ep.label, False, 0
