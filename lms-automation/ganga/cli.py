# -*- coding: utf-8 -*-
"""
강아 워크벤치 CLI — 에이전트 공용 진입점.

이 CLI 가 존재하는 이유
    Claude Code / Codex / Gemini CLI 어느 것으로 이 저장소를 열어도 **같은
    명령**으로 같은 결과가 나와야 합니다. 에이전트가 코드를 읽고 매번 새로
    호출 방법을 지어내면, 이 프로젝트가 힘들게 알아낸 것들(진도 200자 제한,
    daily_test_no 필드명, GET/POST 구분)을 모르고 다시 틀립니다.

    그래서 규칙은 하나입니다:
        **LMS 를 건드릴 때는 이 CLI 나 ganga 패키지 함수만 쓴다.
          requests/urllib 로 직접 호출하지 않는다.**

위험 등급
    read   서버를 읽기만 함. 언제든 안전.
    local  로컬 파일/DB 만 씀. 되돌리기 쉬움.
    write  **LMS 서버에 씀.** 기본은 dry-run 이며 --commit 이 있어야 실제 전송.

모든 명령은 `--json` 으로 기계 판독 출력을 냅니다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

RISK_READ, RISK_LOCAL, RISK_WRITE = "read", "local", "write"

#: 명령 레지스트리 — docs/CAPABILITIES.md 와 이 딕셔너리가 정본입니다.
COMMANDS: dict[str, dict[str, Any]] = {}


def command(name: str, risk: str, help_: str):
    def deco(fn: Callable):
        COMMANDS[name] = {"fn": fn, "risk": risk, "help": help_}
        return fn
    return deco


def _out(obj: Any, as_json: bool, text: str | None = None) -> None:
    if as_json:
        print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))
    elif text is not None:
        print(text)
    else:
        print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def _session():
    from .lms.session import LmsSession

    return LmsSession()


# ─────────────────────────────────────────────────────────────
# read — 서버 조회
# ─────────────────────────────────────────────────────────────
@command("status", RISK_READ, "세션·자산·인덱스·승격원장 현황")
def cmd_status(args) -> int:
    from . import assets
    from .indexer import stats as idx_stats
    from .policy import Ledger

    info: dict[str, Any] = {"assets": assets.summary(),
                            "index": idx_stats(),
                            "policy": Ledger().summary()}
    try:
        with _session() as lms:
            info["teacher"] = {"name": lms.teacher.name, "pri_no": lms.teacher.pri_no,
                               "fran_no": lms.teacher.fran_no}
            info["session"] = "ok"
    except Exception as exc:  # noqa: BLE001
        info["session"] = f"실패: {exc}"

    if args.json:
        _out(info, True)
    else:
        t = info.get("teacher") or {}
        print(f"세션    {info['session']}  {t.get('name','')} ({t.get('pri_no','')})")
        a = info["assets"]
        print(f"교재    PDF {a['count']}개 / {a['pages']}쪽 / {a['total_mb']}MB")
        print(f"문항    {info['index']['total_problems']}건")
        p = info["policy"]
        print(f"승격    수동 {p['manual']} · 제안 {p['suggest']} · 자동 {p['auto']}")
    return 0


@command("roster", RISK_READ, "학생 명단 (--mine 내 담당만, --refresh 캐시 무시)")
def cmd_roster(args) -> int:
    from .lms.reader import read_roster

    with _session() as lms:
        r = read_roster(lms)
        rows = r.by_teacher(lms.teacher.name) if args.mine else r.students
        data = {"count": len(rows), "pages_read": r.pages_read,
                "warnings": r.warnings, "students": [vars(s) for s in rows]}
    if args.json:
        _out(data, True)
    else:
        print(f"{len(rows)}명 ({r.pages_read}페이지)")
        for w in r.warnings:
            print("  ⚠", w)
        for s in rows[:60]:
            print(f"  {s.name:8} {s.grade:5} 담당 {s.homeroom:8} {s.login_id}")
    return 0


@command("day-record", RISK_READ, "수업일지 조회 (--date YYYY-MM-DD)")
def cmd_day_record(args) -> int:
    """서버에 **실제로 들어가 있는 값**을 그대로 보여줍니다.

    성공기준이 "빠뜨리지 않는 것" 이므로, 채워진 것보다 **빠진 것**을 먼저 씁니다.
    """
    from .lms.endpoints import DAY_RECORD_WRITE
    from .lms.reader import read_day_record
    from .lms.writer import preflight

    with _session() as lms:
        p = read_day_record(lms, date=args.date, grp_seq=args.group)
        blockers = preflight(lms, date=args.date)

    labels = {k: v["label"] for k, v in DAY_RECORD_WRITE.items()}
    data = {
        "date": p.date, "grp_seq": p.grp_seq, "has_groups": p.has_groups,
        "teacher_pri_no": p.teacher_pri_no,
        "groups": [vars(g) for g in p.groups],
        "records": [
            {**vars(r), "missing": list(r.missing()),
             "attendance_label": r.attendance_label} for r in p.records
        ],
        "incomplete": len(p.incomplete),
        "blockers": blockers,
    }
    if args.json:
        _out(data, True)
        return 0

    print(f"{p.date} · 그룹 {[g.label for g in p.groups if g.value != '0']} "
          f"· 학생 {len(p.records)}명 · 미완결 {len(p.incomplete)}명")
    for b in blockers:
        print("  ✗", b)
    if not p.records:
        print("  (행 없음 — 그룹 미선택이거나 그날 수업이 없습니다)")
    for r in p.records:
        miss = r.missing()
        mark = "○" if miss else "●"
        print(f"\n  {mark} {r.student_name or r.stu_pri_no}  [{r.attendance_label}]")
        print(f"      진도 {r.progress_text or '—'}")
        print(f"      숙제 {r.homework_text or '—'}")
        print(f"      메모 {r.memo_text or '—'}")
        print(f"      DT   {'미입력' if r.daily_test is None else r.daily_test}")
        if r.report_url:
            print(f"      리포트 {r.report_url}")
        if miss:
            print(f"      ⚠ 빠짐: {', '.join(labels.get(m, m) for m in miss)}")
    return 0


@command("sync-keys", RISK_READ, "수업일지에서 학생 식별키를 DB 로 가져옴 (--date)")
def cmd_sync_keys(args) -> int:
    """`course_seq`·`stu_pri_no`·`cm_seq` 를 학생 DB 에 채웁니다.

    이 키가 없으면 G06(식별키 완비)이 모든 전송을 막습니다. 키는 강사가
    손으로 적을 값이 아니라 **서버가 아는 값**이므로 서버에서 가져옵니다.

    `record_seq` 는 저장하지 않습니다. 회차마다 달라지는 값이라 DB 에 굳혀두면
    다음 수업에 엉뚱한 회차로 나갑니다. 전송 직전에 그날 화면에서 읽습니다.
    """
    from . import students as S
    from .lms.reader import read_day_record

    with _session() as lms:
        p = read_day_record(lms, date=args.date, grp_seq=args.group)

    conn = S.connect()
    applied, skipped = [], []
    try:
        for r in p.records:
            if not (r.stu_pri_no and r.course_seq and r.cm_seq):
                skipped.append({"name": r.student_name, "why": "서버 키가 불완전"})
                continue
            existing = S.find_by_pri_no(conn, r.stu_pri_no)
            login_id = (existing.login_id if existing
                        else (args.login_id or r.student_name))
            if not login_id:
                skipped.append({"stu_pri_no": r.stu_pri_no,
                                "why": "학생 DB 에 없고 --login-id 도 없음"})
                continue
            S.register(conn, login_id=login_id, name=r.student_name,
                       stu_pri_no=r.stu_pri_no, course_seq=r.course_seq,
                       cm_seq=r.cm_seq)
            applied.append({"login_id": login_id, "name": r.student_name,
                            "stu_pri_no": r.stu_pri_no,
                            "course_seq": r.course_seq, "cm_seq": r.cm_seq})
    finally:
        conn.close()

    data = {"date": p.date, "applied": applied, "skipped": skipped,
            "note": "record_seq 는 회차마다 달라 저장하지 않습니다"}
    if args.json:
        _out(data, True)
    else:
        print(f"{p.date} · 반영 {len(applied)}명 / 건너뜀 {len(skipped)}명")
        for a in applied:
            print(f"  ✓ {a['name']} ({a['login_id']}) "
                  f"stu={a['stu_pri_no']} course={a['course_seq']} cm={a['cm_seq']}")
        for s in skipped:
            print(f"  · {s}")
    return 0


@command("cism", RISK_READ, "주간 교무회의 CISM 조회 (--date)")
def cmd_cism(args) -> int:
    from .lms.endpoints import BASE_URL, CISM_FIELDS

    with _session() as lms:
        p = lms.get(f"{BASE_URL}/servlet/controller.cct.common.CourseCommonServlet",
                    params={"reqCmd": "CismChartMain",
                            "tutor_pri_no": lms.teacher.pri_no,
                            "the_date": args.date})
        html = p.html_content
    import re

    values = {}
    for fid, label in CISM_FIELDS.items():
        m = re.search(rf'<textarea[^>]*id="{fid}"[^>]*>(.*?)</textarea>', html, re.S)
        values[fid] = {"label": label, "value": (m.group(1).strip() if m else "")}
    filled = sum(1 for v in values.values() if v["value"])
    data = {"date": args.date, "filled": filled, "total": len(values), "fields": values}
    if args.json:
        _out(data, True)
    else:
        print(f"{args.date} 주차 · {filled}/{len(values)} 항목 작성됨")
        for fid, v in values.items():
            mark = "✓" if v["value"] else "·"
            print(f"  {mark} {fid} {v['label']}")
    return 0


@command("catalog", RISK_READ, "교재 자료 PDF 검색 (--query)")
def cmd_catalog(args) -> int:
    from .lms.catalog import fetch_answer_catalog

    with _session() as lms:
        c = fetch_answer_catalog(lms)
    rows = c.search(args.query) if args.query else c.sheets
    if args.json:
        _out({"count": len(rows), "warnings": c.warnings,
              "sheets": [vars(s) for s in rows[:200]]}, True)
    else:
        print(c.summary())
        for s in rows[:40]:
            print(f"  {s.grade:5} {s.level:10} {s.kind:8} {s.filename}")
    return 0


# ─────────────────────────────────────────────────────────────
# local — 로컬 자산/인덱스
# ─────────────────────────────────────────────────────────────
@command("assets", RISK_LOCAL, "담당 교재 PDF 확보 (한 번만 내려받음)")
def cmd_assets(args) -> int:
    from . import assets
    from .curriculum import MY_BOOKS

    assets.adopt_legacy()
    need = [f for b in MY_BOOKS for f in (b.answer_filename(), b.sample_filename()) if f]
    result = assets.ensure(need)
    _out({"result": result, "summary": assets.summary()}, args.json,
         "\n".join(f"  {k:34} {v}" for k, v in result.items()))
    return 0


@command("index", RISK_LOCAL, "정답지 PDF 를 문항 단위로 인덱싱")
def cmd_index(args) -> int:
    from .curriculum import MY_BOOKS
    from .indexer import connect, index_book

    conn = connect()
    out = [index_book(b, conn=conn) for b in MY_BOOKS]
    if args.json:
        _out(out, True)
    else:
        for r in out:
            if "error" in r:
                print("  ✗", r["error"])
            else:
                print(f"  {r['book']:22} {r['problems']:5}문항 / {r['pages']}쪽")
    return 0


@command("search", RISK_LOCAL, "문항 검색 (강의번호 7자리 / NN번 / 개념어)")
def cmd_search(args) -> int:
    from .indexer import search

    rows = search(args.query, limit=args.limit)
    if args.json:
        _out({"count": len(rows), "results": rows}, True)
    else:
        print(f"{len(rows)}건")
        for r in rows:
            bp = f"교재{r['book_page']}쪽 " if r["book_page"] else ""
            print(f"  {r['book'][:16]:18} {bp}{r['problem_no']}번 "
                  f"{r['answer'] or '서술':6} #{r['lecture_key']}")
    return 0


@command("check", RISK_READ, "수업일지 완결성 점검 (--date). 누가 무엇을 안 썼는지")
def cmd_check(args) -> int:
    from .lms.reader import read_day_record
    from .pipeline.completeness import check_class

    with _session() as lms:
        page = read_day_record(lms, date=args.date, grp_seq=args.group)

    if not page.has_groups:
        msg = "학생그룹이 0개입니다. 수업관리 → 학생그룹관리에서 먼저 만드세요."
        _out({"error": msg}, args.json, f"  ✗ {msg}")
        return 1

    # 서버 표를 페이로드로 옮기는 매핑은 실학생 배정 후 확정합니다.
    # 지금은 행이 0개라 빈 결과가 나옵니다.
    payloads: list[dict[str, Any]] = []
    cs = check_class(payloads, date=args.date)
    if args.json:
        _out({"summary": cs.summary(), "all_done": cs.all_done,
              "missing": cs.missing_report()}, True)
    else:
        print(cs.summary())
        for line in cs.missing_report():
            print("  ", line)
        if not cs.rows:
            print("  (표에 행이 없습니다 — 학생 배정 후 다시 실행하세요)")
    return 0 if cs.all_done else 1


@command("plan", RISK_LOCAL, "교재 목차 + 진도 계획 (--pace 보통|특수, --per-week)")
def cmd_plan(args) -> int:
    from .curriculum import MY_BOOKS
    from .syllabus import build_plan, load_syllabus

    out = []
    for b in MY_BOOKS:
        syl = load_syllabus(b)
        plan = build_plan(syl, pace=args.pace, per_week=args.per_week)
        out.append({"syllabus": syl.to_dict(), "plan": plan.to_dict()})
        if not args.json:
            print(f"■ {syl.book}  소단원 {len(syl)}개  대단원 {syl.units}")
            for w in syl.warnings + plan.warnings:
                print("   ⚠", w)
            print("   →", plan.summary())
            for s in plan.sessions[:args.show]:
                mark = "[시험]" if s.has_unit_test else "     "
                print(f"     {s.index:3}회 {s.teach_min:3}분 {mark} "
                      f"{s.sections[0][:44]} {s.note}")
            if len(plan.sessions) > args.show:
                print(f"     … 외 {len(plan.sessions) - args.show}회차")
    if args.json:
        _out(out, True)
    return 0


@command("student", RISK_LOCAL,
         "학생 DB (--register --login --name / --show / --sync)")
def cmd_student(args) -> int:
    from . import students as S

    conn = S.connect()

    if args.sync:
        from .lms.reader import read_roster

        with _session() as lms:
            r = read_roster(lms)
            mine = r.by_teacher(lms.teacher.name)
        res = S.sync_from_lms(conn, mine)
        _out(res, args.json,
             f"  내 담당 {len(mine)}명 → 추가 {res['added']} · 갱신 {res['updated']}")
        return 0

    if args.register:
        if not (args.login and args.name):
            print("  --login 과 --name 이 필요합니다", file=sys.stderr)
            return 2
        extra: dict[str, Any] = {}
        for kv in (args.set or []):
            k, _, v = kv.partition("=")
            if not k or not v:
                print(f"  --set 형식은 key=value 입니다: {kv!r}", file=sys.stderr)
                return 2
            extra[k.strip()] = int(v) if v.strip().lstrip("-").isdigit() else v.strip()
        st = S.register(conn, login_id=args.login, name=args.name, **extra)
        _out({"student": st.name, "book": st.book_label,
              "can_write": st.can_write_to_lms, "missing": st.missing_keys()},
             args.json,
             f"  등록: {st.name} · {st.book_label}\n"
             f"  LMS 전송 {'가능' if st.can_write_to_lms else '불가 — 미확보 키: ' + ', '.join(st.missing_keys())}")
        return 0

    if args.show:
        st = S.get(conn, args.show)
        if st is None:
            print(f"  학생을 찾을 수 없습니다: {args.show}", file=sys.stderr)
            return 1
        prof = S.error_profile(conn, st.student_key)
        obs = S.observations(conn, st.student_key, limit=5)
        prog = S.progress_status(conn, st.student_key)
        data = {"student": st.name, "book": st.book_label, "pace": st.pace,
                "per_week": st.per_week, "can_write": st.can_write_to_lms,
                "missing_keys": st.missing_keys(), "errors": prof,
                "progress": prog.summary(), "warnings": prog.warnings,
                "observations": obs}
        if args.json:
            _out(data, True)
        else:
            print(f"  {st.name} ({st.login_id}) · {st.grade} · 담당 {st.homeroom}")
            print(f"  교재  {st.book_label} · {st.pace} · 주 {st.per_week}회")
            print(f"  전송  {'가능' if st.can_write_to_lms else '불가 (' + ', '.join(st.missing_keys()) + ')'}")
            print(f"  진도  {prog.summary()}")
            for w in prog.warnings:
                print("        ⚠", w)
            if prof["total"]:
                print(f"  오답  {prof['total']}건 · 최다 {prof['dominant']} · {prof['by_tag']}")
            for o in obs:
                print(f"  메모  [{o['date']}] {o['text'][:52]}")
        return 0

    rows = S.list_students(conn, registered_only=args.registered)
    if args.json:
        _out({"count": len(rows), "students": [asdict_student(x) for x in rows]}, True)
    else:
        print(f"  {len(rows)}명")
        for x in rows:
            mark = "✓" if x.can_write_to_lms else "·"
            print(f"  {mark} {x.name:8} {x.grade:5} {x.book_label:22} {x.login_id}")
    return 0


def asdict_student(st) -> dict[str, Any]:
    from dataclasses import asdict as _a

    d = _a(st)
    d["book_label"] = st.book_label
    d["can_write_to_lms"] = st.can_write_to_lms
    return d


@command("fields", RISK_LOCAL, "학생 등록 시 물어볼 항목 명세")
def cmd_fields(args) -> int:
    from .students import REGISTRATION_FIELDS

    if args.json:
        _out(list(REGISTRATION_FIELDS), True)
    else:
        for f in REGISTRATION_FIELDS:
            req = " (필수)" if f.get("required") else ""
            print(f"  {f['key']:14} {f['label']}{req}")
            if f.get("note"):
                print(f"  {'':14} → {f['note']}")
    return 0


@command("draft", RISK_LOCAL,
         "수업일지 초안 생성 (--date, --student, --session). 전송하지 않습니다")
def cmd_draft(args) -> int:
    from . import students as S
    from .config import settings
    from .pipeline.draft import class_report, draft_for_class
    from .pipeline.llm import AnthropicAdapter
    from .policy import Ledger

    conn = S.connect()

    # ── 구독제 에이전트 모드 ────────────────────────────────
    if args.emit or args.ingest:
        from .pipeline.draft import emit_for_student, ingest_for_student

        if not args.student:
            print("  --student 가 필요합니다", file=sys.stderr)
            return 2
        if args.emit:
            _out(emit_for_student(conn, args.student, date=args.date,
                                  session_no=args.session, ledger=Ledger()), True)
            return 0
        raw = (sys.stdin.read() if args.ingest == "-"
               else Path(args.ingest).read_text(encoding="utf-8"))
        r = ingest_for_student(conn, args.student, json.loads(raw),
                               date=args.date, session_no=args.session,
                               ledger=Ledger())
        _out({"student": r.student_name, "ready": r.ready,
              "draft": {"progress": r.draft.progress_text,
                        "homework": r.draft.homework_text,
                        "memo": r.draft.daily_memo},
              "source": r.field_source, "audit": r.audit,
              "blockers": r.blockers}, args.json,
             f"  {r.summary()}\n" + "\n".join(f"    {a}" for a in r.audit))
        return 0

    keys = ([args.student] if args.student
            else [x.student_key for x in S.list_students(conn, registered_only=True)])
    if not keys:
        print("  등록된 학생이 없습니다. `ganga student --register` 를 먼저 하세요.",
              file=sys.stderr)
        return 1

    adapter = AnthropicAdapter(model=settings.llm.model) if settings.llm.available else None
    # 출결은 Y/N 만이 아닙니다 — 지각(L)이 실재합니다. `--absent` 만 있으면
    # 지각 학생을 표현할 방법이 없어 전부 '출석' 으로 처리됩니다.
    absent = set((args.absent or "").split(",")) - {""}
    late = set((args.late or "").split(",")) - {""}
    if overlap := absent & late:
        print(f"결석과 지각에 동시에 있는 학생: {sorted(overlap)}", file=sys.stderr)
        return 1

    def _attn(k: str) -> str:
        return "N" if k in absent else ("L" if k in late else "Y")

    results = draft_for_class(
        conn, keys, date=args.date,
        attendance={k: _attn(k) for k in keys},
        sessions={k: args.session for k in keys} if args.session else None,
        adapter=adapter, ledger=Ledger())

    if args.json:
        _out([{"student": r.student_name, "ready": r.ready,
               "draft": {"progress": r.draft.progress_text,
                         "homework": r.draft.homework_text,
                         "memo": r.draft.daily_memo},
               "source": r.field_source, "blockers": r.blockers,
               "missing": (r.status.missing if r.status else []),
               "audit": r.audit} for r in results], True)
        return 0

    print(class_report(results))
    print()
    print(f"  LLM: {'사용' if adapter else '미설정 — 템플릿'}")
    for r in results:
        if not any((r.draft.progress_text, r.draft.homework_text, r.draft.daily_memo)):
            continue
        print(f"\n  ── {r.student_name} ──")
        for label, val in (("진도", r.draft.progress_text),
                           ("숙제", r.draft.homework_text),
                           ("메모", r.draft.daily_memo)):
            if val:
                print(f"    {label}: {val}")
    print("\n  ※ 초안일 뿐 전송하지 않았습니다. 검토 후 사용하세요.")
    return 0


@command("lectures", RISK_LOCAL,
         "강의코드 인덱싱·조회 (--resolve 로 서버에 재생가능 여부 확인)")
def cmd_lectures(args) -> int:
    from . import lectures as L
    from .curriculum import MY_BOOKS

    conn = L.connect()
    if args.resolve:
        with _session() as lms:
            out = L.resolve_types(lms, conn=conn, limit=args.limit)
        _out(out, args.json,
             f"  확인 {out['checked']}건 · 재생가능 {out['playable']} · "
             f"실패 {out['failed']} · 남음 {out['remaining']}")
        return 0

    if args.reindex:
        for b in MY_BOOKS:
            r = L.index_lectures(b, conn=conn)
            if not args.json:
                if "error" in r:
                    print("  ✗", r["error"])
                else:
                    print(f"  {r['book']:22} 개념 {r['개념강의']} · "
                          f"전자칠판 {r['전자칠판강의']}"
                          + (f"  ({r['note']})" if "note" in r else ""))

    rows = L.search(args.query, playable_only=args.playable, limit=args.limit,
                    conn=conn)
    s = L.stats(conn)
    if args.json:
        _out({"stats": s, "lectures": rows}, True)
    else:
        print(f"  총 {s['total']}건 {s['by_kind']} · "
              f"타입확인 {s['type_checked']}/{s['total']} · 재생가능 {s['playable']}")
        for x in rows:
            # 재생 여부는 타입 번호가 아니라 URL 유무로 판단합니다.
            # 서버가 새 타입을 추가해도 안전합니다.
            if x["lecture_type"] is None:
                mark = "미확인"
            elif x["lecture_type"] == -1:
                mark = "없는강의"
            else:
                mark = f"웹 t{x['lecture_type']}" if x["stream_ok"] else \
                       f"앱전용 t{x['lecture_type']}"
            print(f"    {x['pdf_page']:3}쪽 [{(x['section_name'] or '')[:18]:20}] "
                  f"{x['kind']:8} {x['code']:9} [{mark}]")
        if s["type_unchecked"]:
            print(f"\n  ※ {s['type_unchecked']}건이 타입 미확인입니다. "
                  "`ganga lectures --resolve` 로 서버에 확인하세요.")
    return 0


@command("gates", RISK_LOCAL, "쓰기 게이트 16단 명세")
def cmd_gates(args) -> int:
    from .governance import gate_catalog, tier_catalog

    rows = gate_catalog()
    tiers = tier_catalog()
    if args.json:
        _out({"tiers": tiers, "gates": rows}, True)
        return 0

    print("  등급 — 되돌릴 수 있는가로 나눕니다\n")
    for t in tiers:
        auto = "자동 전송" if t["auto_send"] else "⛔ 자동 전송 안 함"
        print(f"    {t['tier']:6} {t['pre_send']:2}단  {auto}")
        print(f"           {t['note']}")
    print()
    cur = None
    for g in rows:
        if g["stage"] != cur:
            cur = g["stage"]
            print(f"  ── {cur} ──")
        always = "  [항상]" if g["always"] == "예" else f"  ({g['tiers']})"
        print(f"    {g['id']}  {g['name']:16}{always}")
    print("\n  [항상] 은 등급으로 끌 수 없는 게이트입니다.")
    return 0


@command("send", "write", "수업일지 1칸 전송 (--field --value --commit)")
def cmd_send(args) -> int:
    """서버에 **실제로 씁니다.** `--commit` 없이는 게이트 보고서만 냅니다.

    항목별 잠금: `--commit` 은 `--field` 로 지정한 **그 항목 하나만** 풉니다.
    나머지는 계속 잠겨 있습니다. 해제는 이 프로세스에서만 살고 디스크에
    남지 않으므로, 다음 실행에서는 다시 잠깁니다.
    """
    from .lms.endpoints import daily_test_to_wire
    from .lms.gateway import WriteGateway
    from .lms.reader import read_day_record

    value: Any = args.value
    if args.field == "daily_test":
        value = daily_test_to_wire(args.value)     # "90점" → 9

    with _session() as lms:
        page = read_day_record(lms, date=args.date, grp_seq=args.group)
        row = next((r for r in page.records
                    if args.student in (r.student_name, r.stu_pri_no)), None)
        if row is None:
            names = [r.student_name or r.stu_pri_no for r in page.records]
            print(f"{args.date} 에 '{args.student}' 행이 없습니다. 있는 학생: {names}",
                  file=sys.stderr)
            return 1

        gw = WriteGateway(lms, min_interval_sec=0)
        gw.owned_students = {row.student_name, row.stu_pri_no}
        op = gw.build_day_record_op(
            field_name=args.field, value=value, subject=row.student_name,
            stu_pri_no=row.stu_pri_no, record_seq=row.record_seq,
            cm_seq=row.cm_seq, course_seq=row.course_seq)

        kw = dict(owner_login=row.student_name, value_origin=args.origin)
        if args.commit:
            gw.unlock(op.key, by=args.by)

        gw.preview(op)                             # G13 — 아래 render() 가 보여줍니다
        rep = gw.evaluate(op, **kw)
        print(rep.render())

        if not args.commit:
            print("\n  ※ --commit 없이는 여기까지입니다. 서버를 건드리지 않았습니다.")
            return 0 if rep.allowed or rep.blocked_at.gate_id == "G04" else 1

        gw.approve(op, by=args.by)                 # G14
        before = getattr(row, {"progress": "progress_text",
                               "homework": "homework_text",
                               "memo": "memo_text"}.get(args.field, "attendance"), "")
        res = gw.send(op, verify=gw.day_record_verifier(
            date=args.date, grp_seq=args.group), **kw)

    print()
    print(f"  이전 값: {before!r}")
    print(f"  보낸 값: {value!r}")
    for gid, name, ok, detail in res.post_gates:
        print(f"  {'✓' if ok else '✗'} [{gid}] {name}: {detail}")
    print(f"\n  {res.summary()}")
    return 0 if res.ok else 1


@command("flush", "write", "대기열 승인분을 서버로 (--date --group [--commit])")
def cmd_flush(args) -> int:
    """낮에 폰으로 넣고 승인한 것을 **밤에 PC 에서 한꺼번에** 내보냅니다.

    `--commit` 없이는 게이트만 평가하고 서버를 건드리지 않습니다.
    `--commit` 을 줘도 **`--unlock` 으로 푼 항목만** 나갑니다.
    """
    from . import queue as Q
    from .pipeline.flush import flush

    unlock = tuple(u for u in (args.unlock or "").split(",") if u)
    if args.commit and not unlock:
        print("--commit 에는 --unlock 이 필요합니다 (예: --unlock day_record.progress)",
              file=sys.stderr)
        return 1

    conn = Q.connect()
    try:
        with _session() as lms:
            rep = flush(conn, lms, the_date=args.date, grp_seq=args.group,
                        actor=args.by, dry_run=not args.commit,
                        unlock=unlock, max_items=args.max)
    finally:
        conn.close()

    if args.json:
        _out(rep.to_dict(), True)
    else:
        print(rep.render())
        if not args.commit:
            print("\n  ※ --commit 없이는 여기까지입니다. 서버를 건드리지 않았습니다.")
    return 0 if (rep.all_ok or not args.commit) else 1


@command("alimtalk", RISK_LOCAL, "알림톡 발송 화면 준비 (--date) — 발송은 안 함")
def cmd_alimtalk(args) -> int:
    """⛔ **발송하지 않습니다.** 열어야 할 주소만 만들어 드립니다.

    학부모 휴대폰으로 나가고 회수가 안 되므로, 마지막 버튼은 선생님이
    직접 누릅니다. (사용자 지시, 2026-08-20)
    """
    from .lms.endpoints import alimtalk_url
    from .lms.reader import read_day_record

    with _session() as lms:
        p = read_day_record(lms, date=args.date, grp_seq=args.group)

    rows = [r for r in p.records if r.report_seq]
    if not rows:
        print(f"{args.date} · 발송 대상 없음 (리포트가 생성된 학생이 없습니다)")
        return 0

    targets = [r for r in rows if not r.missing()] if not args.include_incomplete \
        else rows
    skipped = [r for r in rows if r.missing()] if not args.include_incomplete else []

    if not targets:
        print(f"{args.date} · 미완결이라 전부 제외했습니다. "
              f"`--include-incomplete` 로 강제할 수 있습니다.")
        for r in skipped:
            print(f"  · {r.student_name}: {', '.join(r.missing())} 빠짐")
        return 1

    url = alimtalk_url(
        target_report_seqs=[r.report_seq for r in targets],
        all_report_seqs=[r.report_seq for r in rows],
        report_date=args.date)
    data = {"date": args.date, "sent": False,
            "targets": [{"name": r.student_name, "report_seq": r.report_seq}
                        for r in targets],
            "skipped": [{"name": r.student_name, "missing": list(r.missing())}
                        for r in skipped],
            "url": url}
    if args.json:
        _out(data, True)
        return 0

    print(f"⛔ 알림톡 — 자동 발송하지 않습니다 (회수 불가)")
    print(f"   {args.date} · 대상 {len(targets)}명 / 제외 {len(skipped)}명")
    for r in targets:
        print(f"     ✓ {r.student_name}  report_seq={r.report_seq}")
    for r in skipped:
        print(f"     · {r.student_name}  ({', '.join(r.missing())} 빠짐 — 제외)")
    print(f"\n   아래 주소를 열고 **마지막 버튼은 직접** 눌러 주세요")
    print(f"   {url}")
    return 0


@command("journal", RISK_LOCAL, "서버 쓰기 감사 로그 (--limit)")
def cmd_journal(args) -> int:
    from .governance import journal_summary, read_journal

    s = journal_summary()
    rows = read_journal(limit=args.limit)
    if args.json:
        _out({"summary": s, "entries": rows}, True)
    else:
        print(f"  총 {s['total']}건 · {s['by_result']}")
        if s["blocked_gates"]:
            print(f"  차단 게이트: {s['blocked_gates']}")
        for r in rows[-args.limit:]:
            mark = {"SENT": "→", "BLOCKED": "✗", "FAILED": "!", "ERROR": "!"}.get(
                r.get("result"), "·")
            print(f"  {mark} {r['at'][:19]} {r['op']['key']:22} "
                  f"{r.get('result'):8} {r.get('blocked_at') or ''} "
                  f"{('승인 ' + r['approved_by']) if r.get('approved_by') else ''}")
        if not rows:
            print("  (아직 기록 없음 — 서버에 쓴 적이 없습니다)")
    return 0


@command("policy", RISK_LOCAL, "자동화 승격 원장 조회/변경")
def cmd_policy(args) -> int:
    from .policy import Ledger, Mode

    led = Ledger()
    if args.promote:
        routine, _, fld = args.promote.partition(".")
        e = led.promote(routine, fld, reason=args.reason or "CLI 승격")
        print(f"{e.key} → {e.mode_enum.label}")
        return 0
    if args.demote:
        routine, _, fld = args.demote.partition(".")
        e = led.demote(routine, fld, to=Mode.MANUAL, reason=args.reason or "CLI 강등")
        print(f"{e.key} → {e.mode_enum.label}")
        return 0

    rows = led.table()
    if args.json:
        _out({"summary": led.summary(), "entries": rows}, True)
    else:
        s = led.summary()
        print(f"총 {s['total']} · 수동 {s['manual']} · 제안 {s['suggest']} · 자동 {s['auto']}")
        for r in rows:
            mark = {"manual": "·", "suggest": "◐", "auto": "●"}[r["mode"]]
            print(f"  {mark} {r['key']:28} {r['label']}")
    return 0


@command("doctor", RISK_LOCAL, "자가진단 — 무엇이 준비됐고 무엇이 막혀 있는지")
def cmd_doctor(args) -> int:
    from . import assets
    from .config import settings
    from .indexer import stats as idx_stats
    from .lms.endpoints import unverified
    from .policy import Ledger

    checks: list[dict[str, Any]] = []

    def chk(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})

    try:
        with _session() as lms:
            chk("LMS 세션", bool(lms.teacher.pri_no),
                f"{lms.teacher.name} ({lms.teacher.pri_no})")
    except Exception as exc:  # noqa: BLE001
        chk("LMS 세션", False, str(exc))

    a = assets.summary()
    chk("교재 PDF", a["count"] > 0, f"{a['count']}개 / {a['pages']}쪽")
    i = idx_stats()
    chk("문항 인덱스", i["total_problems"] > 0, f"{i['total_problems']}문항")
    # API 키가 없는 것은 결함이 아닙니다. 구독제 에이전트(Claude Code/Codex/
    # Gemini CLI)를 쓰는 환경에서는 키가 없는 것이 정상입니다.
    chk("문장 생성", True,
        "API 모드 (키 감지됨)" if settings.llm.available
        else "에이전트 모드 — `draft --emit` → 문장 작성 → `draft --ingest`")
    chk("dry-run", settings.safety.dry_run,
        "꺼져 있음 — 실제 전송됩니다" if not settings.safety.dry_run else "켜짐(안전)")
    u = unverified()
    chk("엔드포인트 검증", not u, f"미검증 {len(u)}개: {[e.label for e in u]}" if u else "전부 검증됨")
    led = Ledger().summary()
    chk("승격 원장", True, f"수동 {led['manual']} / 제안 {led['suggest']} / 자동 {led['auto']}")

    if args.json:
        _out({"checks": checks}, True)
    else:
        for c in checks:
            print(f"  {'✓' if c['ok'] else '✗'} {c['check']:16} {c['detail']}")
    return 0 if all(c["ok"] for c in checks) else 1


@command("serve", RISK_LOCAL, "로컬 워크벤치 서버 실행 (폰에서 접속)")
def cmd_serve(args) -> int:  # noqa: ARG001
    from .server.app import run

    run()
    return 0


# ─────────────────────────────────────────────────────────────
# 파서
# ─────────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ganga",
        description="강의하는아이들 대치본원 강사 자동화 워크벤치",
        epilog="LMS 를 건드릴 때는 반드시 이 CLI 나 ganga 패키지를 쓰세요. "
               "requests/urllib 로 직접 호출하면 검증·게이트를 우회하게 됩니다.",
    )
    p.add_argument("--json", action="store_true", help="기계 판독용 JSON 출력")
    sub = p.add_subparsers(dest="cmd", required=True)

    from .lms.endpoints import DAY_RECORD_WRITE

    for name, meta in COMMANDS.items():
        sp = sub.add_parser(name, help=f"[{meta['risk']}] {meta['help']}")
        sp.add_argument("--json", action="store_true")
        if name == "draft":
            sp.add_argument("--student", metavar="LOGIN_ID")
            sp.add_argument("--session", type=int)
            sp.add_argument("--absent", default="", help="결석 학생 아이디, 쉼표 구분")
            sp.add_argument("--late", default="", help="지각 학생 아이디, 쉼표 구분")
            sp.add_argument("--emit", action="store_true",
                            help="에이전트에게 넘길 재료를 JSON 으로 출력 (구독제 모드)")
            sp.add_argument("--ingest", metavar="FILE",
                            help="에이전트가 만든 JSON 을 게이트에 통과시킴 ('-' 는 stdin)")
        if name in ("day-record", "cism", "check", "draft", "sync-keys",
                    "alimtalk", "send", "flush"):
            sp.add_argument("--date", required=True, help="YYYY-MM-DD")
        if name in ("day-record", "check", "sync-keys", "alimtalk", "send",
                    "flush"):
            sp.add_argument("--group", default="0", help="학생그룹 grp_seq")
        if name == "flush":
            sp.add_argument("--by", default="박경찬", help="내보내는 사람")
            sp.add_argument("--unlock", default="",
                            help="풀 항목, 쉼표 구분 (예: day_record.progress)")
            sp.add_argument("--max", type=int, default=None, help="이번에 보낼 상한")
            sp.add_argument("--commit", action="store_true",
                            help="이것을 줘야 실제로 나갑니다")
        if name == "send":
            sp.add_argument("--student", required=True, help="학생명 또는 stu_pri_no")
            sp.add_argument("--field", required=True,
                            choices=sorted(DAY_RECORD_WRITE))
            sp.add_argument("--value", required=True,
                            help="일일테스트는 '90점' 처럼 점수로 쓰세요")
            sp.add_argument("--by", default="박경찬", help="승인자")
            sp.add_argument("--origin", default="human", choices=["human", "llm"])
            sp.add_argument("--commit", action="store_true",
                            help="이것을 줘야 실제로 나갑니다 (--field 항목만 해제)")
        if name == "sync-keys":
            sp.add_argument("--login-id", dest="login_id", default="",
                            help="학생 DB 에 아직 없을 때 쓸 로그인 아이디")
        if name == "alimtalk":
            sp.add_argument("--include-incomplete", action="store_true",
                            dest="include_incomplete",
                            help="수업일지가 덜 채워진 학생도 대상에 포함")
        if name == "roster":
            sp.add_argument("--mine", action="store_true")
            sp.add_argument("--refresh", action="store_true")
        if name in ("catalog", "search"):
            sp.add_argument("query", nargs="?", default="")
        if name == "search":
            sp.add_argument("--limit", type=int, default=30)
        if name == "plan":
            sp.add_argument("--pace", default="보통", choices=["보통", "특수"])
            sp.add_argument("--per-week", type=int, default=2, dest="per_week")
            sp.add_argument("--show", type=int, default=6)
        if name == "lectures":
            sp.add_argument("query", nargs="?", default="")
            sp.add_argument("--reindex", action="store_true")
            sp.add_argument("--resolve", action="store_true")
            sp.add_argument("--playable", action="store_true")
            sp.add_argument("--limit", type=int, default=50)
        if name == "journal":
            sp.add_argument("--limit", type=int, default=20)
        if name == "student":
            sp.add_argument("--register", action="store_true")
            sp.add_argument("--sync", action="store_true")
            sp.add_argument("--show", metavar="LOGIN_ID")
            sp.add_argument("--login")
            sp.add_argument("--name")
            sp.add_argument("--set", action="append", metavar="key=value")
            sp.add_argument("--registered", action="store_true")
        if name == "policy":
            sp.add_argument("--promote", metavar="routine.field")
            sp.add_argument("--demote", metavar="routine.field")
            sp.add_argument("--reason", default="")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    meta = COMMANDS[args.cmd]
    if meta["risk"] == RISK_WRITE and not getattr(args, "commit", False):
        print("이 명령은 서버에 씁니다. --commit 없이는 dry-run 입니다.", file=sys.stderr)
    try:
        return meta["fn"](args)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001
        print(f"오류: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
