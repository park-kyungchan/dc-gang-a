# -*- coding: utf-8 -*-
"""
대기열 → 서버. **낮에 폰으로 넣은 것을 밤에 PC 에서 내보내는 다리.**

왜 다리가 따로 필요한가
    대기열(`ganga/queue.py`)은 디스크에 있고, 게이트웨이(`ganga/lms/gateway.py`)
    의 승인은 프로세스 메모리에 있습니다. 둘이 서로를 모릅니다.
    큐에서 승인해도 게이트웨이는 "승인자가 없습니다" 로 막습니다.

    이 모듈이 그 사이를 잇습니다. **큐의 승인을 G14 의 근거로 인정**합니다
    (사용자 결정 2026-08-20: 낮에 폰으로 누른 승인을 밤에 그대로 인정).

승인이 낡지 않는 이유
    큐의 승인은 **값에 묶여 있습니다**(`value_hash`). 승인 후 값을 고치면
    승인이 자동으로 풀립니다. 그래서 "승인해 둔 것" 과 "실제로 나가는 것" 이
    다를 수 없습니다. 여기서도 전송 **직전에** 다시 확인합니다 — 목록을
    뽑은 시점과 보내는 시점 사이에도 시간이 흐르기 때문입니다.

큐가 모르는 것 — `record_seq`
    큐에는 학생·날짜·항목·값만 있습니다. **회차 번호(`record_seq`)는 없습니다.**
    회차마다 달라지는 값이라 큐에 굳혀 두면 다음 수업에 엉뚱한 회차로 나갑니다.
    그래서 전송 직전에 그날 수업일지 화면을 읽어 붙입니다.

    화면에 그 학생 행이 없으면 **조용히 건너뛰지 않고 실패로 기록**합니다.
    성공 기준이 "빠뜨리지 않는 것" 이라, 소리 없이 사라지는 항목이 가장 나쁩니다.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any

from .. import queue as Q
from ..governance import Tier, resolve_tier
from ..lms.gateway import SendResult, WriteGateway
from ..lms.reader import read_day_record

#: 큐의 `note` 에 이 표시가 있으면 사람이 직접 쓴 값으로 봅니다.
#: 없으면 LLM 이 만든 것으로 보고 승격 원장(G03)을 적용합니다 — 안전한 쪽 기본값.
HUMAN_MARKERS = ("수기", "manual", "human", "폰", "직접")


def value_origin_of(item: Q.Item) -> str:
    note = (item.note or "").lower()
    return "human" if any(m.lower() in note for m in HUMAN_MARKERS) else "llm"


@dataclass
class ItemOutcome:
    """항목 1건의 처리 결과. **건너뛴 것도 여기 남습니다.**"""

    item: Q.Item
    tier: Tier | None = None
    sent: bool = False
    ok: bool = False
    detail: str = ""
    blocked_at: str = ""
    gates: list[dict[str, Any]] = field(default_factory=list)

    @property
    def student(self) -> str:
        return self.item.subject_name

    def line(self) -> str:
        mark = "→" if self.ok else ("!" if self.sent else "✗")
        where = f" [{self.blocked_at}]" if self.blocked_at else ""
        return f"  {mark} {self.student} · {self.item.key}{where} {self.detail}"


@dataclass
class FlushReport:
    the_date: str
    grp_seq: str
    dry_run: bool
    outcomes: list[ItemOutcome] = field(default_factory=list)
    #: 큐에는 있는데 승인이 유효하지 않아 애초에 대상이 아니었던 것.
    #: (항목, 사유) — 사유를 여기서 굳혀 둡니다. 보고서를 만들 때는 이미
    #: DB 연결이 닫혀 있을 수 있기 때문입니다.
    not_ready: list[tuple[Q.Item, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def sent(self) -> list[ItemOutcome]:
        return [o for o in self.outcomes if o.ok]

    @property
    def failed(self) -> list[ItemOutcome]:
        return [o for o in self.outcomes if not o.ok]

    @property
    def all_ok(self) -> bool:
        return bool(self.outcomes) and not self.failed

    def render(self) -> str:
        head = "dry-run (전송 안 함)" if self.dry_run else "실전송"
        lines = [f"{self.the_date} · 그룹 {self.grp_seq} · {head}",
                 f"  대상 {len(self.outcomes)}건 · 성공 {len(self.sent)} · "
                 f"실패 {len(self.failed)}"]
        for w in self.warnings:
            lines.append(f"  ⚠ {w}")
        lines.extend(o.line() for o in self.outcomes)
        if self.not_ready:
            lines.append(f"  — 승인 대기/무효 {len(self.not_ready)}건")
            for it, why in self.not_ready:
                lines.append(f"    · {it.summary()} — {why}")
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "date": self.the_date, "grp_seq": self.grp_seq,
            "dry_run": self.dry_run,
            "sent": len(self.sent), "failed": len(self.failed),
            "warnings": self.warnings,
            "items": [
                {"student": o.student, "key": o.item.key,
                 "tier": o.tier.value if o.tier else None,
                 "sent": o.sent, "ok": o.ok, "detail": o.detail,
                 "blocked_at": o.blocked_at, "gates": o.gates}
                for o in self.outcomes
            ],
            "not_ready": [
                {"student": it.subject_name, "key": it.key,
                 "status": Q.Status(it.status).label, "why": why}
                for it, why in self.not_ready
            ],
        }


def _why_not_ready(it: Q.Item, conn: sqlite3.Connection | None = None) -> str:
    """왜 이 항목이 안 나갔는지. **"승인 전" 만으로는 부족합니다.**

    값을 고치면 큐가 상태를 `draft` 로 되돌립니다. 그러면 이유가 "승인 전"
    으로만 보여서, 선생님은 **승인했던 기억이 있는데 승인 전이라고 나오는**
    상황을 만납니다. 이력을 뒤져 "값이 바뀌어 승인이 취소됨" 까지 말해 줍니다.
    """
    if it.state is Q.Status.APPROVED:
        return "승인자가 없습니다" if not it.approved_by else \
            "승인 후 값이 바뀌어 승인이 풀렸습니다"

    label = Q.Status(it.status).label
    if conn is not None:
        for h in reversed(Q.history(conn, it.id)):
            if h.get("reason") and "값이 바뀌" in str(h["reason"]):
                return f"{label} — {h['reason']}"
            if h.get("to") == it.status:
                break
    return f"승인 전 ({label})"


def _pace(gw: WriteGateway) -> None:
    """다음 전송까지 남은 간격만큼 기다립니다."""
    import time

    gap = gw.min_interval_sec - (time.time() - gw._last_write_at)
    if gw._last_write_at > 0 and gap > 0:
        time.sleep(gap)


def flush(
    conn: sqlite3.Connection,
    lms: Any,
    *,
    the_date: str,
    grp_seq: str,
    actor: str,
    dry_run: bool = True,
    unlock: tuple[str, ...] = (),
    max_items: int | None = None,
) -> FlushReport:
    """승인된 대기열 항목을 게이트에 태워 서버로 보냅니다.

    `dry_run=True` 면 게이트만 평가하고 서버를 건드리지 않습니다.
    `unlock` 은 **항목별 잠금 해제** 목록(`day_record.progress` 형식)입니다.
    비어 있으면 G04 가 전부 막습니다 — 그게 기본값입니다.
    """
    rep = FlushReport(the_date=the_date, grp_seq=grp_seq, dry_run=dry_run)

    everything = Q.list_items(conn, the_date=the_date)
    ready = Q.ready_to_send(conn, the_date=the_date)
    ready_ids = {it.id for it in ready}
    rep.not_ready = [(it, _why_not_ready(it, conn))
                     for it in everything if it.id not in ready_ids]

    if not ready:
        rep.warnings.append("승인이 유효한 항목이 없습니다")
        return rep

    if max_items is not None and len(ready) > max_items:
        rep.warnings.append(
            f"{len(ready)}건 중 {max_items}건만 처리합니다 (--max)")
        ready = ready[:max_items]

    # 회차 번호는 큐에 없습니다. 그날 화면에서 읽어 붙입니다.
    page = read_day_record(lms, date=the_date, grp_seq=grp_seq)
    rows = {r.stu_pri_no: r for r in page.records}
    by_name = {r.student_name: r for r in page.records if r.student_name}

    gw = WriteGateway(lms, dry_run=True)     # 전역은 항상 잠근 채로 둡니다
    if unlock and not dry_run:
        gw.unlock(*unlock, by=actor)
    gw.owned_students = {r.student_name for r in page.records} | set(rows)

    verify = gw.day_record_verifier(date=the_date, grp_seq=grp_seq)
    batch = len(ready)

    for item in ready:
        out = ItemOutcome(item=item)
        rep.outcomes.append(out)

        # 1) 승인이 **지금도** 유효한가. 목록을 뽑은 뒤에도 시간이 흐릅니다.
        fresh = Q.get(conn, item.id)
        if fresh is None or not fresh.approval_valid:
            out.detail = "전송 직전 재확인에서 승인이 유효하지 않습니다"
            continue

        # 2) 아는 루틴인가. **행 조회보다 먼저** 봅니다.
        #    CISM 은 학생 행이 없는 것이 정상이라, 순서를 뒤집으면
        #    "학생 행이 없습니다" 라는 엉뚱한 사유가 나옵니다.
        if item.routine != "day_record":
            out.detail = f"아직 지원하지 않는 루틴: {item.routine}"
            continue

        # 3) 그날 화면에 이 학생 행이 있는가 (회차 번호 확보)
        row = rows.get(item.subject_key) or by_name.get(item.subject_name)
        if row is None:
            out.detail = (f"{the_date} 수업일지에 이 학생 행이 없습니다 "
                          f"(수업일이 아니거나 편성 미반영)")
            continue

        # 4) 요청 조립 — 큐가 아는 값 + 화면이 아는 키
        op = gw.build_day_record_op(
            field_name=item.field, value=fresh.value,
            subject=row.student_name or item.subject_name,
            stu_pri_no=row.stu_pri_no, record_seq=row.record_seq,
            cm_seq=row.cm_seq, course_seq=row.course_seq)
        out.tier = resolve_tier(op, batch_size=batch)

        kw = dict(owner_login=row.student_name or item.subject_name,
                  value_origin=value_origin_of(fresh), batch_size=batch)

        # 5) **여기가 다리입니다** — 큐의 승인을 G13/G14 의 근거로 인정합니다.
        #    큐 승인은 값에 묶여 있고(3번에서 재확인), 누가 언제 했는지도
        #    디스크에 남아 있습니다. 게이트웨이가 요구하는 것과 같은 것입니다.
        gw.preview(op)
        gw.approve(op, by=fresh.approved_by)

        # 속도 제한(G11)은 서버를 보호하려고 있는 것이지 일괄 전송을 실패시키려고
        # 있는 게 아닙니다. 간격이 안 찼으면 **기다립니다.**
        # (기다리지 않으면 반 전체 전송에서 첫 명만 나가고 나머지가 전부
        #  "직전 전송 후 0.0초" 로 실패합니다.)
        if not dry_run:
            _pace(gw)

        report = gw.evaluate(op, **kw)
        out.gates = [{"id": g.gate_id, "verdict": g.verdict.value,
                      "detail": g.detail} for g in report.outcomes]
        if report.blocked_at:
            out.blocked_at = report.blocked_at.gate_id

        if dry_run:
            out.detail = ("전송 허용 (dry-run 이라 보내지 않음)" if report.allowed
                          else report.blocked_at.detail if report.blocked_at
                          else "차단")
            gw.revoke(op)
            continue

        res: SendResult = gw.send(op, verify=verify, **kw)
        out.sent, out.ok, out.detail = res.sent, res.ok, res.detail
        if res.ok:
            Q.mark_sent(conn, item.id, result=res.detail)
        else:
            Q.mark_failed(conn, item.id, result=res.detail or "전송 실패")

    return rep
