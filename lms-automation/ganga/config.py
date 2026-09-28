# -*- coding: utf-8 -*-
"""
런타임 설정.

모든 값은 **환경변수 우선**입니다. 시크릿을 파일에 적지 않기 위해서입니다.
`.env` 는 .gitignore 로 차단되어 있으니 로컬 편의용으로만 쓰세요.
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA = ROOT / "data"
CACHE_DIR = DATA / "cache"
ASSET_DIR = DATA / "assets"          # 내려받은 교재 PDF
CATALOG_DIR = DATA / "catalog"
STUDENT_DIR = DATA / "students"      # 개인정보 — .gitignore 로 차단됨
INDEX_DB = DATA / "problem_index.db"


def _env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env(key) or default)
    except ValueError:
        return default


def _env_bool(key: str, default: bool) -> bool:
    v = _env(key).lower()
    if not v:
        return default
    return v in ("1", "true", "yes", "y", "on")


@dataclass
class ServerConfig:
    """로컬 서버 설정.

    ⚠️ **`0.0.0.0` 의 뜻은 기계마다 다릅니다.**

        집 PC + Tailscale   tailnet 안에서만 보임 — 안전
        공인 IP VPS         **전 인터넷에 열림**

    이 서버는 학생 실명과 강사 LMS 세션을 들고 있습니다. 뚫리면 학원 서버에
    선생님 권한으로 쓰기가 됩니다. 그래서 **루프백이 아닌 주소에 붙일 때는
    토큰을 직접 정하게** 합니다 — 자동 생성 토큰은 재시작마다 바뀌어서
    폰에 저장해 둔 링크가 죽고, 그러면 사람이 토큰을 꺼 버리기 때문입니다.
    """

    host: str = field(default_factory=lambda: _env("GANGA_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: _env_int("GANGA_PORT", 8765))

    #: 접속 토큰. Tailscale 이 이미 암호화·인증을 하지만, 기기 하나가
    #: 털리거나 tailnet 을 공유하는 경우를 대비한 2차 방어선입니다.
    #: 학생 실명 151명 + 강사 세션이 걸린 서버라 무인증으로 열면 안 됩니다.
    token: str = field(default_factory=lambda: _env("GANGA_TOKEN"))

    #: 로그에 학생 이름을 남기지 않습니다.
    redact_pii_in_logs: bool = field(
        default_factory=lambda: _env_bool("GANGA_REDACT_LOGS", True)
    )

    #: 공개 주소에 붙는 것을 알고 있다고 명시할 때만 참.
    #: 이 스위치가 없으면 VPS 에서 실수로 켜 놓는 일이 생깁니다.
    allow_public: bool = field(
        default_factory=lambda: _env_bool("GANGA_ALLOW_PUBLIC", False)
    )

    #: 루프백 = 이 기계에서만 접근 가능
    LOOPBACK: tuple[str, ...] = ("127.0.0.1", "::1", "localhost")

    @property
    def is_loopback(self) -> bool:
        return self.host in self.LOOPBACK

    def ensure_token(self) -> str:
        """토큰이 없으면 즉석에서 만들어 줍니다 (프로세스 수명 동안만 유효)."""
        if not self.token:
            self.token = secrets.token_urlsafe(18)
        return self.token

    def exposure_check(self) -> list[str]:
        """지금 설정으로 열면 무엇이 위험한가. 빈 목록이면 괜찮습니다.

        판정하지 않고 **알려만 줍니다** — "Tailscale 안인지 공인 IP 인지" 를
        코드가 확실히 알 방법이 없기 때문입니다(규칙 1-6). 대신 사람이
        `GANGA_ALLOW_PUBLIC=1` 로 "알고 있다" 고 말하게 합니다.
        """
        if self.is_loopback:
            return []
        problems: list[str] = []
        if not self.token:
            problems.append(
                f"host={self.host} 로 여는데 GANGA_TOKEN 이 없습니다. "
                f"자동 생성 토큰은 재시작마다 바뀌어 폰 링크가 죽습니다 — "
                f"직접 정해서 환경변수로 주세요"
            )
        if not self.allow_public:
            problems.append(
                f"host={self.host} 는 이 기계의 모든 주소에 붙습니다. "
                f"Tailscale 안이면 안전하지만 공인 IP 서버면 전 인터넷에 "
                f"열립니다. 알고 계시면 GANGA_ALLOW_PUBLIC=1 을 주세요"
            )
        return problems


@dataclass
class CacheTTL:
    """자원별 캐시 수명(초).

    LMS 는 다른 강사들이 계속 바꾸는 살아 있는 서버입니다. 무조건 캐시하면
    낡은 데이터를 보게 되고, 무조건 실시간이면 매 요청마다 16페이지를
    긁느라 느립니다. 자원별로 다르게 잡습니다.
    """

    day_record: int = 0            # 수업일지 — 항상 실시간. 쓰기 대상이라 절대 캐시 금지
    roster: int = 6 * 3600         # 학생 명단 — 반편성은 자주 안 바뀜
    exam_papers: int = 3600        # 시험지 풀 — 다른 강사가 계속 추가함
    answer_catalog: int = 7 * 86400  # 교재 PDF 목록 — 학기 중 거의 불변
    test_papers: int = 1800        # 문제지 조회 — 오늘 만든 것이 바로 보여야 함

    def for_key(self, key: str) -> int:
        return getattr(self, key, 300)


@dataclass
class LlmConfig:
    provider: str = field(default_factory=lambda: _env("GANGA_LLM_PROVIDER", "anthropic"))
    model: str = field(default_factory=lambda: _env("GANGA_LLM_MODEL", "claude-sonnet-5"))
    api_key_env: str = "ANTHROPIC_API_KEY"

    @property
    def available(self) -> bool:
        return bool(os.environ.get(self.api_key_env))


@dataclass
class SafetyConfig:
    """쓰기 안전장치. 기본값은 전부 보수적입니다."""

    dry_run: bool = field(default_factory=lambda: _env_bool("GANGA_DRY_RUN", True))
    require_writeback_verify: bool = True
    max_writes_per_run: int = field(
        default_factory=lambda: _env_int("GANGA_MAX_WRITES", 50)
    )
    #: HITL — 사람 승인 없이 전송 금지
    require_human_approval: bool = True


@dataclass
class Settings:
    server: ServerConfig = field(default_factory=ServerConfig)
    ttl: CacheTTL = field(default_factory=CacheTTL)
    llm: LlmConfig = field(default_factory=LlmConfig)
    safety: SafetyConfig = field(default_factory=SafetyConfig)

    def ensure_dirs(self) -> None:
        for d in (CACHE_DIR, ASSET_DIR, CATALOG_DIR, STUDENT_DIR):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
