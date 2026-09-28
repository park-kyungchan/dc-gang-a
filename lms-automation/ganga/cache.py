# -*- coding: utf-8 -*-
"""
TTL 디스크 캐시.

왜 필요한가
    학생 명단 한 번 읽는 데 LMS 에 POST 16번이 나갑니다. 화면 열 때마다
    그러면 느리고 서버에도 부담입니다. 반면 수업일지는 쓰기 대상이라
    한 순간이라도 낡으면 안 됩니다. 그래서 자원별 TTL 로 갈랐습니다.

원칙
    · TTL=0 이면 캐시하지 않습니다 (수업일지).
    · 캐시가 낡았는지 여부를 **항상 호출자에게 알려줍니다.** 화면에
      "3분 전 기준" 을 띄워 선생님이 판단할 수 있게 하기 위해서입니다.
    · 학생 개인정보가 들어간 캐시는 `data/cache/` 에 저장되고 .gitignore
      로 차단됩니다.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from .config import CACHE_DIR, settings

T = TypeVar("T")


@dataclass
class CachedValue:
    """캐시 조회 결과. 값과 함께 '얼마나 낡았는지'를 같이 돌려줍니다."""

    value: Any
    fetched_at: float
    from_cache: bool
    ttl: int

    @property
    def age_seconds(self) -> float:
        return max(0.0, time.time() - self.fetched_at)

    @property
    def is_stale(self) -> bool:
        return self.ttl > 0 and self.age_seconds > self.ttl

    @property
    def age_label(self) -> str:
        a = int(self.age_seconds)
        if not self.from_cache:
            return "방금 조회"
        if a < 60:
            return f"{a}초 전 기준"
        if a < 3600:
            return f"{a // 60}분 전 기준"
        if a < 86400:
            return f"{a // 3600}시간 전 기준"
        return f"{a // 86400}일 전 기준"

    def meta(self) -> dict[str, Any]:
        return {
            "from_cache": self.from_cache,
            "age_seconds": round(self.age_seconds),
            "age_label": self.age_label,
            "is_stale": self.is_stale,
            "ttl": self.ttl,
        }


def _path(key: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)
    return CACHE_DIR / f"{safe}.json"


def read(key: str, ttl: int) -> CachedValue | None:
    """살아 있는 캐시가 있으면 돌려줍니다. 없거나 만료면 None."""
    if ttl <= 0:
        return None
    p = _path(key)
    if not p.exists():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        fetched_at = float(raw["fetched_at"])
    except (OSError, ValueError, KeyError):
        return None

    cv = CachedValue(raw.get("value"), fetched_at, from_cache=True, ttl=ttl)
    return None if cv.is_stale else cv


def write(key: str, value: Any, ttl: int) -> None:
    if ttl <= 0:
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _path(key).write_text(
        json.dumps({"fetched_at": time.time(), "value": value}, ensure_ascii=False),
        encoding="utf-8",
    )


def invalidate(key: str | None = None) -> int:
    """key 를 지우거나(None 이면 전부) 개수를 돌려줍니다."""
    if key:
        p = _path(key)
        if p.exists():
            p.unlink()
            return 1
        return 0
    n = 0
    if CACHE_DIR.exists():
        for p in CACHE_DIR.glob("*.json"):
            p.unlink()
            n += 1
    return n


def cached(
    key: str,
    producer: Callable[[], Any],
    *,
    ttl_key: str | None = None,
    ttl: int | None = None,
    force: bool = False,
) -> CachedValue:
    """캐시가 살아 있으면 그것을, 아니면 `producer()` 를 실행해 채웁니다.

    `force=True` 는 화면의 '새로고침' 버튼에 대응합니다.
    """
    effective_ttl = ttl if ttl is not None else settings.ttl.for_key(ttl_key or key)

    if not force:
        hit = read(key, effective_ttl)
        if hit is not None:
            return hit

    value = producer()
    write(key, value, effective_ttl)
    return CachedValue(value, time.time(), from_cache=False, ttl=effective_ttl)


def status() -> list[dict[str, Any]]:
    """캐시 현황 — 화면에 '무엇이 얼마나 낡았는지' 보여주기 위해."""
    out: list[dict[str, Any]] = []
    if not CACHE_DIR.exists():
        return out
    for p in sorted(CACHE_DIR.glob("*.json")):
        key = p.stem
        ttl = settings.ttl.for_key(key)
        try:
            fetched_at = float(json.loads(p.read_text(encoding="utf-8"))["fetched_at"])
        except (OSError, ValueError, KeyError):
            continue
        cv = CachedValue(None, fetched_at, from_cache=True, ttl=ttl)
        out.append({"key": key, "size_kb": round(p.stat().st_size / 1024, 1), **cv.meta()})
    return out
