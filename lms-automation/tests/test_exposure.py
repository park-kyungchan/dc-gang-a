# -*- coding: utf-8 -*-
"""
공개 노출 방어 — VPS 로 옮기면서 생긴 위험.

`0.0.0.0` 의 뜻은 기계마다 다릅니다.

    집 PC + Tailscale   tailnet 안에서만 보임 — 안전
    공인 IP VPS         **전 인터넷에 열림**

이 서버에는 학생 실명과 강사 LMS 세션이 걸려 있습니다. 뚫리면 학원 서버에
선생님 권한으로 쓰기가 됩니다. 코드가 "지금 Tailscale 안인가" 를 확실히 알
방법은 없으므로(규칙 1-6), **사람이 알고 있다고 말하게** 합니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ganga.config import ServerConfig  # noqa: E402


def cfg(**env) -> ServerConfig:
    c = ServerConfig()
    for k, v in env.items():
        setattr(c, k, v)
    return c


def test_루프백은_아무_조건_없이_열린다():
    for h in ("127.0.0.1", "::1", "localhost"):
        c = cfg(host=h, token="", allow_public=False)
        assert c.is_loopback
        assert c.exposure_check() == [], h


def test_공개주소는_토큰_없이_안_열린다():
    c = cfg(host="0.0.0.0", token="", allow_public=True)
    assert any("GANGA_TOKEN" in p for p in c.exposure_check())


def test_공개주소는_알고있다고_말해야_열린다():
    """`GANGA_ALLOW_PUBLIC` 이 없으면 막습니다. VPS 에서 실수로 켜는 것을 막습니다."""
    c = cfg(host="0.0.0.0", token="비밀토큰", allow_public=False)
    problems = c.exposure_check()
    assert any("GANGA_ALLOW_PUBLIC" in p for p in problems)


def test_둘_다_갖추면_통과():
    c = cfg(host="0.0.0.0", token="비밀토큰", allow_public=True)
    assert c.exposure_check() == []


def test_둘_다_없으면_둘_다_알려준다():
    """하나씩 고치게 하면 두 번 실행하게 됩니다."""
    c = cfg(host="0.0.0.0", token="", allow_public=False)
    assert len(c.exposure_check()) == 2


def test_임의의_외부주소도_같은_검사를_받는다():
    c = cfg(host="10.0.0.5", token="", allow_public=False)
    assert not c.is_loopback
    assert c.exposure_check()


def test_토큰_자동생성은_공개주소에서_근거가_안_된다():
    """자동 생성 토큰은 재시작마다 바뀌어 폰 링크가 죽습니다.

    그러면 사람이 토큰을 아예 꺼 버립니다. 공개 주소에서는 직접 정하게 합니다.
    """
    c = cfg(host="0.0.0.0", token="", allow_public=True)
    c.ensure_token()                      # 자동 생성
    assert c.token                        # 생성은 됩니다
    c2 = cfg(host="0.0.0.0", token="", allow_public=True)
    assert c2.exposure_check(), "자동 생성만으로 통과하면 안 됩니다"
