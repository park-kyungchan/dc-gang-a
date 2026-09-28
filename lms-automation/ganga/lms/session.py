# -*- coding: utf-8 -*-
"""
LMS 세션 획득 및 검증.

핵심 원칙 3가지
  1. **세션 쿠키를 디스크에 절대 쓰지 않는다.** 이 저장소는 public 이며,
     과거 config/config.json 에 커밋된 JSESSIONID 가 그대로 공개된 사고가 있었다.
  2. **HTTP 200 을 성공으로 믿지 않는다.** dc.gang-a.kr 은 JSP 서블릿이라
     세션이 만료돼도 200 + 로그인 HTML 을 돌려준다. 본문을 봐야 한다.
  3. 쿠키 획득은 사용자 손이 가장 덜 가는 순서로 자동 폴백한다.

쿠키 획득 3모드
  browser  : 로컬 크롬 프로필에서 JSESSIONID 를 직접 읽음. 사용자가 이미
             로그인해 있으면 F12 복붙이 아예 필요 없다. (권장)
  env      : 환경변수 GANGA_JSESSIONID. 파일에 남지 않는다.
  manual   : 대화형 입력. 마지막 수단.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Iterator, Literal

from scrapling.fetchers import FetcherSession

from .endpoints import BASE_URL, TABS

CookieSource = Literal["browser", "env", "manual"]

ENV_VAR = "GANGA_JSESSIONID"

_DEFAULT_HEADERS = {
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Referer": f"{BASE_URL}/first/c_main.jsp",
}


class SessionExpired(RuntimeError):
    """JSESSIONID 가 만료됐거나 유효하지 않음."""


@dataclass
class TeacherInfo:
    """로그인한 강사의 서버측 식별자. 페이지 hidden input 에서 추출."""

    fran_no: str = ""
    pri_no: str = ""
    mem_type: str = ""
    name: str = ""

    @property
    def is_complete(self) -> bool:
        return bool(self.fran_no and self.pri_no)


# ─────────────────────────────────────────────────────────────
# 쿠키 획득
# ─────────────────────────────────────────────────────────────
def cookie_from_env() -> str | None:
    v = (os.environ.get(ENV_VAR) or "").strip()
    return v or None


def cookie_from_browser() -> str | None:
    """로컬 브라우저 쿠키 저장소에서 JSESSIONID 를 읽습니다.

    browser_cookie3 가 설치돼 있어야 합니다 (`pip install browser-cookie3`).
    사용자가 크롬에서 dc.gang-a.kr 에 로그인만 해두면 복붙이 불필요합니다.
    """
    try:
        import browser_cookie3  # type: ignore[import-not-found]
    except ImportError:
        return None

    loaders = []
    for name in ("chrome", "edge", "firefox", "brave", "chromium"):
        fn = getattr(browser_cookie3, name, None)
        if fn is not None:
            loaders.append(fn)

    for load in loaders:
        try:
            jar = load(domain_name="dc.gang-a.kr")
        except Exception:
            continue
        for c in jar:
            if c.name == "JSESSIONID" and c.value:
                return c.value
    return None


def cookie_from_input() -> str | None:
    print(
        "\n[JSESSIONID 입력]\n"
        "  1) 크롬에서 dc.gang-a.kr 로그인\n"
        "  2) F12 → Application → Cookies → dc.gang-a.kr → JSESSIONID 값 복사\n"
        "  ※ 이 값은 파일에 저장되지 않고 이 프로세스 메모리에만 남습니다.\n"
    )
    try:
        v = input("JSESSIONID: ").strip()
    except (EOFError, KeyboardInterrupt):
        return None
    return v or None


def resolve_cookie(order: tuple[CookieSource, ...] = ("browser", "env", "manual")) -> str:
    """지정한 순서대로 쿠키 획득을 시도합니다."""
    getters = {
        "browser": cookie_from_browser,
        "env": cookie_from_env,
        "manual": cookie_from_input,
    }
    tried: list[str] = []
    for src in order:
        val = getters[src]()
        tried.append(src)
        if val:
            return val
    raise SessionExpired(
        f"JSESSIONID 를 찾지 못했습니다 (시도: {', '.join(tried)}). "
        f"크롬에서 dc.gang-a.kr 에 로그인했는지 확인하거나 "
        f"환경변수 {ENV_VAR} 를 설정하세요."
    )


# ─────────────────────────────────────────────────────────────
# 세션 유효성 판정 — 200 을 믿지 않는다
# ─────────────────────────────────────────────────────────────
#: 세션 만료를 나타내는 확정 신호
_EXPIRED_MARKERS = ("normal_session_error", "session_error", "로그인이 필요")

#: 로그인 폼 자체가 렌더된 경우 (비밀번호 입력란 존재)
_LOGIN_FORM = re.compile(r'<input[^>]+type=["\']password["\']', re.I)

#: 정상 로그인 상태의 공통 프레임에만 나타나는 신호.
#: ⚠️ 팝업 화면(수업일지·상담관리 등)에는 이 프레임이 없으므로
#:    "이게 있어야 인증됨" 으로 쓰면 정상 페이지를 만료로 오판합니다.
_AUTHED_MARKERS = ("로그아웃", "TutorMenuIndexServlet")

#: 이보다 짧은 응답은 정상 화면으로 보지 않습니다.
_MIN_BODY = 200


def is_authenticated(html: str) -> bool:
    """응답 본문만으로 세션 유효성을 판정합니다.

    판정 규칙은 **부정 신호 중심**입니다. 긍정 신호(로그아웃 링크 등)를
    필수 조건으로 걸면 팝업 화면에서 오판이 납니다 — 실측으로 확인했습니다.
    (`DayRecordServlet?p_process=Main` 은 공통 헤더가 없는 독립 팝업입니다.)

    주의: 'LoginServlet' 문자열은 **로그아웃 링크에도** 들어 있으므로
    세션 만료 신호로 쓰면 안 됩니다. (실측 확인된 오탐 원인)
    """
    if not html or len(html) < _MIN_BODY:
        return False
    low = html.lower()
    if any(m.lower() in low for m in _EXPIRED_MARKERS):
        return False
    if _LOGIN_FORM.search(html):
        return False
    return True


def has_common_frame(html: str) -> bool:
    """공통 네비게이션 프레임이 있는 페이지인지 (팝업 판별용)."""
    return any(m in html for m in _AUTHED_MARKERS)


_HIDDEN = re.compile(
    r'<input[^>]+name=["\'](fran_no|pri_no|mem_type)["\'][^>]*value=["\']([^"\']*)["\']',
    re.I,
)


def parse_teacher_info(html: str) -> TeacherInfo:
    info = TeacherInfo()
    for name, value in _HIDDEN.findall(html):
        setattr(info, name.lower(), value)
    # 강사 이름은 c_main.jsp 의 <a class="user-name"> 안에 '박경찬-' 형태로 들어갑니다.
    # '[로그아웃]' 은 별도 span 이라 사이에 태그가 끼므로 인접 매칭은 실패합니다.
    m = re.search(r'class="user-name"[^>]*>\s*([가-힣]{2,5})\s*-?\s*<', html)
    if m:
        info.name = m.group(1)
    return info


# ─────────────────────────────────────────────────────────────
# 세션 래퍼
# ─────────────────────────────────────────────────────────────
class LmsSession:
    """scrapling FetcherSession 위에 세션검증을 얹은 얇은 래퍼.

    사용 예::

        with LmsSession() as lms:
            page = lms.get(COURSE["schedule"].url)
    """

    def __init__(
        self,
        cookie: str | None = None,
        *,
        order: tuple[CookieSource, ...] = ("browser", "env", "manual"),
        impersonate: str = "chrome131",
        timeout: int = 25,
        retries: int = 2,
    ) -> None:
        self._cookie = cookie or resolve_cookie(order)
        self._impersonate = impersonate
        self._timeout = timeout
        self._retries = retries
        self._ctx: FetcherSession | None = None
        self._session = None
        self.teacher = TeacherInfo()

    # -- 컨텍스트 매니저 -------------------------------------------------
    def __enter__(self) -> "LmsSession":
        self._ctx = FetcherSession(
            impersonate=self._impersonate,
            headers=dict(_DEFAULT_HEADERS),
            timeout=self._timeout,
            retries=self._retries,
        )
        # 주의: FetcherSession.__enter__() 는 self 가 아니라 내부 세션 객체를
        # 돌려줍니다. 반환값을 버리면 .get/.post 를 쓸 수 없습니다.
        self._session = self._ctx.__enter__()
        self.validate()
        return self

    def __exit__(self, *exc) -> None:
        if self._ctx is not None:
            self._ctx.__exit__(*exc)
            self._ctx = None
            self._session = None

    # -- 요청 -----------------------------------------------------------
    @property
    def cookies(self) -> dict[str, str]:
        return {"JSESSIONID": self._cookie}

    def _require(self):
        if self._session is None:
            raise RuntimeError("LmsSession 은 with 문 안에서 사용하세요.")
        return self._session

    def get(self, url: str, *, check: bool = True, **kw):
        resp = self._require().get(url, cookies=self.cookies, **kw)
        if check:
            self._assert_authed(resp, url)
        return resp

    def post(self, url: str, *, data: dict | None = None, check: bool = True, **kw):
        resp = self._require().post(url, cookies=self.cookies, data=data or {}, **kw)
        if check:
            self._assert_authed(resp, url)
        return resp

    @staticmethod
    def _assert_authed(resp, url: str) -> None:
        if not is_authenticated(resp.html_content):
            raise SessionExpired(
                f"세션이 만료됐습니다 (HTTP {resp.status} 이지만 인증 실패). "
                f"요청: {url}\n브라우저에서 dc.gang-a.kr 에 다시 로그인하세요."
            )

    # -- 검증 -----------------------------------------------------------
    def validate(self) -> TeacherInfo:
        """세션을 검증하고 강사 식별자를 채웁니다.

        식별자(fran_no/pri_no)는 메뉴 페이지의 hidden input 에 있지만,
        강사 **이름**은 메뉴 페이지에 '내정보'로만 나오고 실제 이름은
        로그인 랜딩(`/first/c_main.jsp`)에 있습니다. 두 곳을 모두 봅니다.
        """
        resp = self.get(TABS["course"].url)
        self.teacher = parse_teacher_info(resp.html_content)
        if not self.teacher.name:
            landing = self.get(f"{BASE_URL}/first/c_main.jsp")
            self.teacher.name = parse_teacher_info(landing.html_content).name
        return self.teacher


def iter_sources() -> Iterator[tuple[str, bool]]:
    """진단용: 각 쿠키 소스가 값을 내놓는지 확인합니다. 값 자체는 노출하지 않습니다."""
    yield "browser", cookie_from_browser() is not None
    yield "env", cookie_from_env() is not None
