#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🎓 강의하는아이들 대치점 강사 통합 실무 자동화 시스템 (Main Runner)
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import json
import requests
from bs4 import BeautifulSoup
from datetime import datetime

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(ROOT_DIR, "config", "config.json")
REPORTS_DIR = os.path.join(ROOT_DIR, "reports")

def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

def get_session():
    cfg = load_config()
    session_id = cfg.get("session", {}).get("JSESSIONID", "")
    session = requests.Session()
    session.cookies.set("JSESSIONID", session_id, domain="dc.gang-a.kr")
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://dc.gang-a.kr/servlet/controller.tutor.TutorMenuIndexServlet?p_process=CourseManageIndex"
    })
    return session, cfg

def check_session(session):
    try:
        r = session.get("https://dc.gang-a.kr/servlet/controller.tutor.TutorMenuIndexServlet?p_process=CourseManageIndex", timeout=8)
        if "normal_session_error" in r.text or r.status_code != 200:
            return False, "세션 만료 (로그인 필요)"
        return True, "세션 정상 연결"
    except Exception as e:
        return False, str(e)

def update_cookie_flow():
    print("\n" + "=" * 60)
    print("🔑 세션 쿠키 (JSESSIONID) 업데이트")
    print("=" * 60)
    print("1. 브라우저에서 dc.gang-a.kr 로그인 후 F12 개발자 도구 실행")
    print("2. [Application] -> [Cookies] -> [JSESSIONID] 값 복사")
    new_cookie = input("\n새 JSESSIONID 값을 입력하세요 (취소는 엔터): ").strip()
    if new_cookie:
        cfg = load_config()
        cfg["session"]["JSESSIONID"] = new_cookie
        cfg["session"]["last_updated"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        save_config(cfg)
        print("✅ 새 쿠키가 config.json에 성공적으로 저장되었습니다!")
        
        # Test immediately
        session, _ = get_session()
        ok, msg = check_session(session)
        if ok:
            print("🎉 [연결 성공] 대치점 포털에 정상 인증되었습니다.")
        else:
            print(f"⚠️ [연결 주의] {msg}")
    else:
        print("쿠키 업데이트가 취소되었습니다.")

def menu_class_management(session):
    print("\n" + "=" * 60)
    print("📂 [1. 수업관리]")
    print("=" * 60)
    print("1) 📅 수업 일정 및 학반 스케줄 조회")
    print("2) 👥 담당 학생 및 편성 목록 조회")
    print("3) 📝 일일 수업일지 & 데일리리포트 링크 확인")
    print("4) ⏱️ 학생별 출결 현황 조회")
    print("0) 이전 메뉴로")
    
    sub = input("\n메뉴 번호를 선택하세요: ").strip()
    if sub == "1":
        r = session.get("https://dc.gang-a.kr/servlet/controller.cct.tutor.CourseScheduleServlet?p_process=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[수업 일정표]")
        for tr in soup.find_all("tr"):
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds and len(tds) > 2:
                print("  •", " | ".join(tds))
    elif sub == "2":
        r = session.get("https://dc.gang-a.kr/servlet/controller.tutor.base.UserSearchServlet?p_process=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        main_table = soup.find("table", class_="content-table")
        students = []
        if main_table:
            tbody = main_table.find("tbody") if main_table.find("tbody") else main_table
            for tr in tbody.find_all("tr", recursive=False):
                tds = tr.find_all("td", recursive=False)
                if len(tds) >= 6:
                    students.append((tds[0].get_text(strip=True), tds[1].get_text(strip=True), tds[2].get_text(strip=True)))
        print(f"\n[학생 목록 - 총 {len(students)}명]")
        for idx, (id_n, gr, cl) in enumerate(students, 1):
            print(f"  [{idx}] {id_n:<20} | 학년: {gr:<4} | 학반: {cl}")
    elif sub == "3":
        r = session.get("https://dc.gang-a.kr/servlet/controller.cct.tutor.DayRecordServlet?p_process=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[수업일지 현황]")
        for tr in soup.find_all("tr")[:10]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds:
                print("  •", " | ".join(tds))
    elif sub == "4":
        r = session.get("https://dc.gang-a.kr/servlet/controller.cct.tutor.AttendanceServlet?p_process=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[출결 현황]")
        for tr in soup.find_all("tr")[:10]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds:
                print("  •", " | ".join(tds))

def menu_study_management(session):
    print("\n" + "=" * 60)
    print("📂 [2. 학습관리]")
    print("=" * 60)
    print("1) 🎯 DT (데일리테스트) / ZT (제로테스트) 출제 및 결과")
    print("2) 📈 학생별 개념/유형 진도현황표")
    print("3) 📹 가정 예습 영상(하브루타 촬영) 제출 현황")
    print("4) 📖 교재별 빠른 정답지 & 일일 학습")
    print("0) 이전 메뉴로")
    
    sub = input("\n메뉴 번호를 선택하세요: ").strip()
    if sub == "1":
        r = session.get("https://dc.gang-a.kr/servlet/controller.dailyzerotest.DailyZeroTestServlet?reqCmd=DailyZeroTestResult")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[DT / ZT 응시 결과]")
        for tr in soup.find_all("tr")[:10]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds:
                print("  •", " | ".join(tds))
    elif sub == "2":
        r = session.get("https://dc.gang-a.kr/servlet/controller.coursemanage.CourseManageServlet?reqCmd=StudyMain")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[진도 현황]")
        for tr in soup.find_all("tr")[:10]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds:
                print("  •", " | ".join(tds))
    elif sub == "3":
        r = session.get("https://dc.gang-a.kr/servlet/controller.coursemanage.CourseManageServlet?reqCmd=TeacherPrestudySummary")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[예습영상 현황]")
        for tr in soup.find_all("tr")[:10]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds:
                print("  •", " | ".join(tds))
    elif sub == "4":
        r = session.get("https://dc.gang-a.kr/servlet/controller.coursemanage.CourseManageServlet?reqCmd=GaStudyAnswer")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[교재정답지 & 일일학습]")
        for tr in soup.find_all("tr")[:10]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds:
                print("  •", " | ".join(tds))

def menu_test_maker(session):
    print("\n" + "=" * 60)
    print("📂 [3. 문제지제작]")
    print("=" * 60)
    print("1) 🗂️ 제작된 e-Test 문제지 풀 목록 조회")
    print("2) 📝 형성평가(FA) 시험지 목록 및 출제")
    print("3) 📘 스마트북 워크북 목록 조회")
    print("0) 이전 메뉴로")
    
    sub = input("\n메뉴 번호를 선택하세요: ").strip()
    if sub == "1":
        r = session.get("https://dc.gang-a.kr/servlet/controller.tutor.etest.TestPoolServlet?reqCmd=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[e-Test 문제지 목록]")
        for tr in soup.find_all("tr")[:15]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds and len(tds) >= 3:
                print("  •", " | ".join(tds))
    elif sub == "2":
        r = session.get("https://dc.gang-a.kr/servlet/controller.tutor.fa.TestPageListGrpServlet?p_process=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[형성평가 시험지 목록]")
        for tr in soup.find_all("tr")[:15]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds and len(tds) >= 3:
                print("  •", " | ".join(tds))
    elif sub == "3":
        r = session.get("https://dc.gang-a.kr/servlet/controller.tutor.wb.WorkbookManageServlet?p_process=Main")
        soup = BeautifulSoup(r.text, "html.parser")
        print("\n[스마트북 목록]")
        for tr in soup.find_all("tr")[:15]:
            tds = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if tds and len(tds) >= 3:
                print("  •", " | ".join(tds))

def menu_knowledge_search():
    print("\n" + "=" * 60)
    print("🔍 [5. 실무 가이드 & VTT 자막 키워드 검색]")
    print("=" * 60)
    keyword = input("검색할 키워드를 입력하세요 (예: LBAD, 코넬노트, DT, 생색, 수업일지): ").strip()
    if not keyword:
        return
    
    docs_dir = os.path.join(ROOT_DIR, "docs", "transcripts")
    matches = []
    if os.path.exists(docs_dir):
        for fn in sorted(os.listdir(docs_dir)):
            if fn.endswith(".vtt"):
                fp = os.path.join(docs_dir, fn)
                with open(fp, "r", encoding="utf-8") as f:
                    lines = f.read().splitlines()
                for i, line in enumerate(lines):
                    if keyword in line:
                        ts = ""
                        for j in range(max(0, i-5), i):
                            if "-->" in lines[j]:
                                ts = lines[j]
                                break
                        matches.append((fn, ts, line))
    
    print(f"\n[검색 결과: 총 {len(matches)}건 발견]")
    for fn, ts, line in matches[:10]:
        print(f"  • [{fn}] {ts}")
        print(f"    👉 {line}\n")
    if len(matches) > 10:
        print(f"  ...외 {len(matches)-10}건의 검색 결과가 더 있습니다.")

def main():
    while True:
        session, cfg = get_session()
        ok, msg = check_session(session)
        status_badge = "🟢 연결됨" if ok else "🔴 만료됨"
        
        print("\n" + "=" * 70)
        print(f"🎓 강의하는아이들 대치점 강사 자동화 콘솔 | {status_badge} ({msg})")
        print(f"   선생님 ID: {cfg.get('teacher_pri_no')} | 지점: {cfg.get('branch_name')}({cfg.get('fran_no')})")
        print("=" * 70)
        print("  [1] 📋 수업관리 (시간표 / 학생편성 / 출결 / 수업일지)")
        print("  [2] 📈 학습관리 (DT·ZT 결과 / 진도현황 / 예습영상 제출현황)")
        print("  [3] 📝 문제지제작 (e-Test 문제은행 / 형성평가 / 스마트북)")
        print("  [4] 🔑 세션 쿠키 (JSESSIONID) 업데이트")
        print("  [5] 🔍 강사 실무 지식 & VTT 자막 통합 검색")
        print("  [0] 🚪 프로그램 종료")
        print("=" * 70)
        
        choice = input("원하시는 메뉴 번호를 입력하세요: ").strip()
        
        if choice == "1":
            if not ok: print("⚠️ 세션이 만료되었습니다. [4]번 메뉴에서 쿠키를 먼저 업데이트해 주세요."); continue
            menu_class_management(session)
        elif choice == "2":
            if not ok: print("⚠️ 세션이 만료되었습니다. [4]번 메뉴에서 쿠키를 먼저 업데이트해 주세요."); continue
            menu_study_management(session)
        elif choice == "3":
            if not ok: print("⚠️ 세션이 만료되었습니다. [4]번 메뉴에서 쿠키를 먼저 업데이트해 주세요."); continue
            menu_test_maker(session)
        elif choice == "4":
            update_cookie_flow()
        elif choice == "5":
            menu_knowledge_search()
        elif choice == "0":
            print("\n프로그램을 종료합니다. 수고하셨습니다!")
            break
        else:
            print("\n⚠️ 올바른 번호를 입력해 주세요.")

if __name__ == "__main__":
    main()
