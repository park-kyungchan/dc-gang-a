# -*- coding: utf-8 -*-
"""
완결성·정합성 게이트.

성공 기준이 **"빠뜨리지 않는 것"** 이므로, 이 모듈이 프로젝트에서 가장 중요합니다.
빠르게 쓰는 것보다 빠진 칸을 확실히 잡아내는 것이 우선입니다.

세 층 중 1·2층 (3층 품질검사는 LLM 이 맡고 비차단입니다)

    1층 완결성 — 채워야 할 칸이 다 찼는가        → 결정론, 전송 차단
    2층 정합성 — 서로 모순되지 않는가            → 결정론, 전송 차단
    3층 품질   — 문장이 학부모용으로 적절한가     → LLM, 경고만

왜 LLM 에게 안 맡기는가
    "5개 칸이 다 찼는가" 는 `for` 루프가 즉시·무료·100% 정확하게 하는 일입니다.
    비결정적 판정자를 끼우면 성공 기준 자체가 흔들립니다.

핵심 설계: **출결이 필수 항목을 바꿉니다.**
    결석한 학생에게 진도·숙제를 적으면 그게 오히려 오류입니다.
    그래서 완결성은 "5개 전부" 가 아니라 "출결 상태에 따라 달라지는 집합" 입니다.

    | 출결        | 필수 항목                                  |
    | :---------- | :---------------------------------------- |
    | 출석 Y      | 출결·일일테스트·진도·숙제·메모 (5개)        |
    | **지각 L**  | 출석과 같음 (늦게라도 수업을 받았으므로)     |
    | 결석 N      | 출결만                                     |

    출결 드롭다운에는 `L`(지각) 이 실재합니다(`lms/endpoints.py` 실측).
    Y/N 만 있다고 보고 짜면 지각 학생이 "출결 미입력" 으로 빠집니다.

일일테스트 면제 (클리닉·보강)
    클리닉/보강 학생은 일일테스트를 안 보기도 합니다. 다만 **면제는 사유가
    있어야만 성립합니다.** 플래그만으로 필수 항목을 뺄 수 있으면 "귀찮아서
    면제" 가 가능해지고, 그 순간 면제가 누락의 우회로가 됩니다.
    또 **자동 판정하지 않습니다** — 클리닉 학생 실제 사례를 아직 못 봤으므로
    (원장 P-10, 미검증) 조건을 추측해 면제하지 않고, 선생님이 명시적으로
    지정한 경우에만 적용합니다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..lms.endpoints import ATTENDANCE_VALUES
from .gates import (
    DT_SCORE_RANGE,
    HW_RATE_RANGE,
    SOFT_HOMEWORK,
    SOFT_MEMO,
    SOFT_PROGRESS,
)


class Attendance(str, Enum):
    PRESENT = "Y"     # 출석
    ABSENT = "N"      # 결석
    #: 지각. 출결 드롭다운 실측값이며 Y/N 만 있다고 보면 이 학생들이 통째로 샙니다.
    LATE = "L"

    @property
    def label(self) -> str:
        """사람이 읽는 이름. 서버 드롭다운 값을 정본으로 씁니다."""
        return ATTENDANCE_VALUES.get(self.value, self.value)

    @property
    def attended(self) -> bool:
        """수업을 받았는가. 지각은 늦게라도 받았으므로 참입니다."""
        return self is not Attendance.ABSENT


#: 출결 코드 → Attendance. 서버가 새 값을 추가하면 그 값은 `None` 이 되어
#: "출결 미입력" 으로 잡힙니다(조용히 출석 취급하지 않습니다).
ATTENDANCE_CODES: dict[str, Attendance] = {a.value: a for a in Attendance}

#: 출석한 학생에게 반드시 채워야 하는 항목
REQUIRED_WHEN_PRESENT: tuple[str, ...] = (
    "attendance", "dt_score", "progress_text", "homework_text", "daily_memo",
)

#: 지각도 수업을 받았으므로 출석과 같습니다.
#: 별도 튜플을 만들지 않고 별칭으로 두는 이유 — 두 벌이 되면 한쪽만 고치는
#: 사고가 나고, 그때 지각 학생만 조용히 검사를 덜 받게 됩니다.
REQUIRED_WHEN_LATE: tuple[str, ...] = REQUIRED_WHEN_PRESENT

#: 결석한 학생에게 필요한 것 — 출결만.
#: 결석인데 진도를 적으면 2층에서 모순으로 잡습니다.
REQUIRED_WHEN_ABSENT: tuple[str, ...] = ("attendance",)

#: 사람이 읽는 이름
FIELD_LABELS: dict[str, str] = {
    "attendance": "금일출석",
    "dt_score": "일일테스트",
    "hw_rate": "숙제완성도",
    "progress_text": "진도",
    "homework_text": "숙제",
    "daily_memo": "메모",
    "student_memo": "지속사항",
}

#: 결석 시 있으면 안 되는 항목
FORBIDDEN_WHEN_ABSENT: tuple[str, ...] = (
    "dt_score", "hw_rate", "progress_text", "homework_text",
)

# ─────────────────────────────────────────────────────────────
# 일일테스트 면제 — 클리닉·보강 (원장 P-10)
# ─────────────────────────────────────────────────────────────
#: 면제를 지정하는 페이로드 키. 둘 다 선생님이 명시적으로 넣어야 합니다.
DT_EXEMPT_FLAG = "dt_exempt"
DT_EXEMPT_REASON = "dt_exempt_reason"

#: 폼에서 온 문자열 "false"/"N"/"0" 은 파이썬에서 **참**입니다.
#: 그대로 `bool()` 로 읽으면 끈 적 없는 면제가 켜집니다.
_FALSY_TOKENS = frozenset({"", "0", "false", "f", "no", "n", "off", "none", "null"})


def _is_true(v: Any) -> bool:
    """폼/JSON 어느 쪽에서 와도 같게 읽는 참 판정."""
    if isinstance(v, str):
        return v.strip().lower() not in _FALSY_TOKENS
    return bool(v)


@dataclass(frozen=True)
class DtExemption:
    """일일테스트 면제 1건.

    **사유 없는 면제는 면제가 아닙니다.**
        플래그 하나로 필수 항목이 빠질 수 있으면 "귀찮아서 면제" 가 가능해지고,
        성공 기준이 "빠뜨리지 않는 것" 인 이 프로젝트에서 면제가 곧 누락의
        우회로가 됩니다. 그래서 사유가 비면 `applies` 가 거짓이 되고,
        일일테스트는 필수로 남습니다.

    **자동으로 판정하지 않습니다.**
        클리닉·보강 학생의 실제 사례를 아직 못 봤습니다(원장 P-10, 미검증).
        "반 이름에 클리닉이 있으면 면제" 같은 추측 규칙은 넣지 않습니다.
        선생님이 이 값을 직접 넣을 때만 적용됩니다.
    """

    reason: str = ""

    @property
    def applies(self) -> bool:
        return bool(self.reason.strip())

    def __str__(self) -> str:
        return (f"DT면제({self.reason.strip()})" if self.applies
                else "DT면제(사유없음 — 미적용)")


def read_dt_exemption(payload: dict[str, Any]) -> DtExemption | None:
    """페이로드에서 면제 **지정**을 읽습니다. 지정이 없으면 `None`.

    사유만 남아 있고 플래그가 꺼져 있으면 면제를 요청한 것이 아닙니다.
    (플래그를 껐는데 사유 문자열이 남아 되살아나면, 끈 사람 모르게 면제됩니다.)
    """
    if not _is_true(payload.get(DT_EXEMPT_FLAG)):
        return None
    return DtExemption(reason=str(payload.get(DT_EXEMPT_REASON, "") or "").strip())


@dataclass
class RowStatus:
    """수업일지 한 행(학생 1명)의 완결성 상태."""

    student: str
    attendance: Attendance | None = None
    filled: dict[str, bool] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    #: 차단하지 않는 참고 정보. 길이가 화면 기준을 넘는 경우 등.
    #: `conflicts` 와 섞지 않는 이유: conflicts 는 전송을 막습니다. 서버가
    #: 받아 주는 것을 우리가 막으면 선생님이 쓴 글을 못 보내게 됩니다.
    notes: list[str] = field(default_factory=list)
    #: 선생님이 지정한 일일테스트 면제. 사유가 비면 지정만 있고 적용되지 않습니다.
    dt_exemption: DtExemption | None = None

    @property
    def dt_exempt(self) -> bool:
        """면제가 **실제로 적용됐는가.** 사유 없는 지정은 거짓입니다."""
        return bool(self.dt_exemption and self.dt_exemption.applies)

    @property
    def required(self) -> tuple[str, ...]:
        if self.attendance is Attendance.ABSENT:
            return REQUIRED_WHEN_ABSENT
        # 지각(L)은 수업을 받았으므로 출석과 같은 항목을 요구합니다.
        req = REQUIRED_WHEN_PRESENT
        if self.dt_exempt:
            # 면제는 **일일테스트 한 칸만** 뺍니다. 진도·숙제·메모는 그대로입니다.
            req = tuple(f for f in req if f != "dt_score")
        return req

    @property
    def is_complete(self) -> bool:
        return not self.missing and not self.conflicts

    @property
    def progress_mark(self) -> str:
        """화면에 띄울 진행 표시 — ●●●○○ 형태.

        누락은 수업이 끝난 뒤가 아니라 **작성 중에** 보여야 합니다.
        """
        req = self.required
        done = sum(1 for f in req if self.filled.get(f))
        return "●" * done + "○" * (len(req) - done)

    def summary(self) -> str:
        # 면제는 항상 드러냅니다. 조용히 빠진 칸은 없어야 합니다.
        tail = f" · {self.dt_exemption}" if self.dt_exempt else ""
        if self.conflicts:
            return (f"{self.student} {self.progress_mark} ⚠ "
                    + "; ".join(self.conflicts) + tail)
        if self.missing:
            names = ", ".join(FIELD_LABELS.get(m, m) for m in self.missing)
            return f"{self.student} {self.progress_mark} 미입력: {names}{tail}"
        return f"{self.student} {self.progress_mark} 완료{tail}"


def _has_value(payload: dict[str, Any], key: str) -> bool:
    """'채워졌다'의 정의. 0 은 유효한 값이므로 falsy 판정을 쓰면 안 됩니다."""
    if key not in payload:
        return False
    v = payload[key]
    if v is None:
        return False
    if isinstance(v, str):
        return bool(v.strip())
    return True     # 0, 0.0 도 입력된 값으로 봅니다


def check_row(payload: dict[str, Any], *, student: str = "") -> RowStatus:
    """한 학생의 수업일지 입력 상태를 판정합니다.

    일일테스트 면제는 `dt_exempt` + `dt_exempt_reason` 두 키로만 들어옵니다.
    여기서 학생의 반·수업유형을 보고 면제를 **추론하지 않습니다**(원장 P-10).
    """
    raw = str(payload.get("attendance", "") or "").strip().upper()
    att = ATTENDANCE_CODES.get(raw)

    st = RowStatus(student=student or str(payload.get("student_name", "?")),
                   attendance=att,
                   dt_exemption=read_dt_exemption(payload))

    for f in ("attendance", "dt_score", "hw_rate",
              "progress_text", "homework_text", "daily_memo"):
        st.filled[f] = _has_value(payload, f)

    # ── 1층 완결성 ────────────────────────────────────────────
    if att is None:
        st.missing.append("attendance")
        # 출결을 모르면 나머지 필수 항목을 정할 수 없습니다.
        st.conflicts.append("출결을 먼저 정해야 나머지 필수 항목이 확정됩니다")
        return st

    st.missing = [f for f in st.required if not st.filled.get(f)]

    # ── 2층 정합성 ────────────────────────────────────────────
    # 면제를 지정했는데 사유가 없으면 **면제하지 않습니다.**
    # 조용히 무시하면 선생님은 면제된 줄 알고 넘어가므로 반드시 알립니다.
    if st.dt_exemption is not None and not st.dt_exemption.applies:
        st.conflicts.append(
            "일일테스트 면제 사유가 비어 있어 면제를 적용하지 않았습니다 — "
            "사유 없는 면제는 누락의 우회로가 됩니다"
        )

    if st.dt_exempt and st.filled.get("dt_score"):
        try:
            iv = int(payload["dt_score"])
        except (TypeError, ValueError):
            iv = None
        # 0 은 '0점' 이 아니라 **'미실시'** 입니다(endpoints.DAILY_TEST_SCALE 실측).
        # 미실시는 면제와 모순되지 않으므로 0 은 그냥 둡니다.
        if iv is not None and iv > 0:
            st.conflicts.append(
                f"일일테스트 면제인데 점수 {iv} 가 입력됨 — "
                f"면제를 해제하거나 점수를 지우세요"
            )

    if att is Attendance.ABSENT:
        wrote = [FIELD_LABELS[f] for f in FORBIDDEN_WHEN_ABSENT if st.filled.get(f)]
        if wrote:
            st.conflicts.append(
                f"결석인데 {', '.join(wrote)} 이(가) 입력됨 — 결석 처리가 맞는지 확인하세요"
            )

    if st.filled.get("dt_score"):
        v = payload["dt_score"]
        try:
            iv = int(v)
            if not (DT_SCORE_RANGE[0] <= iv <= DT_SCORE_RANGE[1]):
                st.conflicts.append(f"일일테스트 {iv} 는 허용 범위 {DT_SCORE_RANGE} 밖")
        except (TypeError, ValueError):
            st.conflicts.append(f"일일테스트 값을 숫자로 읽을 수 없음: {v!r}")

    if st.filled.get("hw_rate"):
        try:
            iv = int(payload["hw_rate"])
            if not (HW_RATE_RANGE[0] <= iv <= HW_RATE_RANGE[1]):
                st.conflicts.append(f"숙제완성도 {iv} 는 허용 범위 {HW_RATE_RANGE} 밖")
        except (TypeError, ValueError):
            st.conflicts.append("숙제완성도 값을 숫자로 읽을 수 없음")

    # 길이 — **모순이 아니라 참고 정보입니다.**
    #
    # 예전 문구는 "서버가 잘라냅니다" 였는데 **사실이 아니었습니다.** 서버는
    # 자르지 않습니다(실측: 250자 그대로 저장). 자르던 것은 우리 게이트였고,
    # 그것도 없앴습니다. 없는 위험을 근거로 전송을 막고 있었던 셈입니다.
    #
    # `conflicts` 는 전송을 차단합니다. 화면 기준을 넘었다는 이유로 선생님이
    # 길게 쓴 메모를 못 보내게 하면 안 됩니다. `notes` 로 알리기만 합니다.
    from ..lms.endpoints import reallength

    for key, limit in (("progress_text", SOFT_PROGRESS),
                       ("homework_text", SOFT_HOMEWORK),
                       ("daily_memo", SOFT_MEMO)):
        if st.filled.get(key):
            text = str(payload[key])
            if reallength(text) > limit:
                st.notes.append(
                    f"{FIELD_LABELS[key]} 가 화면 기준({limit})을 넘습니다 "
                    f"({len(text)}자 / 화면단위 {reallength(text)}). "
                    f"서버는 자르지 않으므로 그대로 나갑니다"
                )
    return st


@dataclass
class ClassStatus:
    """반 전체의 완결성. 화면 상단에 띄울 요약입니다."""

    date: str
    rows: list[RowStatus] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.rows)

    @property
    def complete(self) -> int:
        return sum(1 for r in self.rows if r.is_complete)

    @property
    def incomplete(self) -> list[RowStatus]:
        return [r for r in self.rows if not r.is_complete]

    @property
    def all_done(self) -> bool:
        return bool(self.rows) and not self.incomplete

    @property
    def absent(self) -> list[RowStatus]:
        return [r for r in self.rows if r.attendance is Attendance.ABSENT]

    @property
    def late(self) -> list[RowStatus]:
        """지각. 결석과 섞으면 안 됩니다 — 필수 항목이 정반대입니다."""
        return [r for r in self.rows if r.attendance is Attendance.LATE]

    @property
    def dt_exempted(self) -> list[RowStatus]:
        """일일테스트 면제가 실제로 적용된 학생. 요약에 항상 드러냅니다."""
        return [r for r in self.rows if r.dt_exempt]

    def summary(self) -> str:
        if not self.rows:
            return f"{self.date} · 학생 없음"
        head = f"{self.date} · {self.complete}/{self.total} 완료"
        if self.absent:
            head += f" · 결석 {len(self.absent)}명"
        if self.late:
            head += f" · 지각 {len(self.late)}명"
        if self.dt_exempted:
            head += f" · DT면제 {len(self.dt_exempted)}명"
        if self.incomplete:
            head += f" · 미완 {len(self.incomplete)}명"
        return head

    def exemption_report(self) -> list[str]:
        """누가 왜 면제됐는지. 면제는 세어만 두지 말고 사유까지 보여야 합니다."""
        return [f"{r.student}: {r.dt_exemption.reason}" for r in self.dt_exempted]

    def missing_report(self) -> list[str]:
        return [r.summary() for r in self.incomplete]


def check_class(payloads: list[dict[str, Any]], *, date: str = "") -> ClassStatus:
    """반 전체를 한 번에 점검합니다.

    수업 끝나고 "3명 빠졌네" 가 아니라, 작성 중에 계속 보여주기 위한 것입니다.
    """
    cs = ClassStatus(date=date)
    for p in payloads:
        cs.rows.append(check_row(p, student=str(p.get("student_name", "?"))))
    return cs


# ─────────────────────────────────────────────────────────────
# DT 통과 판정 — 기준점은 선생님이 매번 정합니다
# ─────────────────────────────────────────────────────────────
@dataclass
class DtResult:
    student: str
    score: int
    threshold: int
    max_score: int = DT_SCORE_RANGE[1]

    @property
    def passed(self) -> bool:
        return self.score >= self.threshold

    @property
    def percent(self) -> int:
        return round(self.score / self.max_score * 100) if self.max_score else 0

    @property
    def needs_clinic(self) -> bool:
        """미달이면 ZT 오답 클리닉 대상."""
        return not self.passed

    def summary(self) -> str:
        mark = "Pass" if self.passed else "Fail → ZT 클리닉"
        return f"{self.student} {self.score}/{self.max_score} ({self.percent}%) {mark}"


def judge_dt(
    scores: dict[str, Any],
    *,
    threshold: int,
) -> list[DtResult]:
    """DT 점수로 통과/클리닉 대상을 가릅니다.

    `threshold` 는 **하드코딩하지 않습니다.** 회차마다 문항 수와 난이도가 달라
    기준이 바뀌므로, 선생님이 그때그때 정한 값을 받습니다.

    범위를 벗어난 기준점은 조용히 받아들이지 않고 예외를 냅니다.

    ⚠️ **면제(`DtExemption`) 학생은 여기 넣지 마세요.** 시험을 안 본 학생을
    0 으로 넣으면 미달로 잡혀 ZT 클리닉 대상이 됩니다. 0 은 '0점' 이 아니라
    '미실시' 입니다(endpoints.DAILY_TEST_SCALE).
    """
    lo, hi = DT_SCORE_RANGE
    if not (lo <= threshold <= hi):
        raise ValueError(f"기준점 {threshold} 이 허용 범위 {lo}~{hi} 밖입니다")

    out: list[DtResult] = []
    for name, raw in scores.items():
        try:
            v = int(raw)
        except (TypeError, ValueError):
            continue
        out.append(DtResult(student=name, score=max(lo, min(hi, v)),
                            threshold=threshold))
    return out


def clinic_targets(results: list[DtResult]) -> list[str]:
    """ZT 클리닉을 거쳐야 하는 학생 목록."""
    return [r.student for r in results if r.needs_clinic]
