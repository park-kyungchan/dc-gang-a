# -*- coding: utf-8 -*-
"""
독립 검증(2026-08-19)에서 발견된 결함에 대한 회귀 테스트.

각 테스트는 "이 버그가 다시 들어오면 빨간불이 켜진다"를 보장합니다.
테스트 이름에 원래 결함 번호를 달아 두었습니다.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from conftest import needs_git  # noqa: E402

from ganga.lms.endpoints import DAY_RECORD_WRITE_UNVERIFIED  # noqa: E402
from ganga.lms.reader import Roster, Student, last_page  # noqa: E402
from ganga.lms.writer import (  # noqa: E402
    DayRecordWriter,
    WriteResult,
    WriteStatus,
    judge_response,
)


# ─────────────────────────────────────────────────────────────
# M-3: judge_response 오탐
# ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "body",
    [
        "저장되지 않았습니다",          # '저장'으로 시작하지만 부정문
        "저장에 실패했습니다",
        "1724054400000",               # 타임스탬프
        "1001 Unauthorized - session invalid",
        "okay, nothing was saved",
        "truetype",
    ],
)
def test_M3_성공처럼_보이는_응답을_성공으로_읽지_않는다(body):
    ok, detail = judge_response(body)
    assert not ok, f"오탐: {body!r} → {detail}"


@pytest.mark.parametrize("body", ["OK", "ok", "success", "TRUE", "1", "저장되었습니다"])
def test_M3_진짜_성공응답은_인식한다(body):
    ok, _ = judge_response(body)
    assert ok


def test_M3_긴_HTML은_성공으로_치지_않는다():
    ok, detail = judge_response("<html><body>ok</body></html>" + "가" * 500)
    assert not ok


# ─────────────────────────────────────────────────────────────
# M-2: 역검증 오탐
# ─────────────────────────────────────────────────────────────
class _FakePage:
    def __init__(self, rows):
        self.rows = rows


class _FakeTeacher:
    pri_no = "1292923"


class _FakeLms:
    teacher = _FakeTeacher()


VALID = {
    "course_seq": "12345", "stu_pri_no": "98765",
    "record_seq": "54321", "cm_seq": "11223",
}


def _writer():
    return DayRecordWriter(_FakeLms(), dry_run=False, verify_writeback=True)


@pytest.mark.parametrize("short_value", ["Y", "N", 10, 0, 5, 3])
def test_M2_짧은값은_역검증_통과로_승격되지_않는다(short_value, monkeypatch):
    """'Y'나 10 같은 값은 페이지 어디에나 있어 문자열 대조가 불가능하다.
    이전 구현은 이걸 전부 OK 로 승격시켰다."""
    w = _writer()
    # 우리가 쓴 값이 전혀 없는 페이지지만, 짧은 값은 우연히 매칭된다
    page = _FakePage([["98765", "김민준", "출석 Y", "10점", "5"]])
    monkeypatch.setattr("ganga.lms.reader.read_day_record", lambda *a, **k: page)

    from ganga.lms.writer import WriteReport

    rep = WriteReport()
    rep.results.append(WriteResult("t", WriteStatus.SENT_UNVERIFIED, "", sent=short_value))
    w._verify(rep, VALID, date="2026-08-19", grp_seq="1")

    assert rep.results[0].status is not WriteStatus.OK
    assert "역검증 불가" in rep.results[0].detail


def test_M2_다른학생_행에_매칭되면_통과시키지_않는다(monkeypatch):
    """템플릿 문장은 학생마다 같다. 페이지 전체를 grep 하면 남의 행에 매칭된다."""
    w = _writer()
    other_student_row = ["11111", "다른학생", "[초등 5-1 가우스 2권] p.31 실력쌓기 5~8번 완벽 통과"]
    page = _FakePage([other_student_row])   # 대상 학생(98765) 행이 없음
    monkeypatch.setattr("ganga.lms.reader.read_day_record", lambda *a, **k: page)

    from ganga.lms.writer import WriteReport

    rep = WriteReport()
    rep.results.append(WriteResult(
        "progress", WriteStatus.SENT_UNVERIFIED, "",
        sent="[초등 5-1 가우스 2권] p.31 실력쌓기 5~8번 완벽 통과"))
    w._verify(rep, VALID, date="2026-08-19", grp_seq="1")

    assert rep.results[0].status is WriteStatus.FAILED
    assert "대상 학생 행을 찾지 못함" in rep.results[0].detail


def test_M2_대상학생_행에_있으면_통과시킨다(monkeypatch):
    w = _writer()
    text = "[초등 5-1 가우스 2권] p.31 실력쌓기 5~8번 완벽 통과"
    page = _FakePage([["98765", "김민준", text]])
    monkeypatch.setattr("ganga.lms.reader.read_day_record", lambda *a, **k: page)

    from ganga.lms.writer import WriteReport

    rep = WriteReport()
    rep.results.append(WriteResult("progress", WriteStatus.SENT_UNVERIFIED, "", sent=text))
    w._verify(rep, VALID, date="2026-08-19", grp_seq="1")

    assert rep.results[0].status is WriteStatus.OK


# ─────────────────────────────────────────────────────────────
# M-4: 서블릿 네임스페이스
# ─────────────────────────────────────────────────────────────
def test_M4_CourseCommonServlet은_cct_common_네임스페이스다():
    """cct.tutor 로 조립하면 존재하지 않는 URL 로 나간다."""
    for name in ("daily_test", "hw_rate"):
        s = DAY_RECORD_WRITE_UNVERIFIED[name]["servlet"]
        assert s == "controller.cct.common.CourseCommonServlet", f"{name}: {s}"


def test_M4_DayRecordServlet은_cct_tutor_네임스페이스다():
    for name in ("progress", "homework", "memo", "attendance"):
        s = DAY_RECORD_WRITE_UNVERIFIED[name]["servlet"]
        assert s == "controller.cct.tutor.DayRecordServlet", f"{name}: {s}"


def test_M4_servlet은_전체_패키지경로를_담는다():
    """클래스명만 담으면 호출부가 접두사를 하드코딩하게 되고 그게 버그의 원인이었다."""
    for name, spec in DAY_RECORD_WRITE_UNVERIFIED.items():
        assert spec["servlet"].startswith("controller."), name
        assert spec["servlet"].count(".") >= 3, name


def test_M4_dry_run_URL이_올바르게_조립된다():
    from ganga.lms.writer import WriteReport  # noqa: F401

    w = DayRecordWriter(_FakeLms(), dry_run=True)
    clean = {**VALID, "dt_score": 10}
    r = w._send_one("daily_test", DAY_RECORD_WRITE_UNVERIFIED["daily_test"],
                    "dt_score", clean)
    assert "controller.cct.common.CourseCommonServlet" in r.detail
    assert "cct.tutor.CourseCommonServlet" not in r.detail


# ─────────────────────────────────────────────────────────────
# M-5: 페이지네이션
# ─────────────────────────────────────────────────────────────
def test_M5_슬라이딩_윈도우_페이지네이터를_인식한다():
    """1페이지에 10칸만 보이고 '다음'이 11을 가리키는 형태."""
    html = "".join(f"<a href=\"javascript:goPage({i})\">{i}</a>" for i in range(1, 11))
    html += "<a href=\"javascript:goPage('11')\">다음</a>"
    assert last_page(html) == 11


def test_M5_페이지네이터가_없으면_1페이지로_본다():
    assert last_page("<html>내용만 있음</html>") == 1


def test_M5_Roster는_불완전수집을_경고로_드러낸다():
    r = Roster(students=[Student("a", "가", "초3", "김예원")], pages_read=1)
    assert r.is_complete
    r.warnings.append("16페이지 중 11페이지만 읽었습니다")
    assert not r.is_complete


# ─────────────────────────────────────────────────────────────
# C-2: .gitignore 행끝 주석
# ─────────────────────────────────────────────────────────────
def test_C2_gitignore에_행끝_주석이_없다():
    """gitignore 는 행 끝 주석을 지원하지 않는다.
    `config/config.json   # 설명` 은 아무것도 차단하지 못한다."""
    offenders = []
    for i, line in enumerate((ROOT / ".gitignore").read_text(encoding="utf-8").splitlines(), 1):
        s = line.rstrip()
        if not s or s.lstrip().startswith("#"):
            continue
        if "#" in s:
            offenders.append(f"{i}행: {s}")
    assert not offenders, "행 끝 주석이 패턴을 망가뜨립니다:\n" + "\n".join(offenders)


@pytest.mark.parametrize(
    "path",
    ["config/config.json", ".pw-profile/Default/Cookies", ".env",
     "data/students/STU001_홍길동.db", ".git.backup/config"],
)
@needs_git
def test_C2_민감경로가_실제로_차단된다(path):
    """항상 막아야 하는 것들.

    `data/students/*.db` 는 **일부러 뺐습니다** — 사용자 결정(2026-08-20)으로
    학생 DB 를 저장소에 올립니다(Linux 에서 작업 상태를 그대로 이어받기 위해).
    대신 `test_C4` 가 "그렇다면 private 이어야 한다" 를 지킵니다.

    `STU001_*.db` 는 여전히 막습니다 — **파일명에 실명이 들어갑니다.**
    DB 안의 이름은 열어야 보이지만 파일명은 트리에 그냥 보입니다.

    `.git.backup/` 도 막습니다 — 옛 이력에 실제 세션 쿠키가 있습니다.
    """
    r = subprocess.run(
        ["git", "check-ignore", "--no-index", "-q", path],
        cwd=ROOT, capture_output=True,
    )
    assert r.returncode == 0, f"{path} 가 .gitignore 로 차단되지 않습니다"


# ─────────────────────────────────────────────────────────────
# C-1: 시크릿 잔존
# ─────────────────────────────────────────────────────────────
_SECRET_SHAPE = re.compile(r"\b[0-9A-F]{32}\b")

_SCAN_EXT = {".py", ".json", ".md", ".txt", ".bat", ".yml", ".yaml", ".cfg", ".ini"}
_SKIP_DIRS = {".git", "__pycache__", ".pytest_cache", "node_modules", ".venv", "data"}


def test_C1_작업트리에_세션쿠키_모양의_문자열이_없다():
    hits = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in _SCAN_EXT:
            continue
        if any(part in _SKIP_DIRS for part in p.parts):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in _SECRET_SHAPE.finditer(text):
            hits.append(f"{p.relative_to(ROOT)}: {m.group()[:8]}…")
    assert not hits, "32자리 대문자 HEX(세션 쿠키 형태)가 발견됨:\n" + "\n".join(hits)


# ─────────────────────────────────────────────────────────────
# C3 — 실제 학생 이름이 소스에 박히지 않게
# ─────────────────────────────────────────────────────────────
"""
왜 이 검사가 생겼나 (2026-08-20)

    독립 검증에서 **실제 학생의 실명이 테스트 파일 8개에 하드코딩**돼 있는
    것이 발견됐습니다. `.gitignore` 는 `data/students/` 를 막지만 `tests/`
    는 막지 않습니다. 커밋하면 그대로 나갑니다.

    더 나빴던 건 그 이름이 "저널에 실명이 안 남는다" 를 증명하는 **카나리**
    로 쓰이고 있었다는 점입니다. 실명을 카나리로 쓰면 그 파일 자체가 유출원이
    됩니다.

    실명은 전부 플레이스홀더로 바꿨고, 이 검사가 재발을 막습니다.

한계
    "이름처럼 생긴 한글 3자" 를 전부 잡을 수는 없습니다. 그래서 **실제 학생
    DB 에 있는 이름**과 대조합니다. DB 가 없으면(CI 등) 조용히 건너뜁니다.
"""
#: 예제·테스트에 써도 되는 이름. 실존 학생이 아닙니다.
SAFE_NAMES = frozenset({
    "홍길동", "김철수", "이영희", "김민준", "이서준", "박지호", "무관찰",
    "교재없음", "키없음", "관찰없음", "테스트", "test",
})


def _student_names_from_db() -> set[str]:
    """실제 학생 DB 의 이름 집합. DB 가 없으면 빈 집합."""
    import sqlite3

    db = ROOT / "data" / "students" / "students.db"
    if not db.exists():
        return set()
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = conn.execute("SELECT name, login_id FROM students").fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return set()
    out: set[str] = set()
    for name, login in rows:
        for v in (name, login):
            if v and str(v).strip() and str(v).strip() not in SAFE_NAMES:
                out.add(str(v).strip())
    return out


def test_C3_실제_학생이름이_소스에_없다():
    """실명은 `data/students/` 안에만 있어야 합니다. 소스는 gitignore 밖입니다."""
    real = _student_names_from_db()
    if not real:
        pytest.skip("학생 DB 가 없어 대조할 수 없습니다 (CI 환경)")

    hits: list[str] = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in _SCAN_EXT:
            continue
        if any(part in _SKIP_DIRS for part in p.parts):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for name in real:
            if name in text:
                # 이름 자체를 실패 메시지에 넣지 않습니다 — 로그도 유출입니다.
                hits.append(f"{p.relative_to(ROOT)} (학생 식별자 {len(name)}자)")
                break

    assert not hits, (
        "실제 학생 이름/아이디가 소스에 있습니다. 플레이스홀더로 바꾸세요 "
        f"(예: {sorted(SAFE_NAMES)[:3]}):\n  " + "\n  ".join(sorted(set(hits)))
    )


def test_C3_안전한_예제이름은_허용된다():
    """검사가 너무 빡빡해서 아무 이름도 못 쓰게 되면 안 됩니다."""
    assert "홍길동" in SAFE_NAMES
    assert not (_student_names_from_db() & SAFE_NAMES), (
        "실제 학생 이름이 '안전한 예제 이름' 목록에 있습니다"
    )


# ─────────────────────────────────────────────────────────────
# C-4: 학생 데이터를 올린다면 private 이어야 한다
# ─────────────────────────────────────────────────────────────
"""
사용자 결정 (2026-08-20)

    "PDF만 제외" — 학생 DB·대기열·감사저널을 저장소에 올립니다.
    Linux 에서 작업 상태를 **그대로** 이어받으려면 그게 필요하기 때문입니다.

그러면 `test_C2` 가 지키던 방어선 하나가 사라집니다. 대신 이것을 지킵니다:

    **학생 실명이 추적되고 있다면, "private 전용" 경고가 문서에 있어야 한다.**

경고 문구가 지워지면 이 테스트가 깨집니다. 다음 사람이 아무 생각 없이
public 으로 바꾸는 것을 막는, 지금 우리가 걸 수 있는 유일한 장치입니다.
(저장소가 실제로 private 인지는 코드가 알 수 없습니다 — 규칙 1-6)
"""


def _student_data_tracked() -> bool:
    """학생 DB 가 git 추적 대상인가."""
    r = subprocess.run(["git", "ls-files", "-z", "data/students/"],
                       cwd=ROOT, capture_output=True, text=True)
    return r.returncode == 0 and bool(r.stdout.strip("\x00").strip())


@needs_git
def test_C4_학생데이터를_올린다면_private_경고가_있어야_한다():
    if not _student_data_tracked():
        pytest.skip("학생 DB 가 추적되지 않습니다 — 이 검사가 필요 없습니다")

    found = []
    for name in ("AGENTS.md", ".gitignore", "README.md"):
        p = ROOT / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if "private" in text.lower() and ("실명" in text or "개인정보" in text):
            found.append(name)

    assert found, (
        "학생 실명이 저장소에 올라가는데 'private 전용' 경고가 어디에도 "
        "없습니다. AGENTS.md 나 .gitignore 에 명시하세요 — 이 경고가 "
        "다음 사람이 public 으로 바꾸는 것을 막는 유일한 장치입니다."
    )


@needs_git
def test_C4_파일명에_실명이_들어간_DB는_막는다():
    """DB 안의 이름은 열어야 보이지만 **파일명은 트리에 그냥 보입니다.**

    알림 메일·PR 화면·검색 결과에도 그대로 뜹니다.
    """
    r = subprocess.run(["git", "ls-files", "-z", "data/students/"],
                       cwd=ROOT, capture_output=True, text=True)
    tracked = [f for f in r.stdout.split("\x00") if f.strip()]
    named = [f for f in tracked
             if Path(f).stem not in ("students", ".gitkeep") and "_" in Path(f).stem]
    assert not named, (
        f"파일명에 학생 이름이 들어갔을 수 있는 추적 파일: {named}\n"
        f"  .gitignore 에 패턴을 추가하고 `git rm --cached` 하세요."
    )
