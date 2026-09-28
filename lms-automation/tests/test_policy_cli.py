# -*- coding: utf-8 -*-
"""
승격 원장과 CLI 계약 테스트.

이 두 가지는 "어떤 에이전트로 열어도 똑같이 작동한다"를 떠받치는 축입니다.
원장이 깨지면 몰래 자동화가 되고, CLI 계약이 깨지면 에이전트마다 다른
방식으로 서버를 건드리게 됩니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ganga.cli import COMMANDS, RISK_LOCAL, RISK_READ, build_parser  # noqa: E402
from ganga.policy import Entry, Ledger, Mode  # noqa: E402


@pytest.fixture
def led(tmp_path) -> Ledger:
    return Ledger(path=tmp_path / "policy.json")


# ─────────────────────────────────────────────────────────────
# 승격 원장
# ─────────────────────────────────────────────────────────────
def test_모든_항목이_수동으로_시작한다(led):
    """기본값이 자동인 항목이 하나라도 있으면 안 됩니다."""
    assert led.entries
    assert all(e.mode_enum is Mode.MANUAL for e in led.entries.values())
    assert led.summary()["auto"] == 0


def test_수동에서_자동으로_건너뛸_수_없다(led):
    e = led.promote("cism", "i_1")
    assert e.mode_enum is Mode.SUGGEST, "manual 다음은 suggest 여야 합니다"
    e = led.promote("cism", "i_1")
    assert e.mode_enum is Mode.AUTO


def test_자동에서_더_올라가지_않는다(led):
    led.promote("cism", "i_1")
    led.promote("cism", "i_1")
    e = led.promote("cism", "i_1")
    assert e.mode_enum is Mode.AUTO


def test_강등은_한번에_수동까지(led):
    led.promote("cism", "i_1")
    led.promote("cism", "i_1")
    e = led.demote("cism", "i_1", reason="오작동")
    assert e.mode_enum is Mode.MANUAL


def test_변경이력이_남는다(led):
    led.promote("day_record", "progress", reason="검증 완료")
    e = led.get("day_record", "progress")
    assert e.history
    assert e.history[-1]["from"] == "manual"
    assert e.history[-1]["to"] == "suggest"
    assert e.history[-1]["reason"] == "검증 완료"
    assert e.history[-1]["at"]


def test_수동이면_LLM이_초안조차_못만든다(led):
    assert not led.llm_may_draft("cism", "i_1")
    assert not led.may_send("cism", "i_1")


def test_제안단계는_초안만_되고_전송은_안된다(led):
    led.promote("cism", "i_1")
    assert led.llm_may_draft("cism", "i_1")
    assert not led.may_send("cism", "i_1"), "suggest 인데 전송이 허용됐습니다"


def test_자동단계라야_전송이_허용된다(led):
    led.promote("cism", "i_1")
    led.promote("cism", "i_1")
    assert led.may_send("cism", "i_1")


def test_없는_항목은_예외(led):
    with pytest.raises(KeyError):
        led.promote("nope", "nothing")


def test_모르는_항목은_기본이_수동(led):
    """원장에 없는 것을 물으면 가장 보수적인 답을 줘야 합니다."""
    assert led.mode("unknown", "field") is Mode.MANUAL
    assert not led.llm_may_draft("unknown", "field")


def test_저장후_다시_읽어도_유지된다(tmp_path):
    p = tmp_path / "policy.json"
    Ledger(path=p).promote("cism", "s_1", reason="x")
    assert Ledger(path=p).mode("cism", "s_1") is Mode.SUGGEST


def test_새_루틴항목이_생기면_수동으로_편입된다(tmp_path):
    p = tmp_path / "policy.json"
    a = Ledger(path=p)
    a.promote("cism", "i_1")
    # 원장에서 한 항목을 지운 뒤 다시 로드 → 기본값으로 복원되어야 함
    del a.entries["day_record.progress"]
    a.save()
    b = Ledger(path=p)
    assert "day_record.progress" in b.entries
    assert b.mode("day_record", "progress") is Mode.MANUAL
    assert b.mode("cism", "i_1") is Mode.SUGGEST, "기존 설정이 보존돼야 합니다"


def test_수업일지_필수항목이_원장에_모두_있다(led):
    from ganga.lms.endpoints import DAY_RECORD_REQUIRED

    for f in DAY_RECORD_REQUIRED:
        assert led.get("day_record", f) is not None, f"{f} 가 원장에 없습니다"


def test_CISM_8항목이_원장에_모두_있다(led):
    from ganga.lms.endpoints import CISM_FIELDS

    for fid in CISM_FIELDS:
        assert led.get("cism", fid) is not None, f"{fid} 가 원장에 없습니다"


def test_위험한_일정변경도_원장에_있다(led):
    assert led.get("schedule", "move") is not None
    assert led.get("schedule", "add") is not None


# ─────────────────────────────────────────────────────────────
# CLI 계약
# ─────────────────────────────────────────────────────────────
def test_모든_명령에_위험등급이_있다():
    for name, meta in COMMANDS.items():
        assert meta["risk"] in (RISK_READ, RISK_LOCAL, "write"), name
        assert meta["help"], name


def test_에이전트가_기대하는_명령이_모두_있다():
    """AGENTS.md 가 약속한 명령 목록. 하나라도 사라지면 계약 위반입니다."""
    expected = {"doctor", "status", "roster", "day-record", "cism", "check",
                "catalog", "assets", "index", "search", "plan", "draft", "gates", "journal", "lectures", "policy", "serve"}
    assert expected <= set(COMMANDS), f"누락: {expected - set(COMMANDS)}"


#: --date 가 필수인 명령들. 새 명령을 추가하면 여기도 갱신해야 합니다.
DATE_REQUIRED = ("day-record", "cism", "check", "draft", "sync-keys",
                 "alimtalk", "send", "flush")

#: 명령별 추가 필수 인자
EXTRA_REQUIRED = {
    "send": ["--student", "홍길동", "--field", "progress", "--value", "x"],
}


def _min_args(name: str) -> list[str]:
    out = ["--date", "2026-08-20"] if name in DATE_REQUIRED else []
    return out + EXTRA_REQUIRED.get(name, [])


def test_모든_명령이_json출력을_지원한다():
    p = build_parser()
    for name in COMMANDS:
        args = p.parse_args([name, "--json"] + _min_args(name))
        assert args.json is True, name


# ─────────────────────────────────────────────────────────────
# 쓰기 명령은 --commit 없이 아무것도 하지 않는다
# ─────────────────────────────────────────────────────────────
def test_send는_기본이_dry_run():
    """`--commit` 을 빼먹었을 때 서버로 나가면 안 됩니다."""
    args = build_parser().parse_args(["send"] + _min_args("send"))
    assert args.commit is False


def test_send만_write_등급이다():
    """읽기 명령이 실수로 write 로 바뀌지 않았는지."""
    writes = {n for n, m in COMMANDS.items() if m["risk"] == "write"}
    assert writes == {"send", "flush"}, f"예상 밖의 쓰기 명령: {writes}"


def test_send는_알려진_필드만_받는다():
    from ganga.lms.endpoints import DAY_RECORD_WRITE

    p = build_parser()
    with pytest.raises(SystemExit):
        p.parse_args(["send", "--date", "2026-08-20", "--student", "홍길동",
                      "--field", "아무거나", "--value", "x"])
    for f in DAY_RECORD_WRITE:
        p.parse_args(["send", "--date", "2026-08-20", "--student", "홍길동",
                      "--field", f, "--value", "x"])


def test_읽기명령은_서버에_쓰지_않는다():
    """read 등급 명령이 실수로 write 로 바뀌지 않았는지."""
    for name in ("status", "roster", "day-record", "cism", "catalog", "check"):
        assert COMMANDS[name]["risk"] == RISK_READ, name


def test_날짜인자가_필수인_명령():
    p = build_parser()
    for name in DATE_REQUIRED:
        with pytest.raises(SystemExit):
            p.parse_args([name])


# ─────────────────────────────────────────────────────────────
# 에이전트 계약 문서
# ─────────────────────────────────────────────────────────────
def test_에이전트_계약문서가_존재한다():
    for f in ("AGENTS.md", "CLAUDE.md", "GEMINI.md"):
        assert (ROOT / f).exists(), f"{f} 가 없습니다"


def test_보조문서는_정본을_가리킨다():
    for f in ("CLAUDE.md", "GEMINI.md"):
        text = (ROOT / f).read_text(encoding="utf-8")
        assert "AGENTS.md" in text, f"{f} 가 정본을 가리키지 않습니다"


def test_정본에_절대규칙이_들어있다():
    text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    for keyword in ("쿠키", "200", "승격", "빠뜨리지 않는 것", "python -m ganga"):
        assert keyword in text, f"AGENTS.md 에 '{keyword}' 가 없습니다"
