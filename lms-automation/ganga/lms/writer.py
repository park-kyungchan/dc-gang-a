# -*- coding: utf-8 -*-
"""
LMS 쓰기 어댑터 — 성공 판정과 역검증.

이전 구현의 치명적 결함
    results["progress_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

    dc.gang-a.kr 은 JSP 서블릿이라 **세션이 만료돼도 200** 을 돌려줍니다.
    따라서 위 코드는 아무것도 저장되지 않았을 때도 "OK" 를 보고합니다.
    학부모에게 나가는 데일리리포트가 걸린 경로에서 이건 그냥 오작동입니다.

여기서 하는 것
    1. 게이트를 통과하지 않은 페이로드는 전송 자체가 불가능 (타입 수준에서 차단)
    2. 전송 후 **응답 본문**으로 성공 판정
    3. 그 다음 서버에서 **다시 읽어** 내가 쓴 값이 실제로 들어갔는지 대조
    4. dry_run 기본값 True — 실수로 실서버에 쓰는 일이 없게
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from ..pipeline.gates import GateResult, gate_day_record
from .endpoints import BASE_URL, DAY_RECORD_WRITE_UNVERIFIED
from .session import LmsSession, is_authenticated


class WriteStatus(str, Enum):
    OK = "OK"                    # 전송 + 역검증 모두 성공
    SENT_UNVERIFIED = "SENT_UNVERIFIED"   # 전송은 됐으나 역검증 못 함
    REJECTED = "REJECTED"        # 게이트에서 차단
    FAILED = "FAILED"            # 서버가 거부
    SESSION_EXPIRED = "SESSION_EXPIRED"
    DRY_RUN = "DRY_RUN"          # 실제로 보내지 않음


@dataclass
class WriteResult:
    field_name: str
    status: WriteStatus
    detail: str = ""
    sent: Any = None
    observed: Any = None

    @property
    def ok(self) -> bool:
        return self.status is WriteStatus.OK

    def __str__(self) -> str:
        return f"[{self.status.value}] {self.field_name}: {self.detail}"


@dataclass
class WriteReport:
    results: list[WriteResult] = field(default_factory=list)
    gate: GateResult | None = None

    @property
    def all_ok(self) -> bool:
        return bool(self.results) and all(r.ok for r in self.results)

    @property
    def failures(self) -> list[WriteResult]:
        return [r for r in self.results if not r.ok]

    def summary(self) -> str:
        if self.gate and not self.gate.ok:
            return "게이트 차단: " + "; ".join(self.gate.errors)
        n_ok = sum(1 for r in self.results if r.ok)
        return f"{n_ok}/{len(self.results)} 성공" + (
            f" | 실패: {', '.join(r.field_name for r in self.failures)}"
            if self.failures else ""
        )


# ─────────────────────────────────────────────────────────────
# 응답 본문 기반 성공 판정
# ─────────────────────────────────────────────────────────────
#: 부정문 — 성공 마커보다 **먼저** 검사해야 합니다.
#: "저장되지 않았습니다" 는 '저장'으로 시작하므로 순진한 startswith 로는
#: 성공으로 오판됩니다. (독립 검증에서 실제로 재현된 결함)
_NEGATION = re.compile(
    r"(않|못|없|실패|불가|오류|에러|error|fail|invalid|denied|expired)", re.I
)

#: 서버가 실패를 알리는 신호
_FAIL_MARKERS = ("실패", "오류", "alert(", "exception", "error")

#: 서버가 성공을 알리는 신호 — **응답 전체가** 이 값과 정확히 일치할 때만 인정.
#: startswith 로 느슨하게 보면 "1724054400000"(타임스탬프)이나
#: "1001 Unauthorized" 같은 응답이 성공으로 새어 들어옵니다.
_SUCCESS_EXACT = frozenset({"success", "ok", "true", "y", "1", "저장되었습니다", "저장완료"})

#: 이보다 길면 평문 상태응답이 아니라 페이지로 봅니다.
_MAX_PLAIN_RESPONSE = 200

#: 세션 만료의 **긍정적** 증거. 짧은 리다이렉트 페이지도 잡히도록
#: 길이 조건을 걸지 않습니다.
_EXPIRED_EVIDENCE = re.compile(
    r'normal_session_error|session_error|로그인이\s*필요|'
    r'<input[^>]+type=["\']password["\']|location\.href\s*=\s*["\'][^"\']*LoginServlet',
    re.I,
)


def is_session_expired(body: str) -> bool:
    """응답이 '세션 만료/로그인 페이지'라는 긍정적 증거가 있는지."""
    return bool(_EXPIRED_EVIDENCE.search(body or ""))


# ─────────────────────────────────────────────────────────────
# 쓰기 응답 규약 — ✅ 2026-08-25 실측 (성공 1건 + 실패 3건 대조)
# ─────────────────────────────────────────────────────────────
"""
오랫동안 "성공/실패 샘플을 못 구했다" 로 남아 있던 항목입니다.
첫 실전송 후, 존재하지 않는 키로 같은 요청을 보내 실패 응답을 모았습니다
(없는 학생에 대한 UPDATE 는 0행 갱신이라 실제 데이터에 닿지 않습니다).

    요청                        HTTP   본문
    ─────────────────────────  ────  ──────────────────────────────
    정상 (키 전부 맞음)            200   <html><body>\\x01</body></html>
    없는 학생 (stu_pri_no=0)     200   <html></html>
    없는 회차 (record_seq=99)    200   <html></html>
    없는 cm_seq                 200   <html></html>
    키 전부 빈값                  200   error.jsp 로 자동 submit 하는 폼

읽는 법

    본문에 **\\x01 이 있으면 성공**입니다. 갱신된 행 수로 보입니다.
    `<body>` 자체가 없으면(=`<html></html>`) **실패**입니다.
    HTTP 는 넷 다 200 입니다. 이 프로젝트가 200 을 안 믿는 이유입니다.

⚠️ 그래도 역검증(G16)은 계속 돌립니다. 응답 규약이 맞더라도 "서버가 뭘
   저장했는지" 는 다시 읽어야 압니다. 값이 잘려 들어가는 경우(200자 제한)는
   \\x01 이 와도 내가 보낸 것과 다릅니다.
"""
#: 성공 표식 — 본문에 들어오는 제어문자
SUCCESS_BYTE = "\x01"

#: 실패 — 서버 오류 페이지로 넘기는 폼
_ERROR_PAGE = re.compile(r"error\.jsp|errform", re.I)

_TAGS = re.compile(r"<[^>]*>")
_BODY_OPEN = re.compile(r"<body\b", re.I)
_BODY_PAIR = re.compile(r"<body[^>]*>(.*?)</body>", re.I | re.S)


def is_empty_shell(body: str) -> bool:
    """태그와 공백을 걷어내면 아무 내용도 없는 응답인지."""
    return not _TAGS.sub("", body or "").strip()


def response_body_text(html: str) -> str | None:
    """`<body>` 안의 내용. `<body>` 태그 **자체가 없으면** None.

    **None 과 빈 문자열은 다릅니다.**

        <html></html>                    → None   body 태그 없음  = 실패
        <html><body></body></html>       → ""     body 는 있고 빔 = 판정 불가
        <html><body>\\x01</body></html>   → "\\x01" 성공

    자기닫는 `<body/>` 도 "있고 빈 것" 으로 봅니다. 없는 것과 다릅니다.
    """
    text = html or ""
    if not _BODY_OPEN.search(text):
        return None
    m = _BODY_PAIR.search(text)
    return m.group(1) if m else ""


def judge_response(html: str) -> tuple[bool | None, str]:
    """응답 본문으로 저장 성공 여부를 판정합니다. **3값 판정**입니다.

        True  = 확실히 성공
        False = 확실히 실패      ← 역검증이 통과해도 실패로 봅니다
        None  = 판정 불가        ← 역검증(G16)이 결정합니다

    한때 이 함수가 `bool` 만 돌려줬고, 판정 불가를 `False` 로 접었습니다.
    그래서 **첫 실전송에서 값이 실제로 들어갔는데도 저널에 FAILED 로**
    남았습니다(2026-08-25). 서버가 빈 본문을 주기 때문입니다.

    "실패를 성공으로 읽지 않는다" 는 원칙은 유지하되, **모른다는 것을
    실패라고 우기지도 않습니다.** 모르면 서버에서 다시 읽어 확인합니다.
    """
    body = (html or "").strip()
    if not body:
        return None, "빈 응답 — 역검증으로만 판단 가능"

    # 1) 세션 만료 — **긍정적 증거**로만 판정합니다.
    #    is_authenticated() 는 최소 길이 200자를 요구하므로, "OK" 같은 정상
    #    평문 응답까지 만료로 오판합니다. 여기서는 만료 신호 자체를 봅니다.
    if is_session_expired(body):
        return False, "세션 만료 또는 로그인 페이지가 반환됨"

    # 1-a) 서버 오류 페이지로 넘기는 폼 — 키가 아예 비었을 때 옵니다
    if _ERROR_PAGE.search(body):
        return False, "서버 오류 페이지(error.jsp)로 리다이렉트됨 — 파라미터 확인"

    # 1-b) 이 서버의 쓰기 응답 규약 (실측)
    inner = response_body_text(body)
    if inner is None and body.lower().replace(" ", "").startswith("<html>"):
        return False, "본문(<body>) 없이 껍데기만 왔습니다 — 갱신된 행이 없습니다"
    if inner is not None and SUCCESS_BYTE in inner:
        return True, "성공 표식(\\x01) 확인"

    low = body.lower()

    # 2) 부정문 우선 — "저장되지 않았습니다" 를 성공으로 읽지 않기 위해
    if _NEGATION.search(body):
        return False, f"부정/실패 표현 감지: {body[:120]}"

    # 3) 명시적 실패 마커
    if any(m in low for m in _FAIL_MARKERS):
        return False, f"실패 신호 감지: {body[:120]}"

    # 4) 성공은 완전 일치만 인정하고, 그것도 짧은 평문일 때만
    if len(body) <= _MAX_PLAIN_RESPONSE and low in _SUCCESS_EXACT:
        return True, "성공 응답"

    # 5) 내용 없는 껍데기 — 실측된 정상 응답 형태이지만 증거는 아닙니다
    if is_empty_shell(body):
        return None, "빈 본문(이 서버의 정상 응답 형태) — 역검증으로만 판단 가능"

    return None, f"판정 불가 응답({len(body)}자): {body[:120]}"


# ─────────────────────────────────────────────────────────────
# 수업일지 writer
# ─────────────────────────────────────────────────────────────
class DayRecordWriter:
    """수업일지 쓰기.

    사용 예::

        with LmsSession() as lms:
            w = DayRecordWriter(lms, dry_run=True)
            report = w.write(payload, date="2026-08-19", grp_seq="12")
            print(report.summary())
    """

    def __init__(
        self,
        lms: LmsSession,
        *,
        dry_run: bool = True,
        verify_writeback: bool = True,
        max_writes: int = 50,
        pause: float = 0.3,
    ) -> None:
        self.lms = lms
        self.dry_run = dry_run
        self.verify_writeback = verify_writeback
        self.max_writes = max_writes
        self.pause = pause
        self._written = 0

    # -- 공개 API -------------------------------------------------------
    def write(
        self,
        payload: dict[str, Any],
        *,
        date: str,
        grp_seq: str,
        strict: bool = True,
    ) -> WriteReport:
        gate = gate_day_record(payload, strict=strict)
        report = WriteReport(gate=gate)
        if not gate.ok:
            report.results.append(
                WriteResult("(전체)", WriteStatus.REJECTED, "; ".join(gate.errors))
            )
            return report

        clean = gate.value
        for name, spec in DAY_RECORD_WRITE_UNVERIFIED.items():
            key = _PAYLOAD_KEY[name]
            if key not in clean:
                continue
            report.results.append(self._send_one(name, spec, key, clean))

        if self.verify_writeback and not self.dry_run:
            self._verify(report, clean, date=date, grp_seq=grp_seq)
        return report

    # -- 내부 -----------------------------------------------------------
    def _send_one(self, name: str, spec: dict[str, Any], key: str,
                  clean: dict[str, Any]) -> WriteResult:
        value = clean[key]

        if self._written >= self.max_writes:
            return WriteResult(name, WriteStatus.FAILED,
                               f"안전 한도 초과 (max_writes={self.max_writes})")

        # 동작마다 필요한 키가 다릅니다. 전부 싸잡아 보내지 않습니다.
        data: dict[str, Any] = {"reqCmd": spec["reqCmd"], spec["field"]: value}
        for k in spec.get("keys", ()):
            data[k] = clean.get(k, "")
        # 필드마다 강사번호 파라미터 이름이 다릅니다.
        # 지속사항만 `tut_pri_no`, 나머지는 `tutor_pri_no`.
        tp = spec.get("tutor_param")
        if tp:
            data[tp] = self.lms.teacher.pri_no
        if spec.get("dummy"):
            data["dummy"] = str(time.time())

        # spec['servlet'] 은 패키지 경로를 포함한 전체 이름입니다.
        url = f"{BASE_URL}/servlet/{spec['servlet']}"

        if self.dry_run:
            return WriteResult(name, WriteStatus.DRY_RUN,
                               f"{spec.get('method','POST')} /servlet/{spec['servlet']} ({spec['reqCmd']})",
                               sent=value)

        try:
            # 사이트가 쓰는 메서드를 그대로 따릅니다.
            # 진도/숙제/메모/출석은 GET, 점수류는 POST 입니다(실측).
            # 임의로 바꾸면 서블릿이 파라미터를 못 읽을 수 있습니다.
            if spec.get("method", "POST").upper() == "GET":
                resp = self.lms.get(url, params=data, check=False)
            else:
                resp = self.lms.post(url, data=data, check=False)
        except Exception as exc:  # noqa: BLE001
            return WriteResult(name, WriteStatus.FAILED, f"전송 예외: {exc}", sent=value)

        self._written += 1
        time.sleep(self.pause)

        ok, detail = judge_response(resp.html_content)
        if not ok and "세션" in detail:
            return WriteResult(name, WriteStatus.SESSION_EXPIRED, detail, sent=value)
        return WriteResult(
            name,
            WriteStatus.SENT_UNVERIFIED if ok else WriteStatus.FAILED,
            detail, sent=value,
        )

    #: 이보다 짧은 값은 문자열 포함 검색으로 신뢰할 수 없습니다.
    #: 출결 'Y', 점수 10 같은 값은 페이지 어디에나 우연히 존재합니다.
    MIN_VERIFIABLE_LEN = 12

    def _verify(self, report: WriteReport, clean: dict[str, Any],
                *, date: str, grp_seq: str) -> None:
        """서버에서 다시 읽어 실제 반영 여부를 대조합니다.

        두 가지 오탐을 막습니다 (독립 검증에서 실제로 재현된 것들).

        1. **짧은 값 오탐**: 'Y', 10, 5 같은 값은 어느 페이지에나 있습니다.
           문자열 포함 검색으로는 검증이 불가능하므로 UNVERIFIABLE 로 남깁니다.
        2. **학생 교차 오탐**: 페이지 전체를 평탄화해 grep 하면 *다른 학생* 행에
           있는 같은 템플릿 문장에 매칭됩니다. 반드시 대상 학생 행 안에서만
           찾아야 합니다.
        """
        from .reader import read_day_record

        try:
            page = read_day_record(self.lms, date=date, grp_seq=grp_seq)
        except Exception as exc:  # noqa: BLE001
            for r in report.results:
                if r.status is WriteStatus.SENT_UNVERIFIED:
                    r.detail += f" | 역검증 불가: 재조회 실패 ({exc})"
            return

        target_row = self._locate_row(page, clean)
        if target_row is None:
            for r in report.results:
                if r.status is WriteStatus.SENT_UNVERIFIED:
                    r.status = WriteStatus.FAILED
                    r.detail += (
                        " | 역검증 실패: 재조회 화면에서 대상 학생 행을 찾지 못함"
                    )
            return

        haystack = "\t".join(target_row)
        for r in report.results:
            if r.status is not WriteStatus.SENT_UNVERIFIED:
                continue
            sent = str(r.sent)

            if len(sent) < self.MIN_VERIFIABLE_LEN:
                # 짧은 값은 '통과'로 승격하지 않습니다. 모르는 것을 안다고 하지 않기.
                r.detail += (
                    f" | 역검증 불가: 값이 너무 짧아({len(sent)}자) 문자열 대조로는"
                    " 확인할 수 없음. 화면에서 직접 확인하세요."
                )
                continue

            if sent in haystack:
                r.status = WriteStatus.OK
                r.observed = sent[:60]
                r.detail = "역검증 통과 (대상 학생 행에서 확인)"
            else:
                r.status = WriteStatus.FAILED
                r.detail += " | 역검증 실패: 대상 학생 행에 값이 없음"

    @staticmethod
    def _locate_row(page, clean: dict[str, Any]) -> list[str] | None:
        """재조회한 화면에서 이번에 쓴 학생의 행을 특정합니다.

        식별키(stu_pri_no/record_seq)가 행 어딘가에 실려 있어야 합니다.
        찾지 못하면 None — 이 경우 역검증을 통과시키지 않습니다.
        """
        keys = [clean.get("stu_pri_no", ""), clean.get("record_seq", "")]
        keys = [k for k in keys if k]
        if not keys:
            return None
        for row in page.rows:
            joined = "\t".join(row)
            if any(k in joined for k in keys):
                return row
        return None


#: 게이트 출력 키 ↔ 엔드포인트 스펙 이름 매핑
_PAYLOAD_KEY: dict[str, str] = {
    "progress": "progress_text",
    "homework": "homework_text",
    "memo": "daily_memo",
    "attendance": "attendance",
    "daily_test": "dt_score",
    "hw_rate": "hw_rate",
}


def preflight(lms: LmsSession, *, date: str, grp_seq: str = "0") -> list[str]:
    """쓰기 전에 반드시 확인할 것들. 빈 리스트면 준비 완료.

    "쓰기 파라미터 미검증" 경고의 근거가 2026-08-20 에 바뀌었습니다.
    페이지 JS 원문(`onAttn`/`onFoPrg`/`setDailyTest`)에서 URL 조립을 그대로
    읽어냈으므로 **파라미터 자체는 확인됐습니다.**

    하지만 **왕복 성공은 아직 0건**입니다. 요청을 맞게 만드는 것과
    서버가 받아서 저장하는 것은 다른 문제이고, 이 사이트는 실패해도 200 을
    돌려줍니다. 그래서 경고를 지우지 않고 **문구만 사실에 맞게** 고칩니다.
    첫 전송 후 역검증(G16)이 통과하면 그때 이 항목이 사라집니다.
    """
    from .reader import read_day_record

    blockers: list[str] = []
    page = read_day_record(lms, date=date, grp_seq=grp_seq)
    if not page.has_groups:
        blockers.append(
            "학생그룹이 0개입니다. 수업관리 → 학생그룹관리에서 먼저 그룹을 만들고 "
            "학생을 편성해야 수업일지에 행이 생깁니다."
        )
    if not lms.teacher.is_complete:
        blockers.append("강사 식별자(fran_no/pri_no)를 페이지에서 추출하지 못했습니다.")
    if grp_seq != "0" and not page.records:
        blockers.append(
            f"{date} 에 이 그룹의 수업 행이 없습니다. 수업일이 아니거나 "
            f"편성이 아직 반영되지 않았습니다."
        )
    if not _round_trip_confirmed():
        blockers.append(
            "쓰기 왕복이 아직 1건도 검증되지 않았습니다. 파라미터는 페이지 JS "
            "원문으로 확인했지만(2026-08-20), 이 사이트는 실패해도 HTTP 200 을 "
            "주므로 첫 전송은 반드시 역검증(G16)과 함께 하세요."
        )
    return blockers


def _round_trip_confirmed() -> bool:
    """역검증(G16)까지 통과한 전송이 저널에 1건이라도 있는가.

    `result == "SENT"` 만 보면 안 됩니다. 역검증을 안 돌린 전송도 SENT 가 될
    수 있고, 이 사이트는 저장 실패에도 200 을 주기 때문입니다.
    """
    try:
        from ..governance import read_journal

        return any(e.get("verified") is True for e in read_journal(limit=500))
    except Exception:  # noqa: BLE001
        return False
