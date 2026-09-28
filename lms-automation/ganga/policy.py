# -*- coding: utf-8 -*-
"""
자동화 승격 원장 (Automation Promotion Ledger).

왜 필요한가
    "자동화로 승격해야 하는 부분과 그렇지 않은 부분을 계속 유저에게 물어보면 된다"
    — 이걸 매번 대화로 물으면 답이 휘발되고, 어느 항목이 어디까지 자동화됐는지
    아무도 모르게 됩니다. 그래서 **파일로 기록**합니다.

3단계 승격
    manual   선생님이 직접 씁니다. LLM 은 손대지 않습니다.
    suggest  LLM 이 초안을 제시하지만 **전송하지 않습니다.** 사람이 고쳐 씁니다.
    auto     게이트를 통과하면 전송까지 갑니다. 그래도 사람 승인은 필요합니다
             (`require_human_approval`).

승격 규칙
    · 새 항목은 **반드시 manual 로 시작**합니다. 기본값이 자동인 것은 없습니다.
    · 한 단계씩만 올라갑니다. manual → auto 로 건너뛸 수 없습니다.
    · 강등은 언제든 한 번에 가능합니다.
    · 모든 변경에 사유와 시각이 남습니다.

이 원장은 게이트가 강제합니다. 원장이 manual 인 항목을 LLM 이 채우려 하면
게이트에서 막힙니다. 즉 "몰래 자동화되는 일"이 구조적으로 불가능합니다.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .config import DATA


class Mode(str, Enum):
    MANUAL = "manual"
    SUGGEST = "suggest"
    AUTO = "auto"

    @property
    def rank(self) -> int:
        return {"manual": 0, "suggest": 1, "auto": 2}[self.value]

    @property
    def label(self) -> str:
        return {
            "manual": "수동 (LLM 관여 없음)",
            "suggest": "제안 (초안만, 전송 안 함)",
            "auto": "자동 (게이트 통과 시 전송, 승인 필요)",
        }[self.value]


POLICY_PATH = DATA / "automation_policy.json"


@dataclass
class Entry:
    routine: str          # day_record / cism / schedule …
    field: str            # progress / i_1 …
    label: str
    mode: str = Mode.MANUAL.value
    note: str = ""
    history: list[dict[str, str]] = field(default_factory=list)

    @property
    def mode_enum(self) -> Mode:
        return Mode(self.mode)

    @property
    def key(self) -> str:
        return f"{self.routine}.{self.field}"

    def llm_may_draft(self) -> bool:
        return self.mode_enum.rank >= Mode.SUGGEST.rank

    def may_send(self) -> bool:
        return self.mode_enum is Mode.AUTO


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def default_entries() -> list[Entry]:
    """실측된 루틴을 근거로 초기 원장을 만듭니다. 전부 manual 로 시작합니다."""
    from .lms.endpoints import CISM_FIELDS, DAY_RECORD_WRITE

    out: list[Entry] = []
    for name, spec in DAY_RECORD_WRITE.items():
        out.append(Entry(routine="day_record", field=name,
                         label=str(spec.get("label", name))))
    for fid, label in CISM_FIELDS.items():
        out.append(Entry(routine="cism", field=fid, label=label))
    out.append(Entry(routine="schedule", field="move",
                     label="일정 이동 (결석/보강)",
                     note="위험도 높음. 잘못 옮기면 학생이 수업을 못 옵니다."))
    out.append(Entry(routine="schedule", field="add",
                     label="보강 일정 추가",
                     note="위험도 높음."))
    return out


class Ledger:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or POLICY_PATH
        self.entries: dict[str, Entry] = {}
        self.load()

    # -- 입출력 ---------------------------------------------------------
    def load(self) -> None:
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                self.entries = {k: Entry(**v) for k, v in raw.items()}
            except (OSError, ValueError, TypeError):
                self.entries = {}
        if not self.entries:
            self.entries = {e.key: e for e in default_entries()}
            self.save()
        else:
            # 새로 생긴 루틴 항목을 manual 로 편입 (기존 설정은 보존)
            added = False
            for e in default_entries():
                if e.key not in self.entries:
                    self.entries[e.key] = e
                    added = True
            if added:
                self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({k: asdict(v) for k, v in self.entries.items()},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # -- 조회 -----------------------------------------------------------
    def get(self, routine: str, field_name: str) -> Entry | None:
        return self.entries.get(f"{routine}.{field_name}")

    def mode(self, routine: str, field_name: str) -> Mode:
        e = self.get(routine, field_name)
        return e.mode_enum if e else Mode.MANUAL

    def llm_may_draft(self, routine: str, field_name: str) -> bool:
        e = self.get(routine, field_name)
        return bool(e and e.llm_may_draft())

    def may_send(self, routine: str, field_name: str) -> bool:
        e = self.get(routine, field_name)
        return bool(e and e.may_send())

    def by_routine(self, routine: str) -> list[Entry]:
        return [e for e in self.entries.values() if e.routine == routine]

    def pending_promotion(self) -> list[Entry]:
        """아직 수동인 항목 — 승격 후보로 물어볼 대상."""
        return [e for e in self.entries.values() if e.mode_enum is Mode.MANUAL]

    # -- 변경 -----------------------------------------------------------
    def promote(self, routine: str, field_name: str, *, reason: str = "") -> Entry:
        """한 단계만 올립니다. manual → auto 로 건너뛸 수 없습니다."""
        e = self.get(routine, field_name)
        if e is None:
            raise KeyError(f"{routine}.{field_name} 항목이 없습니다")
        cur = e.mode_enum
        if cur is Mode.AUTO:
            return e
        nxt = Mode.SUGGEST if cur is Mode.MANUAL else Mode.AUTO
        return self._set(e, nxt, reason=reason or "승격")

    def demote(self, routine: str, field_name: str, *,
               to: Mode = Mode.MANUAL, reason: str = "") -> Entry:
        """강등은 한 번에 가능합니다. 문제가 생기면 즉시 내려야 하니까요."""
        e = self.get(routine, field_name)
        if e is None:
            raise KeyError(f"{routine}.{field_name} 항목이 없습니다")
        return self._set(e, to, reason=reason or "강등")

    def _set(self, e: Entry, mode: Mode, *, reason: str) -> Entry:
        e.history.append({"at": _now(), "from": e.mode, "to": mode.value,
                          "reason": reason})
        e.mode = mode.value
        self.save()
        return e

    # -- 보고 -----------------------------------------------------------
    def summary(self) -> dict[str, Any]:
        from collections import Counter

        c = Counter(e.mode for e in self.entries.values())
        return {
            "total": len(self.entries),
            "manual": c.get("manual", 0),
            "suggest": c.get("suggest", 0),
            "auto": c.get("auto", 0),
            "path": str(self.path),
        }

    def table(self) -> list[dict[str, str]]:
        return [
            {"key": e.key, "label": e.label, "mode": e.mode,
             "mode_label": e.mode_enum.label, "note": e.note}
            for e in sorted(self.entries.values(), key=lambda x: (x.routine, x.field))
        ]
