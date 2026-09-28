# -*- coding: utf-8 -*-
"""
서버 쓰기 게이트웨이 — **여기를 거치지 않으면 서버에 쓸 수 없습니다.**

`ganga.governance` 가 규칙을 정의하고, 이 모듈이 그 규칙을 실제 HTTP 요청에
적용합니다. 둘을 나눈 이유는 규칙을 네트워크 없이 테스트하기 위해서입니다.

사용 순서 (HITL)

    gw = WriteGateway(lms, ledger=Ledger())

    op   = gw.build_day_record_op(...)   # 1. 요청 조립
    rep  = gw.evaluate(op)               # 2. 게이트 평가 (아직 안 나감)
    print(rep.render())                  # 3. 사람에게 보여줌  ← G13
    gw.approve(op, by="박경찬")           # 4. 사람이 승인      ← G14
    res  = gw.send(op)                   # 5. 전송 + 응답판정 + 역검증

    2~4 를 건너뛰고 5 를 부르면 예외가 납니다.

거버넌스 관점에서 이 모듈이 보장하는 것
    · 승인 없이 나가는 경로가 없습니다 (`send()` 가 승인 상태를 다시 확인)
    · 모든 시도가 저널에 남습니다 (차단·성공·실패 전부)
    · 저널에 학생 실명과 본문 원문이 남지 않습니다
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..governance import (
    GateContext,
    GateReport,
    Tier,
    WriteOp,
    evaluate,
    journal,
    resolve_tier,
)
from ..policy import Ledger
from .endpoints import (
    BASE_URL,
    CISM_ACTIONS,
    CISM_FIELDS,
    DAY_RECORD_WRITE,
    alimtalk_url,
)
from .session import LmsSession
from .writer import judge_response


class NotApproved(PermissionError):
    """승인 없이 전송을 시도했습니다."""


class GateBlocked(PermissionError):
    """게이트에서 차단됐습니다."""


@dataclass
class SendResult:
    op: WriteOp
    sent: bool = False
    ok: bool = False
    detail: str = ""
    verified: bool | None = None
    #: G15 응답 판정 3값. None = 판정 불가 (빈 본문 등)
    judged: bool | None = None
    post_gates: list[tuple[str, str, bool, str]] = field(default_factory=list)
    #: 되돌릴 수 없어 사람이 눌러야 하는 경우, 열어야 할 화면 URL
    handoff_url: str = ""

    def summary(self) -> str:
        if self.handoff_url:
            return f"[핸드오프] {self.op.key}: 선생님이 직접 눌러 주세요\n  {self.handoff_url}"
        if not self.sent:
            return f"[미전송] {self.op.key}: {self.detail}"
        head = "성공" if self.ok else "실패"
        j = {True: "응답 성공", False: "응답 실패", None: "응답 판정불가"}[self.judged]
        v = {True: "역검증 통과", False: "역검증 실패", None: "역검증 안 함"}[self.verified]
        return f"[{head}] {self.op.key} · {j} · {v} · {self.detail}"


@dataclass
class Handoff:
    """되돌릴 수 없는 동작 — 준비만 하고 사람에게 넘깁니다."""

    action: str
    url: str
    subjects: list[str] = field(default_factory=list)
    why: str = ""

    def render(self) -> str:
        who = ", ".join(self.subjects) if self.subjects else "(대상 미지정)"
        return (f"⛔ {self.action} — 자동 전송하지 않습니다\n"
                f"   이유: {self.why}\n"
                f"   대상: {who} ({len(self.subjects)}명)\n"
                f"   아래 주소를 열고 **마지막 버튼은 직접** 눌러 주세요\n"
                f"   {self.url}")


class WriteGateway:
    """서버 쓰기의 단일 관문."""

    def __init__(
        self,
        lms: LmsSession,
        *,
        ledger: Ledger | None = None,
        dry_run: bool | None = None,
        max_writes: int | None = None,
        min_interval_sec: float = 0.5,
    ) -> None:
        self.lms = lms
        self.ledger = ledger or Ledger()
        self.dry_run = settings.safety.dry_run if dry_run is None else dry_run
        self.max_writes = max_writes or settings.safety.max_writes_per_run
        self.min_interval_sec = min_interval_sec

        self._approved: dict[str, str] = {}      # fingerprint → 승인자
        self._previewed: set[str] = set()
        self._sent: set[str] = set()
        self._writes = 0
        self._last_write_at = 0.0
        #: 담당 학생 login_id 집합. 비어 있으면 소유권 확인 불가로 봅니다.
        self.owned_students: set[str] = set()
        #: dry-run 이 **항목별로** 풀린 목록 (`day_record.progress`).
        #: 프로세스 메모리에만 있습니다 — 디스크에 남기면 켜 둔 걸 잊습니다.
        self._unlocked: set[str] = set()

    # ── 0. 항목별 잠금 해제 ─────────────────────────────────
    def unlock(self, *keys: str, by: str) -> set[str]:
        """지정한 항목만 dry-run 을 풉니다. 나머지는 그대로 잠겨 있습니다.

        `by` 는 누가 풀었는지입니다 — 저널에 남기기 위해 필수입니다.
        전역 `dry_run` 을 끄는 것과 다릅니다. 사고 범위를 이 항목들로
        제한하는 것이 목적입니다.
        """
        if not by.strip():
            raise ValueError("해제한 사람 이름이 필요합니다")
        bad = [k for k in keys if "." not in k]
        if bad:
            raise ValueError(f"항목은 'routine.field' 형식이어야 합니다: {bad}")
        self._unlocked.update(keys)
        return set(self._unlocked)

    def lock(self, *keys: str) -> set[str]:
        """다시 잠급니다. 인자가 없으면 전부 잠급니다."""
        if keys:
            self._unlocked.difference_update(keys)
        else:
            self._unlocked.clear()
        return set(self._unlocked)

    @property
    def unlocked(self) -> frozenset[str]:
        return frozenset(self._unlocked)

    def is_unlocked(self, op: WriteOp) -> bool:
        return op.key in self._unlocked

    # ── 1. 요청 조립 ────────────────────────────────────────
    def build_day_record_op(
        self, *, field_name: str, value: Any, subject: str,
        stu_pri_no: str, record_seq: str, cm_seq: str, course_seq: str = "",
    ) -> WriteOp:
        spec = DAY_RECORD_WRITE.get(field_name)
        if spec is None:
            # 모르는 필드도 **막지 말고 만들되**, G07 이 차단하게 둡니다.
            # 여기서 예외를 던지면 게이트 보고서에 남지 않아 감사가 끊깁니다.
            return WriteOp(routine="day_record", field=field_name,
                           servlet="(미등록)", method="POST",
                           params={"stu_pri_no": stu_pri_no,
                                   "record_seq": record_seq, "cm_seq": cm_seq},
                           subject=subject, value=value)

        params: dict[str, Any] = {"reqCmd": spec["reqCmd"], spec["field"]: value}
        for k in spec.get("keys", ()):
            params[k] = {"stu_pri_no": stu_pri_no, "record_seq": record_seq,
                         "cm_seq": cm_seq, "course_seq": course_seq}.get(k, "")
        # 게이트가 항상 볼 수 있도록 식별키를 보강합니다.
        for k, v in (("stu_pri_no", stu_pri_no), ("record_seq", record_seq),
                     ("cm_seq", cm_seq)):
            params.setdefault(k, v)
        if tp := spec.get("tutor_param"):
            params[tp] = self.lms.teacher.pri_no
        if spec.get("dummy"):
            params["dummy"] = str(time.time())

        return WriteOp(routine="day_record", field=field_name,
                       servlet=spec["servlet"], method=spec.get("method", "POST"),
                       params=params, subject=subject, value=value)

    def build_cism_op(self, *, field_id: str, value: str, the_date: str) -> WriteOp:
        spec = CISM_ACTIONS["save_field"]
        return WriteOp(
            routine="cism", field=field_id,
            servlet=spec["servlet"], method=spec["method"],
            params={"reqCmd": spec["reqCmd"],
                    "tutor_pri_no": self.lms.teacher.pri_no,
                    "the_date": the_date, "field_name": field_id,
                    "field_value": value},
            subject=CISM_FIELDS.get(field_id, field_id), value=value)

    # ── 2. 게이트 평가 ──────────────────────────────────────
    def build_alimtalk_op(self, *, report_seqs: list[str], all_report_seqs: list[str],
                          report_date: str, subjects: list[str] | None = None,
                          batch: bool = False) -> WriteOp:
        """알림톡 — **만들기만 합니다.** 이 op 은 `send()` 로 나가지 않습니다.

        `resolve_tier` 가 이걸 HANDOFF 로 판정하고, G17 이 항상 차단합니다.
        차단이 정상 동작입니다. 발송 화면은 `handoff()` 로 얻으세요.
        """
        return WriteOp(
            routine="alimtalk", field="batch" if batch else "one",
            servlet="(핸드오프 — 서블릿 직접 호출 안 함)", method="GET",
            params={"target_report_seq_list": ",".join(report_seqs),
                    "all_report_seq_list": ",".join(all_report_seqs),
                    "report_date": report_date},
            subject=", ".join(subjects or []), value=len(report_seqs))

    def handoff(self, op: WriteOp) -> Handoff:
        """되돌릴 수 없는 동작의 **준비물**을 돌려줍니다. 전송하지 않습니다."""
        if resolve_tier(op) is not Tier.HANDOFF:
            raise ValueError(
                f"{op.key} 는 핸드오프 대상이 아닙니다. send() 를 쓰세요")
        if op.routine != "alimtalk":
            return Handoff(action=op.key, url="",
                           why="되돌릴 수 없는 동작 — 화면에서 직접 처리하세요")
        url = alimtalk_url(
            target_report_seqs=op.params["target_report_seq_list"].split(","),
            all_report_seqs=op.params["all_report_seq_list"].split(","),
            report_date=op.params["report_date"])
        return Handoff(
            action="알림톡 발송", url=url,
            subjects=[s for s in op.subject.split(", ") if s],
            why="학부모 휴대폰으로 나가며 회수할 수 없습니다")

    # ── 2. 게이트 평가 ──────────────────────────────────────
    def context_for(self, op: WriteOp, *,
                    value_errors: list[str] | None = None,
                    consistency_errors: list[str] | None = None,
                    owner_login: str | None = None,
                    value_origin: str = "llm",
                    batch_size: int = 1) -> GateContext:
        known = (op.routine == "day_record" and op.field in DAY_RECORD_WRITE) or \
                (op.routine == "cism" and op.field in CISM_FIELDS)
        owns: bool | None
        if owner_login is None:
            owns = True if op.routine == "cism" else None
        else:
            owns = owner_login in self.owned_students if self.owned_students else None

        return GateContext(
            op=op,
            session_ok=bool(self.lms.teacher.pri_no),
            teacher_pri_no=self.lms.teacher.pri_no,
            policy_mode=self.ledger.mode(op.routine, op.field).value,
            # 전역 dry_run 이 켜져 있어도 **이 항목**이 풀려 있으면 나갑니다.
            dry_run=self.dry_run and not self.is_unlocked(op),
            approved_by=self._approved.get(op.fingerprint, ""),
            owns_student=owns,
            known_field=known,
            value_errors=value_errors or [],
            consistency_errors=consistency_errors or [],
            recent_fingerprints=set(self._sent),
            writes_this_run=self._writes,
            max_writes=self.max_writes,
            min_interval_sec=self.min_interval_sec,
            last_write_at=self._last_write_at,
            preview_shown=op.fingerprint in self._previewed,
            value_origin=value_origin,
            batch_size=batch_size,
            unlocked=self.unlocked,
        )

    def evaluate(self, op: WriteOp, **kw) -> GateReport:
        """등급에 맞는 게이트를 돌립니다. **전송하지 않습니다.**"""
        return evaluate(self.context_for(op, **kw))

    def tier_of(self, op: WriteOp, *, batch_size: int = 1) -> Tier:
        return resolve_tier(op, batch_size=batch_size)

    # ── 3. 미리보기 ─────────────────────────────────────────
    def preview(self, op: WriteOp) -> str:
        """사람에게 보여줬음을 기록하고 미리보기를 돌려줍니다 (G13)."""
        self._previewed.add(op.fingerprint)
        return op.preview()

    # ── 4. 승인 ────────────────────────────────────────────
    def approve(self, op: WriteOp, *, by: str) -> None:
        """HITL 승인 (G14). 미리보기를 보지 않았으면 승인할 수 없습니다."""
        if not by.strip():
            raise ValueError("승인자 이름이 필요합니다")
        if op.fingerprint not in self._previewed:
            raise NotApproved(
                "미리보기를 보지 않고 승인할 수 없습니다. preview() 를 먼저 부르세요")
        self._approved[op.fingerprint] = by.strip()

    def revoke(self, op: WriteOp) -> None:
        self._approved.pop(op.fingerprint, None)

    # ── 5. 전송 ────────────────────────────────────────────
    def send(self, op: WriteOp, *, verify: Any = None, **kw) -> SendResult:
        """게이트를 다시 평가하고, 통과할 때만 보냅니다.

        `evaluate()` 결과를 재사용하지 않고 **다시 돌립니다.** 평가와 전송
        사이에 상태가 바뀌었을 수 있고, 낡은 통과 도장으로 나가면 안 됩니다.
        """
        rep = self.evaluate(op, **kw)

        # 되돌릴 수 없는 동작은 여기서 확실히 끊습니다.
        # G17 이 이미 차단하지만, 게이트를 고치는 사람이 실수로 빼도
        # 전송으로 새지 않도록 전송 경로에서 한 번 더 막습니다.
        if rep.needs_handoff:
            ho = self.handoff(op)
            journal(rep, result="HANDOFF", detail=ho.why,
                    approved_by=self._approved.get(op.fingerprint, ""))
            return SendResult(op=op, sent=False, detail=ho.why,
                              handoff_url=ho.url)

        if not rep.allowed:
            blocked = rep.blocked_at
            detail = f"{blocked.gate_id} {blocked.name}: {blocked.detail}" if blocked \
                else "차단"
            journal(rep, result="BLOCKED", detail=detail,
                    approved_by=self._approved.get(op.fingerprint, ""))
            return SendResult(op=op, sent=False, detail=detail)

        url = f"{BASE_URL}/servlet/{op.servlet}"
        try:
            if op.method.upper() == "GET":
                resp = self.lms.get(url, params=op.params, check=False)
            else:
                resp = self.lms.post(url, data=op.params, check=False)
        except Exception as exc:  # noqa: BLE001
            journal(rep, result="ERROR", detail=str(exc),
                    approved_by=self._approved.get(op.fingerprint, ""))
            return SendResult(op=op, sent=False, detail=f"전송 예외: {exc}")

        self._writes += 1
        self._last_write_at = time.time()
        self._sent.add(op.fingerprint)

        judged, detail = judge_response(resp.html_content)   # True / False / None
        res = SendResult(op=op, sent=True, ok=bool(judged), detail=detail,
                         judged=judged)
        res.post_gates.append(("G15", "응답 판정", judged is not False, detail))

        # G16 역검증 — 호출자가 확인 함수를 주면 실행합니다.
        if verify is not None:
            try:
                res.verified = bool(verify(op))
            except Exception as exc:  # noqa: BLE001
                res.verified = False
                detail += f" | 역검증 예외: {exc}"
            res.post_gates.append(
                ("G16", "역검증", bool(res.verified),
                 "서버 재조회 확인" if res.verified else "재조회에서 확인 실패"))

        # 최종 판정 — 두 게이트를 어떻게 합치는가
        #
        #   G15 실패      → 실패. 역검증이 통과해도 뒤집지 않습니다.
        #                   (내 값이 들어간 게 아니라 원래 그 값이었을 수 있습니다)
        #   G15 성공      → 역검증이 명시적으로 실패하지 않는 한 성공
        #   G15 판정불가  → **역검증만이 근거.** 안 돌렸으면 실패로 봅니다.
        #
        # 판정 불가를 그냥 실패로 접으면, 값이 실제로 들어갔는데 FAILED 로
        # 남습니다. 첫 실전송에서 그 일이 났습니다 (2026-08-25).
        if judged is False:
            res.ok = False
        elif judged is True:
            res.ok = res.verified is not False
        else:
            res.ok = res.verified is True

        journal(rep, result="SENT" if res.ok else "FAILED", detail=detail,
                approved_by=self._approved.get(op.fingerprint, ""),
                verified=res.verified)
        # 한 번 쓴 승인은 소멸시킵니다. 재전송하려면 다시 승인받아야 합니다.
        self.revoke(op)
        return res

    # ── G16 역검증 ─────────────────────────────────────────
    def day_record_verifier(self, *, date: str, grp_seq: str):
        """서버에서 **다시 읽어** 값이 실제로 들어갔는지 확인하는 함수를 만듭니다.

        이 사이트는 저장에 실패해도 HTTP 200 을 주므로, 응답 판정(G15)만으로는
        부족합니다. 같은 화면을 다시 조회해 그 학생 행의 그 칸을 직접 봅니다.

        비교는 **정확히 일치**여야 합니다. 부분일치를 허용하면 이전 값이
        남아 있어도 통과할 수 있습니다.

        단, HTML 엔티티는 되돌려서 비교합니다 (실측 2026-08-25)::

            보냄 'A & B'      → 읽음 'A &amp; B'
            보냄 'x < y > z'  → 읽음 'x &lt; y &gt; z'

        이걸 안 풀면 `&` 하나 들어간 진도가 **정상 저장됐는데 역검증 실패**로
        나옵니다. `&`·`<`·`>` 는 수업 메모에 흔히 씁니다("A&B형", "x<3").

        ⚠️ **공백은 정규화하지 않습니다.** 이 서버는 연속 공백과 탭을 그대로
           보존합니다(실측). `\\s+ → ' '` 로 접으면 서버가 공백을 뭉갠 경우를
           통과로 읽게 됩니다 — 없는 문제를 막으려다 있는 문제를 놓칩니다.
        """
        import html as _html

        from .reader import read_day_record

        FIELD_ATTR = {
            "progress": "progress_text", "homework": "homework_text",
            "memo": "memo_text", "student_memo": "student_memo",
            "attendance": "attendance", "daily_test": "daily_test",
            "hw_rate": "homework_rate",
        }

        def _verify(op: WriteOp) -> bool:
            attr = FIELD_ATTR.get(op.field)
            if attr is None:
                return False
            page = read_day_record(self.lms, date=date, grp_seq=grp_seq)
            want_stu = str(op.params.get("stu_pri_no", ""))
            row = next((r for r in page.records if r.stu_pri_no == want_stu), None)
            if row is None:
                return False
            got = getattr(row, attr)
            expect = op.value
            if isinstance(got, int) or got is None:
                try:
                    return got == int(expect)
                except (TypeError, ValueError):
                    return False
            return _html.unescape(str(got)).strip() == str(expect).strip()

        return _verify

    # ── 조회 ───────────────────────────────────────────────
    @property
    def stats(self) -> dict[str, Any]:
        return {"writes_this_run": self._writes, "max_writes": self.max_writes,
                "dry_run": self.dry_run, "unlocked": sorted(self._unlocked),
                "approved_pending": len(self._approved)}
