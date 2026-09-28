# -*- coding: utf-8 -*-
"""
초안 대기열 — 폰 입력과 PC 전송 **사이를 버티는** 저장소.

왜 필요한가
    실제 사용 흐름은 이렇습니다.

        낮  교실에서 폰으로 학생별 출결·점수·관찰을 넣는다
        ↓   (몇 시간 경과. 서버가 재시작될 수도, PC 가 잠들 수도 있다)
        밤  PC 에서 초안을 검토하고 승인해 서버로 보낸다

    그런데 `WriteGateway` 의 승인 상태는 **인스턴스 변수**라 프로세스가
    죽으면 사라집니다. 낮에 넣은 것이 저녁에 없어지면 흐름 자체가 성립하지
    않습니다. 그래서 대기열을 디스크에 둡니다.

상태 흐름 (되돌릴 수 있는 방향만 허용)

    draft ──review──→ reviewed ──approve──→ approved ──send──→ sent
      ↑                   │                    │                │
      └───────edit────────┴────────revoke──────┘           (종착)
                                                     실패 시 → failed
                          discarded  ←── discard (어느 단계에서든)

원칙
    · **승인은 값에 묶입니다.** 승인 후 값을 고치면 승인이 자동 취소됩니다.
      "승인해 둔 것"과 "보내는 것"이 달라지면 승인의 의미가 없습니다.
    · sent 는 종착점입니다. 다시 보내려면 새 항목을 만들어야 합니다.
    · 큐에는 학생 실명이 들어갑니다(화면에 보여줘야 하므로).
      `data/` 아래이고 `.gitignore` 로 차단됩니다.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .config import DATA

QUEUE_DB = DATA / "draft_queue.db"


class Status(str, Enum):
    DRAFT = "draft"          # 폰/PC 에서 입력만 된 상태
    REVIEWED = "reviewed"    # 미리보기를 봤음 (G13)
    APPROVED = "approved"    # 사람이 승인했음 (G14)
    SENT = "sent"            # 전송 성공
    FAILED = "failed"        # 전송 실패
    DISCARDED = "discarded"  # 버림

    @property
    def label(self) -> str:
        return {
            "draft": "작성됨", "reviewed": "검토함", "approved": "승인됨",
            "sent": "전송완료", "failed": "전송실패", "discarded": "버림",
        }[self.value]

    @property
    def is_terminal(self) -> bool:
        return self in (Status.SENT, Status.DISCARDED)


#: 허용된 전이만 적습니다. 여기 없는 전이는 거부합니다.
TRANSITIONS: dict[Status, set[Status]] = {
    Status.DRAFT: {Status.REVIEWED, Status.DISCARDED},
    Status.REVIEWED: {Status.APPROVED, Status.DRAFT, Status.DISCARDED},
    Status.APPROVED: {Status.SENT, Status.FAILED, Status.REVIEWED,
                      Status.DRAFT, Status.DISCARDED},
    Status.FAILED: {Status.REVIEWED, Status.DRAFT, Status.DISCARDED},
    Status.SENT: set(),
    Status.DISCARDED: set(),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    the_date     TEXT NOT NULL,        -- 어느 날짜 기록인가
    routine      TEXT NOT NULL,        -- day_record / cism
    field        TEXT NOT NULL,        -- progress / attendance / i_1 …
    subject_key  TEXT NOT NULL,        -- 학생 login_id (cism 은 빈 값)
    subject_name TEXT NOT NULL,
    value        TEXT NOT NULL,        -- 보낼 값 (문자열로 통일)
    value_hash   TEXT NOT NULL,        -- 승인을 값에 묶기 위한 지문
    note         TEXT DEFAULT '',      -- 어떻게 만들어졌나 (agent/template/수기)
    status       TEXT NOT NULL DEFAULT 'draft',
    approved_by  TEXT DEFAULT '',
    approved_at  TIMESTAMP,
    sent_at      TIMESTAMP,
    result       TEXT DEFAULT '',
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(the_date, routine, field, subject_key)
);
CREATE INDEX IF NOT EXISTS ix_q_date   ON queue(the_date, status);
CREATE INDEX IF NOT EXISTS ix_q_status ON queue(status);

CREATE TABLE IF NOT EXISTS queue_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
    at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    from_state TEXT, to_state TEXT, actor TEXT, reason TEXT
);
"""


class TransitionError(ValueError):
    """허용되지 않은 상태 전이."""


def _hash(v: Any) -> str:
    return hashlib.sha256(str(v).encode()).hexdigest()[:16]


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


@dataclass
class Item:
    id: int
    the_date: str
    routine: str
    field: str
    subject_key: str
    subject_name: str
    value: str
    value_hash: str
    note: str = ""
    status: str = Status.DRAFT.value
    approved_by: str = ""
    result: str = ""

    @property
    def state(self) -> Status:
        return Status(self.status)

    @property
    def key(self) -> str:
        return f"{self.routine}.{self.field}"

    @property
    def approval_valid(self) -> bool:
        """승인이 지금 값에 대해 유효한가."""
        return (self.state is Status.APPROVED
                and bool(self.approved_by)
                and self.value_hash == _hash(self.value))

    def summary(self) -> str:
        v = self.value if len(self.value) <= 40 else self.value[:39] + "…"
        return (f"[{self.state.label}] {self.subject_name} · {self.key} · {v}"
                + (f" (승인 {self.approved_by})" if self.approved_by else ""))


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or QUEUE_DB
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def _row(r: sqlite3.Row) -> Item:
    d = dict(r)
    for k in ("approved_at", "sent_at", "created_at", "updated_at"):
        d.pop(k, None)
    return Item(**d)


def _log(conn: sqlite3.Connection, item_id: int, frm: str, to: str,
         actor: str, reason: str) -> None:
    conn.execute(
        "INSERT INTO queue_history (item_id, from_state, to_state, actor, reason)"
        " VALUES (?,?,?,?,?)", (item_id, frm, to, actor, reason))


# ─────────────────────────────────────────────────────────────
# 넣기 / 고치기
# ─────────────────────────────────────────────────────────────
def enqueue(conn: sqlite3.Connection, *, the_date: str, routine: str,
            field_name: str, subject_key: str, subject_name: str,
            value: Any, note: str = "") -> Item:
    """대기열에 넣습니다. 같은 (날짜·루틴·필드·대상) 이면 **덮어씁니다.**

    덮어쓰면 승인은 자동으로 풀립니다 (값이 바뀌었으므로).
    이미 전송된 항목은 건드리지 않습니다.
    """
    v = "" if value is None else str(value)
    existing = conn.execute(
        "SELECT * FROM queue WHERE the_date=? AND routine=? AND field=? "
        "AND subject_key=?", (the_date, routine, field_name, subject_key)).fetchone()

    if existing and Status(existing["status"]) is Status.SENT:
        raise TransitionError(
            f"이미 전송된 항목입니다 (#{existing['id']}). 새 항목을 만드세요.")

    with conn:
        if existing:
            changed = existing["value"] != v
            new_status = (Status.DRAFT.value if changed else existing["status"])
            conn.execute(
                """UPDATE queue SET value=?, value_hash=?, note=?, status=?,
                   approved_by=CASE WHEN ? THEN '' ELSE approved_by END,
                   approved_at=CASE WHEN ? THEN NULL ELSE approved_at END,
                   updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (v, _hash(v), note, new_status, changed, changed, existing["id"]))
            if changed:
                _log(conn, existing["id"], existing["status"], new_status,
                     "system", "값이 바뀌어 승인이 취소됨")
            iid = existing["id"]
        else:
            cur = conn.execute(
                """INSERT INTO queue (the_date, routine, field, subject_key,
                   subject_name, value, value_hash, note)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (the_date, routine, field_name, subject_key, subject_name,
                 v, _hash(v), note))
            iid = int(cur.lastrowid or 0)
            _log(conn, iid, "", Status.DRAFT.value, "system", "생성")
    return get(conn, iid)  # type: ignore[return-value]


def get(conn: sqlite3.Connection, item_id: int) -> Item | None:
    r = conn.execute("SELECT * FROM queue WHERE id=?", (item_id,)).fetchone()
    return _row(r) if r else None


def _transit(conn: sqlite3.Connection, item_id: int, to: Status, *,
             actor: str = "", reason: str = "", **extra: Any) -> Item:
    it = get(conn, item_id)
    if it is None:
        raise KeyError(f"큐 항목이 없습니다: {item_id}")
    if to not in TRANSITIONS[it.state]:
        raise TransitionError(
            f"{it.state.label} → {to.label} 은 허용되지 않습니다 "
            f"(가능: {', '.join(s.label for s in TRANSITIONS[it.state]) or '없음'})")

    sets = ["status=?", "updated_at=CURRENT_TIMESTAMP"]
    args: list[Any] = [to.value]
    for k, v in extra.items():
        sets.append(f"{k}=?")
        args.append(v)
    args.append(item_id)

    with conn:
        conn.execute(f"UPDATE queue SET {', '.join(sets)} WHERE id=?", args)
        _log(conn, item_id, it.status, to.value, actor, reason)
    return get(conn, item_id)  # type: ignore[return-value]


def review(conn: sqlite3.Connection, item_id: int, *, actor: str = "") -> Item:
    """미리보기를 봤음을 기록합니다 (G13 의 영속 버전)."""
    return _transit(conn, item_id, Status.REVIEWED, actor=actor,
                    reason="미리보기 확인")


def approve(conn: sqlite3.Connection, item_id: int, *, by: str) -> Item:
    """HITL 승인 (G14 의 영속 버전). 검토를 거치지 않으면 승인할 수 없습니다."""
    if not by.strip():
        raise ValueError("승인자 이름이 필요합니다")
    return _transit(conn, item_id, Status.APPROVED, actor=by.strip(),
                    reason="승인", approved_by=by.strip(), approved_at=_now())


def revoke(conn: sqlite3.Connection, item_id: int, *, actor: str = "",
           reason: str = "승인 철회") -> Item:
    return _transit(conn, item_id, Status.REVIEWED, actor=actor, reason=reason,
                    approved_by="", approved_at=None)


def mark_sent(conn: sqlite3.Connection, item_id: int, *, result: str = "") -> Item:
    return _transit(conn, item_id, Status.SENT, actor="gateway",
                    reason=result or "전송 완료", sent_at=_now(), result=result)


def mark_failed(conn: sqlite3.Connection, item_id: int, *, result: str) -> Item:
    return _transit(conn, item_id, Status.FAILED, actor="gateway",
                    reason=result, result=result)


def discard(conn: sqlite3.Connection, item_id: int, *, actor: str = "",
            reason: str = "") -> Item:
    return _transit(conn, item_id, Status.DISCARDED, actor=actor,
                    reason=reason or "버림")


# ─────────────────────────────────────────────────────────────
# 조회
# ─────────────────────────────────────────────────────────────
def list_items(conn: sqlite3.Connection, *, the_date: str | None = None,
               status: str | None = None, routine: str | None = None,
               include_terminal: bool = False) -> list[Item]:
    where, args = [], []
    if the_date:
        where.append("the_date=?")
        args.append(the_date)
    if status:
        where.append("status=?")
        args.append(status)
    if routine:
        where.append("routine=?")
        args.append(routine)
    if not include_terminal and not status:
        where.append("status NOT IN ('sent','discarded')")
    sql = "SELECT * FROM queue"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY subject_name, routine, field"
    return [_row(r) for r in conn.execute(sql, args)]


def ready_to_send(conn: sqlite3.Connection, *, the_date: str | None = None
                  ) -> list[Item]:
    """승인이 **지금 값에 대해** 유효한 것만. 값이 바뀐 승인은 제외됩니다."""
    return [it for it in list_items(conn, the_date=the_date,
                                    status=Status.APPROVED.value)
            if it.approval_valid]


def history(conn: sqlite3.Connection, item_id: int) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM queue_history WHERE item_id=? ORDER BY id", (item_id,))]


def summary(conn: sqlite3.Connection, *, the_date: str | None = None
            ) -> dict[str, Any]:
    from collections import Counter

    rows = list_items(conn, the_date=the_date, include_terminal=True)
    c = Counter(r.status for r in rows)
    return {
        "total": len(rows),
        "by_status": {Status(k).label: v for k, v in c.items()},
        "ready": len(ready_to_send(conn, the_date=the_date)),
        "pending_review": c.get(Status.DRAFT.value, 0),
        "pending_approval": c.get(Status.REVIEWED.value, 0),
    }
