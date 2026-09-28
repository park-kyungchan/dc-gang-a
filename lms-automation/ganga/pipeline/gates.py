# -*- coding: utf-8 -*-
"""
결정론적 검증 게이트.

파이프라인 설계 원칙
    LLM 은 **문장만** 만든다. 전송·판정·검증은 전부 결정론적 코드가 한다.

    수집(READ)  →  생성(LLM)  →  게이트(여기)  →  전송(WRITE)  →  역검증(VERIFY)
     결정론적       비결정적       결정론적         결정론적        결정론적

이 모듈이 존재하는 이유
    이전 저장소에는 `sanitize_and_validate_payload()` 가 **테스트 파일 안에만**
    정의돼 있었고 실제 전송 코드(core/day_record_sync.py)는 그 함수를 부르지
    않았습니다. 즉 "적대적 V&V 테스트 통과"라는 커밋 메시지와 달리, 검증 로직은
    프로덕션 경로에 단 한 줄도 적용되지 않았습니다.
    이제 게이트는 여기 한 곳에만 있고, writer 는 게이트를 통과하지 않은
    페이로드를 아예 전송할 수 없습니다.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

from ..lms.endpoints import reallength

# ─────────────────────────────────────────────────────────────
# 한계값 — 서버 컬럼 제약에 맞춘 보수적 상한
# ─────────────────────────────────────────────────────────────
# 길이 — **자르지 않습니다.** (사용자 결정 2026-08-20)
#
# 화면 JS 가 `reallength(value) > 400` 을 검사하지만 **클라이언트 검사일 뿐**이고,
# 서버는 자르지 않습니다. 250자(reallength 500)를 보내 250자 그대로 저장되는 것을
# 실측했습니다.
#
# 한때 여기서 `s[:limit-1] + "…"` 로 잘라 놓고 `ok=True` 로 통과시켰습니다.
# **조용한 절단**입니다 — 경고는 붙지만 아무도 안 읽고, 선생님이 쓴 문장 뒷부분이
# 사라진 채 학부모 리포트로 나갑니다. 성공 기준이 "빠뜨리지 않는 것" 인데
# 게이트가 스스로 내용을 빠뜨리고 있었습니다.
#
# 이제 아래 값은 **화면 기준 안내용**입니다. 넘으면 경고만 하고 그대로 보냅니다.
SOFT_PROGRESS = 400
SOFT_HOMEWORK = 400
SOFT_MEMO = 400
#: 지속사항(udtStuMemo)만 화면 기준이 다릅니다.
SOFT_STUDENT_MEMO = 4000

#: 하위호환 별칭. 값이 바뀐 것에 주의 — 이제 **자르는 한도가 아니라 안내 기준**입니다.
MAX_PROGRESS = SOFT_PROGRESS
MAX_HOMEWORK = SOFT_HOMEWORK
MAX_MEMO = SOFT_MEMO
MAX_STUDENT_MEMO = SOFT_STUDENT_MEMO

DT_SCORE_RANGE = (0, 10)
HW_RATE_RANGE = (0, 5)

#: PUA(사설영역) 문자 — 교재 PDF 의 특수 수학 폰트가 여기 들어옵니다.
#: 서버로 보내면 깨지므로 반드시 걸러야 합니다.
_PUA = re.compile(r"[-]")

#: 제어문자 (탭/개행 제외)
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class GateError(ValueError):
    """게이트를 통과하지 못한 페이로드."""


@dataclass
class GateResult:
    """게이트 통과 결과. `ok=False` 면 절대 전송하지 않습니다."""

    ok: bool
    value: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def raise_if_failed(self) -> dict[str, Any]:
        if not self.ok:
            raise GateError("; ".join(self.errors))
        return self.value


# ─────────────────────────────────────────────────────────────
# 텍스트 정규화
# ─────────────────────────────────────────────────────────────
def normalize_text(raw: Any, *, limit: int, label: str) -> tuple[str, list[str]]:
    """텍스트를 서버 전송 가능한 형태로 정규화합니다.

    **선생님이 쓴 내용을 지우지 않습니다.** 여기서 하는 일은 두 가지뿐입니다.
      · 진짜 깨진 것을 걷어냄 (PDF 폰트 잔재 PUA, 제어문자) — 걷어내면 알려줌
      · 앞뒤 공백 정리

    자르지 않는 이유
        서버가 안 자릅니다(실측). 여기서 자르면 **우리만** 자르는 것이고,
        선생님이 쓴 문장 뒷부분이 학부모 리포트에서 사라집니다.

    가운데 공백을 뭉치지 않는 이유
        서버가 연속 공백과 탭을 그대로 보존합니다(실측 2026-08-25).
        여기서 뭉치면 보낸 것과 저장된 것이 달라져 **역검증(G16)이 실패**합니다.
        한때 `[ \\t]+ → ' '` 로 뭉치고 있었습니다.

    반환: (정규화된 문자열, 경고 목록)
    """
    warns: list[str] = []
    if raw is None:
        return "", warns
    s = str(raw)

    # 1. 유니코드 정규화 (NFC) — 한글 자모 분리 방지
    s = unicodedata.normalize("NFC", s)

    # 2. PUA 제거 — 교재 PDF 에서 복사하면 딸려 오는 깨진 글리프
    if _PUA.search(s):
        n = len(_PUA.findall(s))
        s = _PUA.sub("", s)
        warns.append(f"{label}: PUA 특수문자 {n}자 제거됨 (교재 PDF 폰트 잔재)")

    # 3. 제어문자 제거 — 제거했으면 반드시 알립니다. 조용한 수정이 문제입니다.
    if _CTRL.search(s):
        n = len(_CTRL.findall(s))
        s = _CTRL.sub("", s)
        warns.append(f"{label}: 제어문자 {n}자 제거됨")

    # 4. 앞뒤 공백만 정리. 가운데는 손대지 않습니다.
    s = s.strip()

    # 5. 길이 — **자르지 않고 알려만 줍니다.**
    if limit and reallength(s) > limit:
        warns.append(
            f"{label}: 화면 기준({limit})을 넘습니다 — "
            f"{len(s)}자 / 화면단위 {reallength(s)}. 자르지 않고 그대로 보냅니다"
        )

    return s, warns


def clamp_int(raw: Any, lo: int, hi: int, label: str) -> tuple[int | None, list[str]]:
    """정수를 범위 안으로 강제합니다. 파싱 실패 시 None (= 전송 안 함)."""
    warns: list[str] = []
    try:
        v = int(str(raw).strip())
    except (TypeError, ValueError):
        return None, [f"{label}: 정수로 해석 불가({raw!r}) — 전송에서 제외"]
    if v < lo or v > hi:
        warns.append(f"{label}: {v} → {max(lo, min(hi, v))} 로 보정 (허용 {lo}~{hi})")
        v = max(lo, min(hi, v))
    return v, warns


# ─────────────────────────────────────────────────────────────
# 수업일지 페이로드 게이트
# ─────────────────────────────────────────────────────────────
#: 서버 행을 특정하는 키. 하나라도 비면 엉뚱한 학생에게 쓸 위험이 있습니다.
REQUIRED_KEYS = ("course_seq", "stu_pri_no", "record_seq", "cm_seq")


def gate_day_record(payload: dict[str, Any], *, strict: bool = True) -> GateResult:
    """수업일지 전송 페이로드를 검증·정규화합니다.

    strict=True 면 식별키가 하나라도 비었을 때 실패시킵니다.
    (이전 구현은 빈 문자열이어도 그대로 전송했습니다.)
    """
    errors: list[str] = []
    warnings: list[str] = []
    out: dict[str, Any] = {}

    # 1) 행 식별키 — 여기가 틀리면 다른 학생 기록을 덮어씁니다
    for k in REQUIRED_KEYS:
        v = str(payload.get(k, "") or "").strip()
        if not v:
            (errors if strict else warnings).append(f"식별키 누락: {k}")
        elif not v.isdigit():
            errors.append(f"식별키 형식 오류: {k}={v!r} (숫자여야 함)")
        out[k] = v

    # 2) 텍스트 3종
    for key, limit, label in (
        ("progress_text", MAX_PROGRESS, "진도"),
        ("homework_text", MAX_HOMEWORK, "숙제"),
        ("daily_memo", MAX_MEMO, "메모"),
    ):
        if key in payload:
            val, w = normalize_text(payload[key], limit=limit, label=label)
            warnings.extend(w)
            if not val:
                warnings.append(f"{label}: 정규화 후 빈 문자열 — 전송에서 제외")
            else:
                out[key] = val

    # 3) 점수 2종
    if "dt_score" in payload:
        v, w = clamp_int(payload["dt_score"], *DT_SCORE_RANGE, label="일일테스트")
        warnings.extend(w)
        if v is not None:
            out["dt_score"] = v

    if "hw_rate" in payload:
        v, w = clamp_int(payload["hw_rate"], *HW_RATE_RANGE, label="숙제완성도")
        warnings.extend(w)
        if v is not None:
            out["hw_rate"] = v

    # 4) 출결
    #
    # 값 목록을 여기 손으로 적어 두면 서버 드롭다운과 갈라집니다. 실제로
    # 갈라져 있었습니다 — `("Y", "N")` 으로 박아 둬서 **지각(L)이 "출결 값
    # 오류" 로 차단**됐습니다. 완결성 검사는 지각을 인정하는데 쓰기 게이트가
    # 막는, 앞뒤가 안 맞는 상태였습니다.
    # 이제 실측 드롭다운(`ATTENDANCE_VALUES`)을 정본으로 씁니다.
    if "attendance" in payload:
        from ..lms.endpoints import ATTENDANCE_VALUES

        a = str(payload["attendance"]).strip().upper()
        # ' '(선택 안 함)은 "아직 안 정함" 이라 전송 대상이 아닙니다.
        valid = {k for k in ATTENDANCE_VALUES if k.strip()}
        if a in valid:
            out["attendance"] = a
        else:
            allowed = ", ".join(f"{k}={v}" for k, v in ATTENDANCE_VALUES.items()
                                if k.strip())
            errors.append(f"출결 값 오류: {payload['attendance']!r} ({allowed})")

    # 5) 쓸 내용이 하나도 없으면 전송 자체를 막습니다
    writable = set(out) - set(REQUIRED_KEYS)
    if not writable:
        errors.append("전송할 필드가 하나도 없습니다")

    return GateResult(ok=not errors, value=out, errors=errors, warnings=warnings)


# ─────────────────────────────────────────────────────────────
# LLM 출력 게이트
# ─────────────────────────────────────────────────────────────
#: LLM 이 만들어내면 안 되는 것들
_FORBIDDEN = (
    re.compile(r"(?i)as an ai|language model|죄송하지만"),   # 메타 발화
    re.compile(r"(?i)<\s*script"),                          # 스크립트 주입
    re.compile(r"(?i)(select|insert|update|delete)\s+.*\s+from\s"),  # SQL 흔적
)


def gate_llm_output(text: str, *, limit: int, label: str = "LLM 출력") -> GateResult:
    """LLM 이 생성한 문장이 사람이 쓴 수업일지로 적합한지 검사합니다."""
    errors: list[str] = []
    value, warnings = normalize_text(text, limit=limit, label=label)

    if not value:
        errors.append(f"{label}: 빈 출력")
    if len(value) < 5:
        errors.append(f"{label}: 너무 짧음({len(value)}자)")
    for pat in _FORBIDDEN:
        if pat.search(value):
            errors.append(f"{label}: 금지 패턴 감지 ({pat.pattern[:30]})")

    return GateResult(ok=not errors, value={"text": value},
                      errors=errors, warnings=warnings)


def gate_page_range(page: Any, *, lo: int = 1, hi: int = 400) -> GateResult:
    """LLM 이 언급한 교재 페이지가 실재 가능한 범위인지 확인합니다.

    환각으로 '312쪽'을 적어 학부모 리포트에 나가는 사고를 막습니다.
    """
    v, warns = clamp_int(page, lo, hi, label="교재 페이지")
    if v is None:
        return GateResult(ok=False, errors=[f"교재 페이지 해석 불가: {page!r}"])
    ok = not warns
    return GateResult(ok=ok, value={"page": v},
                      errors=[] if ok else warns, warnings=[])
