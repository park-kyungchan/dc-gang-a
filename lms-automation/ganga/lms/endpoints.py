# -*- coding: utf-8 -*-
"""
dc.gang-a.kr 강사 LMS 엔드포인트 맵 — 실측 검증본 (2026-08-19)

각 항목의 `verified` 필드는 실제 로그인 상태에서 화면을 열어 DOM 의 href 를
직접 추출해 확인했는지를 나타냅니다. False 인 항목은 추정이므로 사용 전
반드시 DevTools Network 탭으로 확인하세요.

이 파일은 docs/LMS_SITEMAP.md 와 1:1 로 대응합니다. 한쪽만 고치지 마세요.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

BASE_URL = "https://dc.gang-a.kr"
STORAGE_URL = "https://storage.studyq.net"

Method = Literal["GET", "POST"]


@dataclass(frozen=True)
class Endpoint:
    """LMS 엔드포인트 1개."""

    key: str
    label: str
    path: str
    method: Method = "GET"
    #: 실제 화면에서 href 를 추출해 확인했는가
    verified: bool = True
    #: 새 창(window.open)으로 열리는 팝업 화면인가
    popup: bool = False
    #: 필수 폼/쿼리 파라미터
    params: tuple[str, ...] = field(default_factory=tuple)
    note: str = ""

    @property
    def url(self) -> str:
        return f"{BASE_URL}{self.path}"


def _tab(p_process: str) -> str:
    return f"/servlet/controller.tutor.TutorMenuIndexServlet?p_process={p_process}"


# ─────────────────────────────────────────────────────────────
# 최상위 탭 8개 (전부 검증됨)
# ─────────────────────────────────────────────────────────────
TABS: dict[str, Endpoint] = {
    "user": Endpoint("user", "사용자관리", _tab("BaseManageIndex")),
    "da": Endpoint("da", "학력인증평가", _tab("DAIndex")),
    "fa": Endpoint("fa", "형성평가", _tab("FAIndex")),
    "na": Endpoint("na", "수시평가", _tab("NAIndex")),
    "smartbook": Endpoint("smartbook", "스마트북", _tab("SmartBookMainIndex")),
    "testpool": Endpoint("testpool", "문제지제작", _tab("TestPoolIndex")),
    "study": Endpoint("study", "학습관리", _tab("CourseMainIndex")),
    "course": Endpoint("course", "수업관리", _tab("CourseManageIndex")),
    "community": Endpoint("community", "고객센터", _tab("CommunityMainIndex")),
}

# ─────────────────────────────────────────────────────────────
# 1. 수업관리
# ─────────────────────────────────────────────────────────────
_CCT = "/servlet/controller.cct.tutor"

COURSE: dict[str, Endpoint] = {
    "schedule": Endpoint(
        "schedule", "수업일정관리", f"{_CCT}.CourseScheduleServlet?p_process=Main"
    ),
    "group": Endpoint(
        "group", "학생그룹관리", f"{_CCT}.CourseGroupServlet?p_process=Main"
    ),
    "day_record": Endpoint(
        "day_record", "수업일지", f"{_CCT}.DayRecordServlet?p_process=Main",
        method="POST", popup=True,
        params=("p_process", "std_ymd", "grp_seq", "visit", "teacher_pri_no"),
        note="POST + std_ymd(하이픈 없음). 학생그룹 고르기 전에는 행 0개.",
    ),
    "day_record_by_date": Endpoint(
        "day_record_by_date", "날짜별 수업일지",
        f"{_CCT}.DayRecordServlet?p_process=DaysMain", popup=True,
    ),
    "member": Endpoint(
        "member", "학생편성관리", f"{_CCT}.CourseMemberServlet?p_process=Main"
    ),
    "attendance": Endpoint(
        "attendance", "학생별출결조회", f"{_CCT}.AttendanceServlet?p_process=Main"
    ),
    "counsel": Endpoint(
        "counsel", "상담관리", "/counsel/csl_student_list.jsp", popup=True
    ),
}

# ─────────────────────────────────────────────────────────────
# 2. 학습관리
# ─────────────────────────────────────────────────────────────
_CM = "/servlet/controller.coursemanage.CourseManageServlet?reqCmd="
_DZT = "/servlet/controller.dailyzerotest.DailyZeroTestServlet?reqCmd="

STUDY: dict[str, Endpoint] = {
    "ga_result": Endpoint(
        "ga_result", "강아학습결과",
        "/servlet/controller.tutor.base.TestPageListServlet?p_process=Main",
    ),
    "textbook_report": Endpoint(
        "textbook_report", "교재리포트 생성",
        "/servlet/controller.coursemanage.TextBookManageServlet?reqCmd=getTextBookMain",
    ),
    "dtzt_list": Endpoint("dtzt_list", "DT / ZT 목록", f"{_DZT}DailyZeroTestMain"),
    "dtzt_result": Endpoint("dtzt_result", "DT / ZT 결과", f"{_DZT}DailyZeroTestResult"),
    "progress": Endpoint("progress", "진도현황표", f"{_CM}StudyMain"),
    "progress_concept": Endpoint(
        "progress_concept", "학습과정별 개념진도현황", f"{_CM}StudyPro"
    ),
    "progress_student": Endpoint(
        "progress_student", "학생별 진도현황", f"{_CM}StudySchedule"
    ),
    "course_assign": Endpoint(
        "course_assign", "학생별 학습과정 관리", f"{_CM}StudyCourse"
    ),
    "course_lookup": Endpoint("course_lookup", "학습과정 조회", f"{_CM}CourseStudyManager"),
    "answers": Endpoint(
        "answers", "교재정답지 & 일일학습", f"{_CM}GaStudyAnswer",
        note="초등/중등/고등은 URL 파라미터가 아니라 페이지 내 JS 탭. grade= 는 존재하지 않음.",
    ),
    "prestudy_todo": Endpoint("prestudy_todo", "예습 확인", f"{_CM}WebUnPreStudy"),
    "prestudy_video": Endpoint(
        "prestudy_video", "예습영상 현황", f"{_CM}TeacherPrestudySummary"
    ),
    "alimtalk": Endpoint(
        "alimtalk", "알림톡 목록", "", verified=False,
        note="사이드바에 존재하나 href 미추출(JS 링크 추정). 사용 전 확인 필요.",
    ),
}

# ─────────────────────────────────────────────────────────────
# 3. 문제지제작
# ─────────────────────────────────────────────────────────────
_ETEST = "/servlet/controller.tutor.etest.TestPoolServlet?reqCmd="

TESTPOOL: dict[str, Endpoint] = {
    "list": Endpoint("list", "문제지 조회", f"{_ETEST}Main",
                     note="지점 전체 강사의 제작물이 함께 표시됨. 10건씩 페이지네이션."),
    "create": Endpoint("create", "문제지 생성", "/common/etest_pool.jsp", popup=True),
    "history": Endpoint("history", "문제지 제작 이력조회", f"{_ETEST}LogViewList"),
}

# ─────────────────────────────────────────────────────────────
# 4~6. 평가 3종 (FA 형성평가 / NA 수시평가 / DA 학력인증평가)
#      셋의 서블릿 구조가 동일해서 접두어만 다릅니다.
# ─────────────────────────────────────────────────────────────
#: 학생별 응시결과 조회에 쓰이는 평가 코드 (검증됨)
ASS_NO = {"da": "1000", "fa": "1001", "na": "1002"}

#: 평가별 '시험 구분' 드롭다운 실측값
EXAM_TYPES: dict[str, tuple[str, ...]] = {
    "fa": (
        "단원평가", "단원평가(선행)", "단원평가(초등)", "월말평가", "월말평가(선행)",
        "중간고사대비", "기말고사대비", "교재 마무리 평가", "총괄평가",
        "누적 테스트", "중간평가",
    ),
    "na": ("일일평가", "일일평가(선행)", "주말평가", "주말평가(선행)"),
    "da": (),  # 미확인
}


def exam_endpoints(kind: Literal["fa", "na", "da"]) -> dict[str, Endpoint]:
    """형성평가(fa) / 수시평가(na) / 학력인증평가(da) 의 하위 메뉴 맵."""
    if kind not in ASS_NO:
        raise ValueError(f"kind 는 fa/na/da 중 하나여야 합니다: {kind!r}")
    p = f"/servlet/controller.tutor.{kind}"
    label = {"fa": "형성평가", "na": "수시평가", "da": "학력인증평가"}[kind]
    # 시험지 목록 서블릿 이름이 수시평가만 다릅니다.
    list_path = (
        f"{p}.TestPageListOurclgServlet?p_process=Main" if kind == "na"
        else f"{p}.TestPageListGrpServlet?p_process=Main"
    )
    eps = {
        "create": Endpoint("create", f"{label} 새로 만들기",
                           f"{p}.TestPageRegServlet?p_process=Auto"),
        "list": Endpoint("list", f"{label} 시험지 목록 / 출제", list_path),
        "result_by_exam": Endpoint("result_by_exam", "시험별 응시결과",
                                   f"{p}.TestPageListServlet"),
        "result_by_period": Endpoint("result_by_period", "기간별 응시결과",
                                     f"{p}.MarksResultDigestServlet?p_process=Main"),
        "result_by_student": Endpoint(
            "result_by_student", "학생별 응시결과",
            "/servlet/controller.tutor.base.TestPageListServlet"
            f"?p_process=UserByMain&ass_no={ASS_NO[kind]}",
        ),
    }
    if kind == "na":
        eps["grading_helper"] = Endpoint(
            "grading_helper", "채점도우미",
            f"{p}.TestPageRegServlet?p_process=NonePaper",
            note="지필 오프라인 시험 점수만 입력. 학년 드롭다운이 2015개정 명칭을 씀(주의).",
        )
    if kind == "da":
        eps["diag_papers"] = Endpoint(
            "diag_papers", "신입생 진단평가 - 시험지 목록",
            "/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestPaperList",
        )
        eps["diag_results"] = Endpoint(
            "diag_results", "신입생 진단평가 - 시험 결과",
            "/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestResultList",
        )
    return eps


# ─────────────────────────────────────────────────────────────
# 7. 스마트북 / 8. 사용자관리
# ─────────────────────────────────────────────────────────────
SMARTBOOK: dict[str, Endpoint] = {
    "list": Endpoint("list", "스마트북 목록",
                     "/servlet/controller.tutor.wb.WorkbookManageServlet?p_process=Main"),
    "result": Endpoint("result", "스마트북 시험결과",
                       "/servlet/controller.tutor.wb.WbTeachList1Servlet"
                       "?p_process=SmartBookResultMain"),
}

_BASE = "/servlet/controller.tutor.base"

USER: dict[str, Endpoint] = {
    "search": Endpoint(
        "search", "사용자검색", f"{_BASE}.UserSearchServlet?p_process=Main",
        method="POST",
        params=("p_process", "grp_no", "p_pageno", "grade_no", "cls_no",
                "name", "status", "lecture_status", "login_status"),
        note="검색/페이지이동은 POST. grp_no 는 필수(2=학생). 10건씩 페이지네이션.",
    ),
    "approve": Endpoint("approve", "학생승인 & 반편성",
                        f"{_BASE}.UserClsManageServlet?p_process=Main"),
    "pad": Endpoint("pad", "학습패드관리",
                    f"{_BASE}.UserSearchServlet?p_process=GetCertificateMain"),
    "book_order": Endpoint(
        "book_order", "교재요청관리",
        "/servlet/controller.bookorder.tutor.PreOrderServlet?p_process=ClgMain"),
}

# ─────────────────────────────────────────────────────────────
# 수업일지 쓰기 스펙 — ✅ 2026-08-20 페이지 JS 원문에서 직접 확인
# ─────────────────────────────────────────────────────────────
"""
학생이 0명이어도 **페이지의 자바스크립트 원문**은 그대로 내려오므로,
각 입력칸이 어디로 무엇을 보내는지 전부 읽어낼 수 있었습니다.
아래는 `DayRecordServlet?p_process=Main` 의 JS 함수에서 그대로 옮긴 것입니다.

    onFoPrg      → udtPrg      진도      GET  DayRecordServlet
    onFoHw       → udtHw       숙제      GET  DayRecordServlet
    onFoMm       → udtMemo     메모      GET  DayRecordServlet
    onFoStuMemo  → udtStuMemo  지속사항  GET  DayRecordServlet  ← 파라미터가 다름
    onAttn       → udtAttn     출석      GET  DayRecordServlet
    setDailyTest → SetDailyTest    일일테스트   POST CourseCommonServlet
    openHomeWorkRate → SetHomeWorkRate 숙제완성도 POST CourseCommonServlet
    setCourseData→ SetCourseData    진도 단원선택 POST CourseCommonServlet
    onDailyReport→ DailyReport      Study Report 팝업
                   DailyReportExcel 엑셀

이전 코드가 틀렸던 것 5가지
  1. 일일테스트 필드명이 `daily_test_radio` 가 아니라 **`daily_test_no`**
     (라디오 input 의 name 은 daily_test_radio 지만, 전송되는 파라미터는 다름)
  2. 진도/숙제/메모/출석은 **GET** 입니다. POST 로 바꿔 보낼 근거가 없었습니다.
  3. 메모·진도·숙제 길이 제한은 2000자가 아니라 **200자**
     (JS 가 `reallength(value) > 400` 으로 검사 — 한글 2바이트 기준)
  4. 지속사항만 2000자이고, `tut_pri_no`(tutor 아님)·`stu_pri_no`·`course_seq`
     만 받습니다. record_seq/cm_seq 를 보내면 안 됩니다.
  5. 진도는 자유텍스트 말고 **대단원+소단원 드롭다운**(SetCourseData) 경로가
     따로 있고, 그쪽은 `homework_memo` 에 "대단원명 소단원명" 을 넣습니다.
"""
#: `servlet` 은 **패키지 경로를 포함한 전체 이름**입니다. 클래스명만 담아두면
#: 호출부가 접두사를 하드코딩하게 되고, 실제로 그 때문에 DT점수/숙제완성도가
#: `controller.cct.tutor.CourseCommonServlet`(존재하지 않음)로 나가고 있었습니다.
#: 올바른 네임스페이스는 `controller.cct.common` 입니다.
#: `extra_params` 는 해당 동작에만 필요한 추가 필드입니다.
_DR = "controller.cct.tutor.DayRecordServlet"
_CC = "controller.cct.common.CourseCommonServlet"

#: 수업일지 **조회** 스펙 — ✅ 2026-08-25 실데이터로 확인
#:
#: 한때 `GET std_date=2026-08-25` 로 부르고 있었고, 그래서 데이터가 있는 날에도
#: 행이 0개로 나왔습니다. **"데이터가 없다" 가 아니라 "잘못 물어봤다" 였습니다.**
#: 근거는 페이지의 onReload()/onNextDay() 원문:
#:     document.form1.p_process.value = "Main"; document.form1.submit();  // post
#:     hidden std_ymd = 20260825   ← 하이픈 없음
DAY_RECORD_READ: dict[str, Any] = {
    "label": "수업일지 조회", "servlet": _DR, "method": "POST",
    "p_process": "Main",
    "params": ("p_process", "std_ymd", "grp_seq", "visit",
               "teacher_pri_no", "course_seq"),
    "date_format": "%Y%m%d",
    "table_class": "table_title",
    "note": "td 안 table 중첩이 깨져 있어 tr 순회가 실패합니다. "
            "표가 아니라 id='{필드}{행번호}' 규칙으로 뽑으세요.",
}

#: 길이 제한 — **서버 제약이 아닙니다** (실측 2026-08-25)
#:
#: 화면 JS 가 `reallength(value) > 400` 을 검사하지만 **클라이언트 검사일 뿐**이고,
#: 서버는 자르지 않습니다. 250자(reallength 500)를 보내 그대로 저장됨을 확인했습니다.
#:
#:     function reallength(t_str) {   // 실측 원문 (/js/common_function.js)
#:         if (ch.charCodeAt(0) < 32)  continue;   // 제어문자 0
#:         else if (ch.charCodeAt(0) > 128) len += 2;   // 비ASCII 2
#:         else len++;                                   // ASCII 1
#:     }
#:
#: EUC-KR 바이트 수가 아닙니다. 한글에서는 우연히 같지만 EUC-KR 밖 문자에서
#: 갈립니다. `𝑥 ⟂ ℝ ✔` 같은 문자도 무손실로 왕복합니다.
#:
#: 사용자 결정(2026-08-20): **제한 없음.** 게이트가 길이로 막지 않습니다.
#: 참고용으로 `soft_len` 에 화면 기준만 남깁니다.
LENGTH_LIMIT_ENFORCED = False


def reallength(text: str) -> int:
    """화면 JS 와 같은 길이 계산. **막는 데 쓰지 않고 알려주는 데만 씁니다.**"""
    return sum(0 if ord(c) < 32 else (2 if ord(c) > 128 else 1) for c in text or "")


#: 출결 드롭다운 실측값. **Y/N 만이 아닙니다 — L(지각) 이 있습니다.**
ATTENDANCE_VALUES: dict[str, str] = {
    " ": "선택", "Y": "출석", "N": "결석", "L": "지각",
}

#: 일일테스트 — **전송값과 화면 점수가 다릅니다.** (2026-08-25 실측)
#:
#: 선생님이 화면에서 "90점" 을 고르면 서버에는 **9** 가 저장됩니다.
#: 그대로 90 을 보내면 범위(0~10) 밖이라 거부되고,
#: 9 를 "9점" 으로 읽으면 학부모 리포트에 10점으로 나갑니다. 둘 다 사고입니다.
#:
#: 또한 **0 은 "0점" 이 아니라 "미실시"** 입니다.
#: 시험을 안 본 것과 0점을 맞은 것은 다른 사실이므로 섞으면 안 됩니다.
DAILY_TEST_SCALE: dict[int, str] = {
    -1: "미확인", 0: "미실시",
    1: "10점", 2: "20점", 3: "30점", 4: "40점", 5: "50점",
    6: "60점", 7: "70점", 8: "80점", 9: "90점", 10: "100점",
}

#: 숙제완성도 이미지 00.png~05.png. 라벨은 미확인 — 단정하지 않습니다.
HOMEWORK_RATE_RANGE: tuple[int, int] = (0, 5)


class DailyTestScaleError(ValueError):
    """일일테스트 점수를 전송값으로 바꿀 수 없음."""


def daily_test_to_wire(score: int | str) -> int:
    """선생님이 말하는 점수 → 서버 전송값.

    `90` / `"90점"` / `"미실시"` 를 전부 받습니다.
    **1~10 을 그대로 넘기면 거부합니다.** "9" 가 9점인지 90점인지 알 수 없기
    때문입니다. 애매하면 실패로 판정하는 것이 이 프로젝트의 규칙입니다.
    """
    raw = str(score).strip()
    #: "90점" 처럼 단위가 붙어 있으면 점수임이 확실합니다. 맨 숫자만 애매합니다.
    explicit = "점" in raw
    s = raw.replace("점", "").strip()

    if s in ("미확인", "-1", ""):
        return -1
    if s == "미실시":
        return 0
    try:
        n = int(s)
    except ValueError:
        raise DailyTestScaleError(f"알 수 없는 일일테스트 값: {score!r}") from None

    if n == 0:
        raise DailyTestScaleError(
            "0 은 '0점' 이 아니라 '미실시' 입니다. 화면에 0점이라는 선택지가 없고, "
            "시험을 안 봤으면 '미실시' 라고 쓰세요."
        )
    if not explicit and 1 <= n <= 10:
        raise DailyTestScaleError(
            f"{n} 이 {n}점인지 {n}0점인지 알 수 없습니다. "
            f"'{n}0점' 처럼 단위를 붙이거나 {n}0 이라고 쓰세요."
        )
    if n % 10 or not (10 <= n <= 100):
        raise DailyTestScaleError(
            f"일일테스트는 10점 단위 10~100점만 가능합니다: {score!r}"
        )
    return n // 10


def daily_test_to_label(wire: int | None) -> str:
    """서버 전송값 → 사람이 읽는 표기."""
    if wire is None:
        return "미입력"
    return DAILY_TEST_SCALE.get(int(wire), f"알 수 없음({wire})")

DAY_RECORD_WRITE: dict[str, dict[str, Any]] = {
    "progress": {
        "label": "진도", "servlet": _DR, "method": "GET",
        "reqCmd": "udtPrg", "field": "prg_txt", "soft_len": 400,
        "keys": ("course_seq", "stu_pri_no", "record_seq", "cm_seq"),
        "dummy": True,
    },
    "homework": {
        "label": "숙제", "servlet": _DR, "method": "GET",
        "reqCmd": "udtHw", "field": "hw_txt", "soft_len": 400,
        "keys": ("course_seq", "stu_pri_no", "record_seq", "cm_seq"),
        "dummy": True,
    },
    "memo": {
        "label": "메모", "servlet": _DR, "method": "GET",
        "reqCmd": "udtMemo", "field": "memo_txt", "soft_len": 400,
        "keys": ("course_seq", "stu_pri_no", "record_seq", "cm_seq"),
        "dummy": True,
    },
    "student_memo": {
        # 지속사항 — 날짜와 무관한 학생별 누적 메모. 파라미터 구성이 다릅니다.
        "label": "지속사항", "servlet": _DR, "method": "GET",
        "reqCmd": "udtStuMemo", "field": "stu_memo_txt", "soft_len": 4000,
        "keys": ("stu_pri_no", "course_seq"),
        "tutor_param": "tut_pri_no", "dummy": True,
    },
    "attendance": {
        "label": "금일출석", "servlet": _DR, "method": "GET",
        "reqCmd": "udtAttn", "field": "attn_yn",
        "keys": ("course_seq", "stu_pri_no", "record_seq", "cm_seq"),
        "dummy": True,
    },
    "daily_test": {
        "label": "일일테스트", "servlet": _CC, "method": "POST",
        "reqCmd": "SetDailyTest", "field": "daily_test_no",  # ← radio 아님
        "keys": ("cm_seq", "record_seq"), "tutor_param": "tutor_pri_no",
        "range": (0, 10),
    },
    "hw_rate": {
        "label": "숙제완성도", "servlet": _CC, "method": "POST",
        "reqCmd": "SetHomeWorkRate", "field": "homework_rate_no",
        "keys": ("cm_seq", "record_seq"), "tutor_param": "tutor_pri_no",
        "range": (0, 5),
    },
    "course_data": {
        # 진도를 자유텍스트가 아니라 대단원+소단원 드롭다운으로 지정하는 경로
        "label": "진도(단원선택)", "servlet": _CC, "method": "POST",
        "reqCmd": "SetCourseData", "field": "homework_memo", "soft_len": 400,
        "keys": ("record_seq", "stu_pri_no", "cm_seq"),
        "tutor_param": "tutor_pri_no",
    },
}

#: 하위호환 별칭 (구버전 코드가 참조)
DAY_RECORD_WRITE_UNVERIFIED = DAY_RECORD_WRITE

# ─────────────────────────────────────────────────────────────
# 알림톡 — ⛔ 자동 전송하지 않습니다 (2026-08-25 실측)
# ─────────────────────────────────────────────────────────────
"""
수업일지 각 행에 알림톡 아이콘이 있습니다. 페이지 JS 원문::

    var allReportSeqList = "3479920";
    var newReportSeqList = "3479920";

    window.onOneAlimtalk = function(reportSeq) {
        var url = "/alimtalk/send_studyreport_alimtalk.jsp"
                + "?all_report_seq_list="    + allReportSeqList
                + "&target_report_seq_list=" + reportSeq
                + "&report_date="            + reportDate;
        window.openAlimtalk(url);          // window.open — 팝업만 엽니다
    }

즉 아이콘 클릭 자체는 **발송이 아니라 발송 화면 열기**입니다.
실제 발송은 그 팝업 안에서 일어납니다.

⛔ 이 프로젝트는 그 팝업의 발송 버튼을 대신 누르지 않습니다.
   학부모 휴대폰으로 나가고 **회수가 안 되기** 때문입니다.
   승인 절차를 아무리 두껍게 쌓아도 잘못 나간 메시지는 못 되돌립니다.
   그래서 승인을 늘리는 대신 **행위를 넘깁니다** — URL 을 만들어 드리고
   마지막 버튼은 선생님이 누릅니다. (사용자 지시, 2026-08-20)

아이콘 상태 (title 속성 실측)
    sr-alimtalk-ready.png  "알림톡 미발송"
"""
ALIMTALK: dict[str, Any] = {
    "page": "/alimtalk/send_studyreport_alimtalk.jsp",
    "params": ("all_report_seq_list", "target_report_seq_list", "report_date"),
    "auto_send": False,
    "note": "회수 불가. 최종 버튼은 사람이 누릅니다.",
}


def alimtalk_url(*, target_report_seqs: list[str] | str,
                 all_report_seqs: list[str] | str,
                 report_date: str) -> str:
    """알림톡 **발송 화면** URL 을 만듭니다. 전송하지 않습니다.

    `report_date` 는 하이픈 있는 형식입니다 (`2026-08-25`) — 수업일지 조회의
    `std_ymd` 와 반대라 헷갈리기 쉽습니다. JS 원문 그대로입니다.
    """
    def _join(v: list[str] | str) -> str:
        return ",".join(str(x) for x in v) if isinstance(v, (list, tuple)) else str(v)

    if not target_report_seqs:
        raise ValueError("발송 대상 report_seq 가 없습니다")
    return (f"{BASE_URL}{ALIMTALK['page']}"
            f"?all_report_seq_list={_join(all_report_seqs)}"
            f"&target_report_seq_list={_join(target_report_seqs)}"
            f"&report_date={report_date}")


#: Study Report / 엑셀 — 읽기 전용 산출물
DAY_RECORD_REPORTS: dict[str, dict[str, Any]] = {
    "daily_report": {
        "label": "Study Report", "servlet": _CC, "method": "GET",
        "reqCmd": "DailyReport",
        "keys": ("report_seq", "stu_pri_no", "record_seq", "cm_seq"),
        "extra": ("tutor_pri_no", "the_date"),
        "note": "팝업. 학부모 발송용 단축 URL 을 여기서 복사합니다.",
    },
    "daily_report_excel": {
        "label": "데일리리포트 엑셀", "servlet": _CC, "method": "GET",
        "reqCmd": "DailyReportExcel", "keys": (),
        "note": "금일진도 열 머리의 엑셀 아이콘. 반 전체 일괄 내려받기로 추정.",
    },
    "cism_chart": {
        "label": "교무회의 CISM 차트", "servlet": _CC, "method": "GET",
        "reqCmd": "CismChartMain", "keys": (),
    },
}

#: 수업일지 1행을 '빠짐없이' 채웠다고 보려면 필요한 항목
#: (성공기준이 "빠뜨리지 않는 것" 이므로 완결성 게이트의 기준표가 됩니다)
DAY_RECORD_REQUIRED: tuple[str, ...] = (
    "attendance", "daily_test", "progress", "homework", "memo",
)

# ─────────────────────────────────────────────────────────────
# 수업일정관리 — 결석/보강 처리 (실측)
# ─────────────────────────────────────────────────────────────
#: 캘린더는 드래그가 아니라 **선택 → 하단 폼 → 버튼** 방식입니다.
#: onSel 로 일정을 고르면 record_seq/cm_seq 가 폼에 채워지고,
#: 변경날짜(tdate)·반(chn_grp)·담당(tutor_pri_no)을 정한 뒤 버튼을 누릅니다.
SCHEDULE_ACTIONS: dict[str, dict[str, Any]] = {
    "select": {
        "label": "일정 선택", "method": "GET", "reqCmd": "SelSglRecord",
        "servlet": "controller.cct.tutor.CourseScheduleServlet",
        "keys": ("course_seq", "stu_pri_no", "record_seq", "sel_grp_seq",
                 "tut_pri_no", "cm_seq"),
    },
    "add": {
        "label": "보강 추가", "method": "POST", "p_process": "AddRecord",
        "servlet": "controller.cct.tutor.CourseScheduleServlet",
        "note": "선택한 일정을 tdate 날짜에 **추가**. 원래 일정은 남습니다.",
    },
    "move": {
        "label": "일정 이동", "method": "POST", "p_process": "UdtRecord",
        "servlet": "controller.cct.tutor.CourseScheduleServlet",
        "note": "선택한 일정을 tdate 날짜로 **옮깁니다**.",
    },
    "delete": {
        "label": "일정 삭제", "method": "POST", "p_process": "DelRecord",
        "servlet": "controller.cct.tutor.CourseScheduleServlet",
    },
    "check": {
        "label": "출결 확정", "method": "POST", "p_process": "CheckRecord",
        "servlet": "controller.cct.tutor.CourseScheduleServlet",
    },
}

# ─────────────────────────────────────────────────────────────
# 주간 교무회의 CISM — 주단위 필수 입력 (실측 2026-08-20)
# ─────────────────────────────────────────────────────────────
#: 진입: CourseCommonServlet?reqCmd=CismChartMain&tutor_pri_no=&the_date=
#: 저장: 수업일지와 같은 blur-autosave 방식. textarea 에서 포커스가 빠지면 전송.
#:
#:   POST /servlet/controller.cct.common.CourseCommonServlet
#:     reqCmd=SetCismContentData&tutor_pri_no=&the_date=
#:     &field_name=<아래 8개 중 하나>&field_value=<본문>
#:
#: 별도로 `SetCismChartData` 가 통계 블록을 JSON 으로 받습니다
#: (makeCISMJSonData 가 조립. 예습영상 별점 수행률 등)
CISM_FIELDS: dict[str, str] = {
    "i_1": "칭찬 대상 학생",
    "i_2": "학기진도 완료 학생 / 인증평가 점수",
    "s_1": "신입생 적응정도",
    "s_2": "학습부진아 지도",
    "s_3": "특이사항 학생",
    "s_4": "학부모상담 특이사항",
    "m_1": "월별행사, 이벤트",
    "m_2": "내신대비·방학특강 준비사항",
}

CISM_ACTIONS: dict[str, dict[str, Any]] = {
    "open": {
        "label": "CISM 작성 화면", "method": "GET", "servlet": _CC,
        "reqCmd": "CismChartMain", "keys": ("tutor_pri_no", "the_date"),
    },
    "save_field": {
        "label": "항목 저장", "method": "POST", "servlet": _CC,
        "reqCmd": "SetCismContentData",
        "keys": ("tutor_pri_no", "the_date", "field_name", "field_value"),
    },
    "save_chart": {
        "label": "보고서 통계 저장", "method": "POST", "servlet": _CC,
        "reqCmd": "SetCismChartData",
        "note": "makeCISMJSonData() 가 만든 JSON. 통계 블록 6개.",
    },
}

#: 강사가 서버에 **반드시** 입력해야 하는 것들의 주기
#: (자동화 우선순위의 근거. 이 외의 기능은 강사 요청 시에만 만듭니다.)
ROUTINE_CADENCE: dict[str, dict[str, Any]] = {
    "day_record": {
        "label": "수업일지", "cadence": "일 (수업일마다)",
        "fields": DAY_RECORD_REQUIRED,
        "note": "학생별 5항목. 학부모 데일리리포트로 나감.",
    },
    "cism": {
        "label": "주간 교무회의 CISM", "cadence": "주 (주차 단위)",
        "fields": tuple(CISM_FIELDS),
        "note": "8항목 서술. 한 주치 수업일지·DT결과·진도에서 대부분 도출 가능.",
    },
    "dt_zt": {
        "label": "DT / ZT", "cadence": "일 (출석 직후)",
        "note": "학생이 등원해 출석하면 바로 보는 시험. 결과 확인 필요.",
    },
    "fa_na": {
        "label": "형성평가 / 수시평가", "cadence": "수시 (필요할 때)",
        "note": "정기 루틴 아님. 출제가 필요할 때만.",
    },
}

#: 일정관리 폼 필드 (실측)
SCHEDULE_FORM_FIELDS: tuple[str, ...] = (
    "record_seq", "cm_seq", "course_seq", "stu_pri_no", "sel_grp_seq",
    "chn_grp",        # 변경할 반
    "tutor_pri_no",   # 변경할 담당 강사
    "tdate", "tymd",  # 변경 날짜
    "fdate", "fymd",  # 원래 날짜
    "status",         # 수업 상태
    "attdn",          # 출결 상태
    "stu_memo", "course_nm", "week",
)

#: 학년분류 코드 (DT/ZT 화면 드롭다운 실측)
GRADE_CODES: dict[str, str] = {
    "[22개정] 초3": "133", "[22개정] 초4": "132", "[22개정] 초5": "154",
    "[22개정] 초6": "151", "[22개정] 중1": "124", "[22개정] 중2": "148",
    "[22개정] 중3": "157", "[22개정] 공통수학1": "127", "[22개정] 공통수학2": "136",
    "[22개정] 대수": "143", "[22개정] 미적분Ⅰ": "144", "[22개정] 확률과통계": "145",
    "중3": "121", "수학(상)": "106", "수학(하)": "107",
    "초3": "117", "초4": "110", "초5": "113", "초6": "111", "중1": "105", "중2": "108",
}


def all_endpoints() -> list[Endpoint]:
    """전체 엔드포인트를 평탄화해서 반환 (자가진단용)."""
    out: list[Endpoint] = []
    for group in (TABS, COURSE, STUDY, TESTPOOL, SMARTBOOK, USER):
        out.extend(group.values())
    for kind in ("fa", "na", "da"):
        out.extend(exam_endpoints(kind).values())  # type: ignore[arg-type]
    return out


def unverified() -> list[Endpoint]:
    """검증되지 않은 엔드포인트만 추립니다. 자동화 전 반드시 확인하세요."""
    return [e for e in all_endpoints() if not e.verified]
