# -*- coding: utf-8 -*-
"""
외부 제안 원장 강제 — **기각한 것이 슬쩍 들어오지 못하게.**

산문 제안서의 진짜 위험은 "구현이 문서와 어긋나는 것"(drift)이 아니라
**"기각한 제안이 나중에 구현되는 것"** 입니다. 왜 기각했는지가 산문 속에
묻혀 있으면, 다음 사람이나 다음 에이전트가 그냥 좋아 보여서 넣습니다.

그래서 이 파일이 저장소를 훑어 `forbidden` 심볼이 없는지 확인합니다.
누가 `safe_slice_euckr` 를 구현하는 순간 테스트가 깨지고, 실패 메시지가
**왜 안 되는지**를 알려줍니다.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ganga.proposal_ledger import CLAIMS, by_status, summary  # noqa: E402

#: 훑을 대상 — 이 저장소의 파이썬 소스.
#: **원장 자신은 뺍니다.** 기각 사유를 적으려면 기각된 이름을 적어야 하는데,
#: 그걸 "구현됐다" 로 읽으면 원장을 쓸 수가 없습니다.
LEDGER = ROOT / "ganga" / "proposal_ledger.py"
SOURCES = [p for p in (ROOT / "ganga").rglob("*.py") if p != LEDGER]


def _strip_prose(src: str) -> str:
    """주석과 독스트링을 걷어냅니다. **실행되는 코드만** 남깁니다.

    왜 필요한가
        "왜 이걸 기각했는가" 를 설명하려면 기각된 이름을 적어야 합니다.
        그 설명을 "구현했다" 로 읽으면 **설명을 못 쓰게 됩니다.** 그러면
        다음 사람은 왜 안 되는지 모른 채로 다시 구현합니다 — 이 원장이
        막으려던 바로 그 사고입니다.

        원장은 **구현**을 막는 것이지 **언급**을 막는 게 아닙니다.
    """
    import ast
    import io
    import tokenize

    out: list[str] = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type in (tokenize.COMMENT, tokenize.NL):
                continue
            out.append(tok.string if tok.type != tokenize.STRING else '""')
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return src        # 토큰화 실패 시엔 원문 검사 (놓치는 것보다 낫습니다)
    text = " ".join(out)

    # 독스트링은 STRING 토큰이라 위에서 이미 비워졌습니다. 확인만 합니다.
    try:
        ast.parse(src)
    except SyntaxError:
        return src
    return text


def _all_code() -> str:
    return "\n".join(_strip_prose(p.read_text(encoding="utf-8")) for p in SOURCES)


def _all_text() -> str:
    """주석 포함 원문. 인코딩 검사처럼 문자열 리터럴을 봐야 할 때 씁니다."""
    return "\n".join(p.read_text(encoding="utf-8") for p in SOURCES)


# ─────────────────────────────────────────────────────────────
# 기각한 것이 구현되지 않았는가 — 이 파일의 핵심
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "claim", [c for c in CLAIMS if c.forbidden], ids=lambda c: c.id)
def test_기각한_제안이_구현되지_않았다(claim):
    """**구현**을 막습니다. 주석·독스트링의 언급은 잡지 않습니다.

    문자열 리터럴도 비워지므로 `encode("euc-kr"` 같은 형태는 여기서 안 잡힙니다.
    그건 아래 `test_EUC_KR_인코딩이_코드에_없다` 가 원문으로 따로 봅니다.
    """
    code = _all_code()
    hits = [sym for sym in claim.forbidden if sym in code]
    assert not hits, (
        f"\n{claim.id} ({claim.section}) 은 기각된 제안입니다.\n"
        f"  주장: {claim.summary}\n"
        f"  근거: {claim.evidence}\n"
        f"  사유: {claim.note}\n"
        f"  그런데 코드에 있습니다: {hits}"
    )


@pytest.mark.parametrize(
    "claim", [c for c in CLAIMS if c.status == "ADOPTED" and c.expect],
    ids=lambda c: c.id)
def test_채택한_제안이_실제로_구현돼_있다(claim):
    """여기는 **원문**을 봅니다.

    `forbidden` 과 방향이 반대입니다. 기각 검사는 오탐(주석의 언급)을 피해야
    하지만, 채택 검사는 **누락**을 피해야 합니다. SQL 문자열 안의 PRAGMA 처럼
    토큰을 지우면 사라지는 것들이 있어, 지운 코드로 보면 있는 것도 없다고
    나옵니다.
    """
    code = _all_text()
    missing = [sym for sym in claim.expect if sym not in code]
    assert not missing, (
        f"{claim.id} 는 ADOPTED 인데 {missing} 가 코드에 없습니다. "
        f"상태를 PENDING 으로 되돌리거나 구현하세요."
    )


# ─────────────────────────────────────────────────────────────
# 원장 자체의 위생
# ─────────────────────────────────────────────────────────────
def test_모든_주장에_근거가_있다():
    """근거 없는 상태 표시는 그냥 의견입니다."""
    for c in CLAIMS:
        assert c.evidence.strip(), f"{c.id} 에 근거가 없습니다"


def test_반증되거나_기각된_것은_사유를_남긴다():
    for c in CLAIMS:
        if c.status in ("MEASURED_FALSE", "REJECTED"):
            assert c.note.strip(), (
                f"{c.id} 를 배제했는데 사유가 없습니다. 사유가 없으면 "
                f"다음 사람이 왜 안 되는지 몰라서 다시 구현합니다."
            )


def test_주장_id가_중복되지_않는다():
    ids = [c.id for c in CLAIMS]
    assert len(ids) == len(set(ids))


def test_미판단_항목이_남아있음을_드러낸다():
    """PENDING 이 있는 건 정상입니다. **없는 척하는 것**이 문제입니다."""
    s = summary()
    assert s, "원장이 비어 있습니다"
    pending = by_status("PENDING")
    for c in pending:
        assert c.evidence, f"{c.id} 가 PENDING 인데 왜 판단을 못 했는지 안 적혀 있습니다"


def test_EUC_KR_인코딩이_코드에_없다():
    """P-01 의 별도 방어선.

    `forbidden` 문자열 매칭을 우회하는 변형(`encode('euc-kr')` 등)도 잡습니다.
    이 사이트는 UTF-8 이고, EUC-KR 로 인코딩하면 수학기호가 사라집니다.
    """
    code = _all_text().lower().replace(" ", "").replace('"', "'")
    for bad in ("encode('euc-kr')", "encode('euc_kr')", "encode('cp949')"):
        assert bad not in code, f"EUC-KR 인코딩이 코드에 있습니다: {bad}"


def test_자기선언_승인은_근거가_아니다():
    """P-00 — 이 교훈이 원장에 남아 있는지."""
    from ganga.proposal_ledger import by_id

    meta = by_id("P-00")
    assert meta.status == "MEASURED_FALSE"
    assert "자기선언" in meta.note or "APPROVED" in meta.note
