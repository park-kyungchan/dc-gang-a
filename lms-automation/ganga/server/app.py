# -*- coding: utf-8 -*-
"""
로컬 자동화 서버.

왜 로컬인가
    dc.gang-a.kr 은 CORS 헤더를 주지 않으므로 어떤 정적 호스팅에서도
    브라우저가 직접 호출할 수 없습니다(실측 확인). 반면 서버→서버 요청에는
    CORS 가 적용되지 않습니다. 그래서 이 서버가 LMS 를 대신 호출하고,
    UI 까지 **같은 출처로** 서빙합니다. CORS 라는 개념 자체가 사라집니다.

Tailscale 로 폰에서 쓰기
    · host 는 반드시 `0.0.0.0` — `127.0.0.1` 로 묶으면 폰에서 안 보입니다.
    · PC 가 깨어 있어야 합니다. 절전으로 들어가면 연결이 끊깁니다.
    · 폰에서 `http://<PC의 100.x.y.z>:8765/?t=<토큰>` 으로 접속합니다.

보안
    이 서버는 학생 실명 151명과 강사 세션을 다룹니다. Tailscale 이 이미
    암호화·기기인증을 하지만, 기기 하나가 털리거나 tailnet 을 공유하는
    경우를 대비해 **토큰을 한 겹 더** 요구합니다.
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import assets, cache
from ..config import ASSET_DIR, settings
from ..curriculum import MY_BOOKS
from ..lms.catalog import fetch_answer_catalog, fetch_exam_papers
from ..lms.endpoints import ATTENDANCE_VALUES
from ..lms.reader import read_day_record, read_roster, read_test_papers
from ..lms.session import LmsSession, SessionExpired

STATIC = Path(__file__).parent / "static"

#: LMS 세션은 프로세스 하나에서 재사용합니다. 매 요청마다 새로 열면 느립니다.
_session: LmsSession | None = None
_session_error: str = ""


def get_lms() -> LmsSession:
    if _session is None:
        raise HTTPException(503, _session_error or "LMS 세션이 없습니다")
    return _session


def _open_session() -> None:
    global _session, _session_error
    try:
        s = LmsSession()
        s.__enter__()
        _session, _session_error = s, ""
    except Exception as exc:  # noqa: BLE001
        _session, _session_error = None, str(exc)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    settings.ensure_dirs()
    settings.server.ensure_token()
    _open_session()
    yield
    if _session is not None:
        _session.__exit__(None, None, None)


app = FastAPI(title="강아 대치본원 강사 워크벤치", lifespan=lifespan)


# ─────────────────────────────────────────────────────────────
# 인증
# ─────────────────────────────────────────────────────────────
_PUBLIC = {"/healthz", "/login"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path in _PUBLIC or request.url.path.startswith("/static/"):
        return await call_next(request)

    token = settings.server.token
    given = (
        request.query_params.get("t")
        or request.headers.get("x-ganga-token")
        or request.cookies.get("ganga_token")
        or ""
    )
    if not token or given != token:
        return JSONResponse({"error": "토큰이 필요합니다. /?t=<토큰> 으로 접속하세요."}, 401)

    response = await call_next(request)
    # 첫 접속 이후에는 쿠키로 유지 — 폰에서 매번 URL 에 토큰을 붙이지 않도록
    if request.query_params.get("t") == token:
        response.set_cookie("ganga_token", token, max_age=86400 * 30,
                            httponly=True, samesite="lax")
    return response


# ─────────────────────────────────────────────────────────────
# 기본
# ─────────────────────────────────────────────────────────────
@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "lms": _session is not None, "error": _session_error}


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    f = STATIC / "index.html"
    if not f.exists():
        return HTMLResponse("<h1>UI 파일이 없습니다</h1>", 500)
    return HTMLResponse(f.read_text(encoding="utf-8"))


@app.get("/api/status")
def api_status(lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    return {
        "teacher": {"name": lms.teacher.name, "pri_no": lms.teacher.pri_no,
                    "fran_no": lms.teacher.fran_no},
        "dry_run": settings.safety.dry_run,
        "llm_available": settings.llm.available,
        "cache": cache.status(),
        "assets": assets.summary(),
        "books": [b.label() for b in MY_BOOKS],
    }


@app.post("/api/cache/clear")
def api_cache_clear(key: str | None = None) -> dict[str, Any]:
    return {"cleared": cache.invalidate(key)}


# ─────────────────────────────────────────────────────────────
# 조회 — TTL 캐시 적용
# ─────────────────────────────────────────────────────────────
def _wrap(cv: cache.CachedValue) -> dict[str, Any]:
    return {"data": cv.value, "meta": cv.meta()}


@app.get("/api/roster")
def api_roster(force: bool = False, mine: bool = False,
               lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    def produce():
        r = read_roster(lms)
        return {
            "students": [vars(s) for s in r.students],
            "pages_read": r.pages_read,
            "warnings": r.warnings,
        }

    cv = cache.cached("roster", produce, ttl_key="roster", force=force)
    data = dict(cv.value)
    if mine and lms.teacher.name:
        data["students"] = [s for s in data["students"]
                            if s.get("homeroom") == lms.teacher.name]
    return {"data": data, "meta": cv.meta()}


@app.get("/api/exam-papers")
def api_exam_papers(force: bool = False,
                    lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    cv = cache.cached("exam_papers",
                      lambda: [vars(p) for p in fetch_exam_papers(lms)],
                      ttl_key="exam_papers", force=force)
    return _wrap(cv)


@app.get("/api/test-papers")
def api_test_papers(force: bool = False,
                    lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    cv = cache.cached("test_papers",
                      lambda: [vars(p) for p in read_test_papers(lms)],
                      ttl_key="test_papers", force=force)
    return _wrap(cv)


@app.get("/api/answer-catalog")
def api_answer_catalog(q: str = "", force: bool = False,
                       lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    def produce():
        c = fetch_answer_catalog(lms)
        return {"sheets": [vars(s) for s in c.sheets], "warnings": c.warnings}

    cv = cache.cached("answer_catalog", produce, ttl_key="answer_catalog", force=force)
    data = dict(cv.value)
    if q:
        ql = q.lower()
        data["sheets"] = [
            s for s in data["sheets"]
            if ql in " ".join(str(v) for v in s.values()).lower()
        ]
    data["cached_files"] = sorted(assets.load_manifest())
    return {"data": data, "meta": cv.meta()}


@app.get("/api/day-record")
def api_day_record(date: str, grp_seq: str = "0",
                   lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    """수업일지는 **절대 캐시하지 않습니다.** 쓰기 대상이라 항상 실시간."""
    p = read_day_record(lms, date=date, grp_seq=grp_seq)
    return {
        "data": {
            "date": p.date,
            "groups": [vars(g) for g in p.groups],
            "rows": p.rows,
            "has_groups": p.has_groups,
        },
        "meta": {"from_cache": False, "age_label": "실시간", "is_stale": False},
    }


# ─────────────────────────────────────────────────────────────
# 거버넌스 — 게이트·저널·승인
# ─────────────────────────────────────────────────────────────
@app.get("/api/gates")
def api_gates() -> dict[str, Any]:
    from ..governance import gate_catalog

    return {"gates": gate_catalog()}


@app.get("/api/journal")
def api_journal(limit: int = Query(30, le=500)) -> dict[str, Any]:
    from ..governance import journal_summary, read_journal

    return {"summary": journal_summary(), "entries": read_journal(limit=limit)}


@app.get("/api/policy")
def api_policy() -> dict[str, Any]:
    from ..policy import Ledger

    led = Ledger()
    return {"summary": led.summary(), "entries": led.table()}


@app.post("/api/policy/{routine}/{field_name}")
def api_policy_change(routine: str, field_name: str,
                      action: str = Query(..., pattern="^(promote|demote)$"),
                      reason: str = "") -> dict[str, Any]:
    """승격/강등. **로컬 원장만 바꿉니다. 서버로 나가지 않습니다.**"""
    from ..policy import Ledger, Mode

    led = Ledger()
    try:
        e = (led.promote(routine, field_name, reason=reason or "워크벤치")
             if action == "promote"
             else led.demote(routine, field_name, to=Mode.MANUAL,
                             reason=reason or "워크벤치"))
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    return {"key": e.key, "mode": e.mode, "label": e.mode_enum.label}


# ─────────────────────────────────────────────────────────────
# 대기열 — 낮에 폰으로 넣고, 밤에 PC 로 승인
# ─────────────────────────────────────────────────────────────
#: 폰에서 넣을 수 있는 항목. 여기 없는 것은 받지 않습니다.
QUEUEABLE: dict[str, dict[str, Any]] = {
    # 선택지를 손으로 적으면 서버 드롭다운과 갈라집니다. 실제로 갈라져서
    # **지각(L)을 폰에서 입력할 방법이 아예 없었습니다.** 실측값을 정본으로 씁니다.
    "attendance": {"label": "출결", "kind": "choice",
                   "choices": [k for k in ATTENDANCE_VALUES if k.strip()],
                   "labels": {k: v for k, v in ATTENDANCE_VALUES.items() if k.strip()}},
    "daily_test": {"label": "일일테스트", "kind": "int", "min": 0, "max": 10},
    "hw_rate": {"label": "숙제완성도", "kind": "int", "min": 0, "max": 5},
    # 길이 제한 없음 (사용자 결정 2026-08-20). `soft_len` 은 화면 안내용일 뿐,
    # 막지 않습니다. 서버가 자르지 않는 것을 실측했습니다(250자 그대로 저장).
    "progress": {"label": "진도", "kind": "text", "soft_len": 400},
    "homework": {"label": "숙제", "kind": "text", "soft_len": 400},
    "memo": {"label": "메모", "kind": "text", "soft_len": 400},
}


@app.get("/api/queue/fields")
def api_queue_fields() -> dict[str, Any]:
    return {"fields": QUEUEABLE}


@app.get("/api/queue")
def api_queue_list(date: str, include_done: bool = False) -> dict[str, Any]:
    from .. import queue as Q

    conn = Q.connect()
    items = Q.list_items(conn, the_date=date, include_terminal=include_done)
    s = Q.summary(conn, the_date=date)
    out = [{**vars(it), "state_label": it.state.label,
            "approval_valid": it.approval_valid,
            "field_label": QUEUEABLE.get(it.field, {}).get("label", it.field)}
           for it in items]
    conn.close()
    return {"summary": s, "items": out}


@app.post("/api/queue")
def api_queue_add(date: str, field_name: str, subject_key: str,
                  value: str, note: str = "") -> dict[str, Any]:
    """폰에서 값을 넣습니다. **서버로 나가지 않습니다.** 대기열에만 쌓입니다."""
    from .. import queue as Q
    from .. import students as S

    spec = QUEUEABLE.get(field_name)
    if spec is None:
        raise HTTPException(400, f"큐에 넣을 수 없는 항목입니다: {field_name}")

    # 값 검증 — 큐에 들어가기 전에 막습니다. 나중에 게이트가 또 봅니다.
    if spec["kind"] == "choice" and value not in spec["choices"]:
        raise HTTPException(400, f"{spec['label']} 은 {spec['choices']} 중 하나여야 합니다")
    if spec["kind"] == "int":
        try:
            iv = int(value)
        except ValueError:
            raise HTTPException(400, f"{spec['label']} 은 숫자여야 합니다") from None
        if not (spec["min"] <= iv <= spec["max"]):
            raise HTTPException(
                400, f"{spec['label']} 은 {spec['min']}~{spec['max']} 범위여야 합니다")
    # 길이로 막지 않습니다. 선생님이 쓴 문장을 말없이 자르거나 거부하는 것보다,
    # 화면에 현재 길이를 보여주고 판단을 맡기는 편이 낫습니다.

    sconn = S.connect()
    st = S.get(sconn, subject_key)
    sconn.close()
    if st is None:
        raise HTTPException(404, f"학생을 찾을 수 없습니다: {subject_key}")

    conn = Q.connect()
    try:
        it = Q.enqueue(conn, the_date=date, routine="day_record",
                       field_name=field_name, subject_key=subject_key,
                       subject_name=st.name, value=value, note=note or "폰 입력")
    except Q.TransitionError as exc:
        raise HTTPException(409, str(exc)) from None
    finally:
        conn.close()
    return {"id": it.id, "state": it.state.label,
            "note": "대기열에 저장됨 — 서버로 나가지 않았습니다"}


@app.post("/api/queue/{item_id}/{action}")
def api_queue_action(item_id: int, action: str, by: str = "",
                     reason: str = "") -> dict[str, Any]:
    """review / approve / revoke / discard. **전송은 여기 없습니다.**"""
    from .. import queue as Q

    conn = Q.connect()
    try:
        if action == "review":
            it = Q.review(conn, item_id, actor=by or "워크벤치")
        elif action == "approve":
            if not by.strip():
                raise HTTPException(400, "승인자 이름이 필요합니다")
            it = Q.approve(conn, item_id, by=by)
        elif action == "revoke":
            it = Q.revoke(conn, item_id, actor=by or "워크벤치")
        elif action == "discard":
            it = Q.discard(conn, item_id, actor=by or "워크벤치", reason=reason)
        else:
            raise HTTPException(400, f"알 수 없는 동작: {action}")
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except (Q.TransitionError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from None
    finally:
        conn.close()
    return {"id": it.id, "state": it.state.label,
            "approval_valid": it.approval_valid}


@app.get("/api/queue/{item_id}/history")
def api_queue_history(item_id: int) -> dict[str, Any]:
    from .. import queue as Q

    conn = Q.connect()
    h = Q.history(conn, item_id)
    conn.close()
    return {"history": h}


@app.get("/api/completeness")
def api_completeness(date: str) -> dict[str, Any]:
    """오늘 누가 무엇을 안 썼는지. **작성 중에** 보여주기 위한 것입니다."""
    from .. import queue as Q
    from .. import students as S
    from ..pipeline.completeness import REQUIRED_WHEN_PRESENT, check_class

    sconn = S.connect()
    students = S.list_students(sconn, registered_only=True)
    sconn.close()

    qconn = Q.connect()
    items = Q.list_items(qconn, the_date=date, include_terminal=True)
    qconn.close()

    by_student: dict[str, dict[str, Any]] = {}
    for it in items:
        if it.state is Q.Status.DISCARDED:
            continue
        by_student.setdefault(it.subject_key, {})[it.field] = it.value

    payloads = []
    for st in students:
        vals = by_student.get(st.student_key, {})
        p: dict[str, Any] = {"student_name": st.name}
        for f, v in vals.items():
            p[{"attendance": "attendance", "daily_test": "dt_score",
               "hw_rate": "hw_rate", "progress": "progress_text",
               "homework": "homework_text", "memo": "daily_memo"}.get(f, f)] = v
        payloads.append(p)

    cs = check_class(payloads, date=date)
    return {
        "summary": cs.summary(),
        "all_done": cs.all_done,
        "total": cs.total, "complete": cs.complete,
        "required_when_present": list(REQUIRED_WHEN_PRESENT),
        "rows": [{"student": r.student, "mark": r.progress_mark,
                  "missing": r.missing, "conflicts": r.conflicts,
                  "complete": r.is_complete, "summary": r.summary()}
                 for r in cs.rows],
    }


# ─────────────────────────────────────────────────────────────
# 학생 / 초안
# ─────────────────────────────────────────────────────────────
@app.get("/api/students")
def api_students(registered: bool = False) -> dict[str, Any]:
    from .. import students as S

    conn = S.connect()
    rows = S.list_students(conn, registered_only=registered)
    out = []
    for st in rows:
        out.append({**vars(st), "book_label": st.book_label,
                    "can_write": st.can_write_to_lms,
                    "missing_keys": st.missing_keys()})
    conn.close()
    return {"count": len(out), "students": out}


@app.get("/api/students/{key}")
def api_student_detail(key: str) -> dict[str, Any]:
    from .. import students as S

    conn = S.connect()
    st = S.get(conn, key)
    if st is None:
        conn.close()
        raise HTTPException(404, f"학생을 찾을 수 없습니다: {key}")
    prog = S.progress_status(conn, key)
    data = {
        "student": {**vars(st), "book_label": st.book_label,
                    "can_write": st.can_write_to_lms,
                    "missing_keys": st.missing_keys()},
        "errors": S.error_profile(conn, key),
        "observations": S.observations(conn, key, limit=10),
        "progress": {"summary": prog.summary(), "label": prog.label,
                     "done": prog.done_sessions, "total": prog.planned_total,
                     "warnings": prog.warnings},
    }
    conn.close()
    return data


@app.post("/api/students/{key}/observation")
def api_add_observation(key: str, text: str = Query(..., min_length=1),
                        date: str | None = None) -> dict[str, Any]:
    """수업 중 폰으로 관찰 메모를 남깁니다. **로컬 DB 에만 저장됩니다.**"""
    from .. import students as S

    conn = S.connect()
    try:
        oid = S.add_observation(conn, key, text, date=date)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    finally:
        conn.close()
    return {"id": oid, "saved": True, "note": "로컬 DB 저장 — 서버로 나가지 않음"}


@app.get("/api/lectures")
def api_lectures(q: str = "", playable: bool = False,
                 limit: int = Query(50, le=300)) -> dict[str, Any]:
    from .. import lectures as L

    conn = L.connect()
    rows = L.search(q, playable_only=playable, limit=limit, conn=conn)
    st = L.stats(conn)
    conn.close()
    return {"stats": st, "lectures": rows}


# ─────────────────────────────────────────────────────────────
# 에셋 (PDF)
# ─────────────────────────────────────────────────────────────
@app.get("/api/assets")
def api_assets() -> dict[str, Any]:
    return assets.summary()


@app.post("/api/assets/fetch")
def api_assets_fetch(filenames: list[str]) -> dict[str, str]:
    return assets.ensure(filenames)


# ─────────────────────────────────────────────────────────────
# 문항 검색 (오프라인 — LMS 없이 로컬 인덱스만으로 동작)
# ─────────────────────────────────────────────────────────────
@app.get("/api/problems")
def api_problems(q: str = "", book: str | None = None,
                 limit: int = Query(40, le=200)) -> dict[str, Any]:
    from .. import indexer

    return {"data": indexer.search(q, book=book, limit=limit)}


@app.get("/api/problems/stats")
def api_problem_stats() -> dict[str, Any]:
    from .. import indexer

    return indexer.stats()


@app.get("/api/lecture/{key}")
def api_lecture(key: str, lms: LmsSession = Depends(get_lms)) -> dict[str, Any]:
    """강의코드로 재생 정보를 조회합니다.

    영상 URL 에는 만료되는 토큰이 박혀 있으므로 **저장하지 않고 매번 새로**
    받습니다. 재발급 자체는 무료입니다.

    ⚠️ 문항별 해설강의는 `lecture_type=2` 이고 URL 이 비어 있습니다.
    `direct_exam_play1()` 이 websocket 으로 네이티브 강아 앱을 부르는 구조라
    브라우저·휴대폰에서 열 수 없습니다. 이 경우 강의번호만 돌려줍니다.
    """
    import json as _json
    import re as _re

    from ..lms.endpoints import BASE_URL

    if not _re.fullmatch(r"\d{1,8}", key):
        raise HTTPException(400, "강의번호는 숫자여야 합니다")

    r = lms.post(f"{BASE_URL}/servlet/controller.first.RegAppCommandServlet",
                 data={"reqCmd": "getVideoLecture", "lecture_key": key}, check=False)
    m = _re.search(r"\{.*\}", r.html_content, _re.S)
    if not m:
        raise HTTPException(502, "응답을 해석할 수 없습니다")
    d = _json.loads(m.group(0))

    ltype = int(d.get("lecture_type") or 0)
    url = d.get("lecture_url") or ""
    return {
        "key": key,
        "ok": d.get("result") == "OK",
        "type": ltype,
        "playable": bool(url),
        "url": url,
        "message": d.get("fail_message")
        or ("웹 재생 가능" if url else
            "이 강의는 강아 전용 앱에서만 재생됩니다. 앱의 강의번호 입력란에 "
            f"{key} 를 넣으세요."),
    }


@app.get("/api/page-image")
def api_page_image(pdf: str, page: int, dpi: int = Query(150, ge=72, le=300)):
    """정답지/본문 PDF 의 한 쪽을 PNG 로. 수식이 PUA 폰트라 이미지가 정본입니다."""
    from fastapi.responses import Response

    from .. import indexer

    if "/" in pdf or "\\" in pdf or ".." in pdf:
        raise HTTPException(400, "잘못된 파일명")
    try:
        png = indexer.page_image(pdf, page, dpi=dpi)
    except FileNotFoundError:
        raise HTTPException(404, f"{pdf} 이 로컬에 없습니다") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return Response(png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/pdf/{filename}")
def serve_pdf(filename: str):
    """로컬에 보관한 PDF 를 그대로 내려줍니다. 폰에서 바로 열립니다."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "잘못된 파일명")
    p = ASSET_DIR / filename
    if not p.exists():
        raise HTTPException(404, f"{filename} 은 로컬에 없습니다")
    return FileResponse(p, media_type="application/pdf", filename=filename)


if STATIC.exists():
    app.mount("/static", StaticFiles(directory=STATIC), name="static")


# ─────────────────────────────────────────────────────────────
# 실행 도우미
# ─────────────────────────────────────────────────────────────
def tailscale_ip() -> str | None:
    """이 PC 의 Tailscale 주소(100.x.y.z)를 찾아봅니다."""
    import socket

    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("100."):
                return ip
    except OSError:
        pass
    try:
        import subprocess

        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True,
                             text=True, timeout=5).stdout.strip()
        return out.splitlines()[0] if out else None
    except Exception:  # noqa: BLE001
        return None


def run() -> None:
    import uvicorn

    settings.ensure_dirs()
    token = settings.server.ensure_token()
    cfg = settings.server

    ts = tailscale_ip()
    print("=" * 62)
    print("  강아 대치본원 강사 워크벤치")
    print("=" * 62)
    print(f"  PC 에서       http://127.0.0.1:{cfg.port}/?t={token}")
    if ts:
        print(f"  휴대폰에서    http://{ts}:{cfg.port}/?t={token}")
    else:
        print("  휴대폰에서    Tailscale 주소를 찾지 못했습니다.")
        print("                `tailscale ip -4` 결과의 100.x 주소를 쓰세요.")
    print()
    print(f"  쓰기 모드     {'DRY-RUN (전송 안 함)' if settings.safety.dry_run else '⚠ 실제 전송'}")
    print(f"  LLM           {'사용 가능' if settings.llm.available else '미설정 (템플릿 사용)'}")
    if cfg.is_loopback:
        print("\n  ⚠ host 가 루프백이라 휴대폰에서 접속되지 않습니다.")
        print("    GANGA_HOST=0.0.0.0 으로 실행하세요.")
    print("=" * 62)

    # 공개 노출 점검 — **띄우기 전에** 막습니다.
    #
    # 이 화면에는 학생 실명과 강사 LMS 세션이 걸려 있습니다. 뚫리면 학원
    # 서버에 선생님 권한으로 쓰기가 됩니다. 집 PC + Tailscale 에서는
    # `0.0.0.0` 이 안전하지만 공인 IP 서버에서는 전 인터넷입니다.
    # 코드가 둘을 구분할 방법이 없으므로(규칙 1-6) **사람이 말하게** 합니다.
    if problems := cfg.exposure_check():
        print("\n  ⛔ 이대로 열지 않습니다:")
        for p in problems:
            print(f"     · {p}")
        print("\n     이 기계에서만 쓰려면  GANGA_HOST=127.0.0.1")
        raise SystemExit(2)

    uvicorn.run(app, host=cfg.host, port=cfg.port, log_level="warning")


if __name__ == "__main__":
    run()
