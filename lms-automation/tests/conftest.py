# -*- coding: utf-8 -*-
"""
테스트 공용 설정.

여기서 푸는 문제
    저장소에는 **교재 PDF 가 없습니다** (학원 저작물이라 일부러 뺐습니다).
    그래서 갓 클론한 기계에서 PDF 가 필요한 테스트가 **실패**로 떴습니다.

    실패와 "재료 없음" 은 다릅니다. 클론 직후 빨간 화면이 뜨면 사람은
    빨강을 무시하기 시작하고, 그러면 **진짜 실패도 같이 묻힙니다.**
    없는 것은 없다고 말해야 합니다 — skip 입니다.

    `ganga assets` 로 PDF 를 받으면 이 테스트들이 저절로 켜집니다.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


# ─────────────────────────────────────────────────────────────
# 재료가 있는가
# ─────────────────────────────────────────────────────────────
def has_textbook_pdf() -> bool:
    """담당 교재 본문 PDF 가 로컬에 있는가."""
    try:
        from ganga.config import ASSET_DIR
        from ganga.curriculum import MY_BOOKS
    except Exception:      # noqa: BLE001
        return False
    for book in MY_BOOKS:
        fn = book.sample_filename()
        if fn and (ASSET_DIR / fn).exists():
            return True
    return False


def has_problem_index() -> bool:
    from ganga.config import INDEX_DB

    return INDEX_DB.exists()


def has_git() -> bool:
    """`git check-ignore` 를 쓸 수 있는가.

    `.gitignore` 가 실제로 막는지 확인하려면 git 저장소 안이어야 합니다.
    tarball 로 풀었거나 git 없는 컨테이너면 확인할 방법이 없습니다 —
    그때는 **통과했다고 하지 않고 건너뜁니다.** 못 본 것을 봤다고 하면 안 됩니다.
    """
    if shutil.which("git") is None:
        return False
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=ROOT, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0 and r.stdout.strip() == "true"


#: 마커 — `@needs_pdf` 처럼 씁니다
needs_pdf = pytest.mark.skipif(
    not has_textbook_pdf(),
    reason="교재 PDF 없음 — `python -m ganga assets` 를 먼저 실행하세요")

needs_index = pytest.mark.skipif(
    not has_problem_index(),
    reason="문항 인덱스 없음 — `python -m ganga index` 를 먼저 실행하세요")

needs_git = pytest.mark.skipif(
    not has_git(),
    reason="git 저장소가 아니라 .gitignore 동작을 확인할 수 없습니다")


def pytest_report_header(config):    # noqa: ARG001
    """무엇이 빠져서 무엇을 못 돌렸는지 **맨 위에** 알려줍니다.

    스킵 수만 보면 왜 스킵됐는지 찾아 들어가야 합니다. 그걸 안 하게 됩니다.
    """
    missing = []
    if not has_textbook_pdf():
        missing.append("교재 PDF (`ganga assets`)")
    if not has_problem_index():
        missing.append("문항 인덱스 (`ganga index`)")
    if not has_git():
        missing.append("git 저장소")
    if not missing:
        return "재료: 전부 있음"
    return ("재료 없음 → 관련 테스트를 건너뜁니다: " + " · ".join(missing)
            + "\n(실패가 아닙니다. 저장소에는 학원 저작물과 학생 정보를 "
              "넣지 않으므로 정상입니다)")
