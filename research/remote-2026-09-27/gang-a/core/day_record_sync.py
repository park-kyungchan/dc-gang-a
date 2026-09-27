# -*- coding: utf-8 -*-
"""
dc.gang-a.kr 서버 수업일지(DayRecordServlet) 실시간 동기화 브릿지 엔진
- 로컬 LLM이 정제한 수업일지 데이터를 dc.gang-a.kr 서버의 실제 서블릿 입력란에 1:1 매핑하여 직접 입력
- 지원 서블릿 엔드포인트:
  1. udtPrg: 당일 진도 내용 (prg_txt)
  2. udtHw: 다음 시간 과제 (hw_txt)
  3. udtMemo: 학부모 발송 데일리리포트 / 하브루타 코칭 종합 메모 (memo_txt)
  4. SetDailyTest: DT 점수 (daily_test_radio: 0~10)
  5. SetHomeWorkRate: 숙제 완성도 (homework_rate_no: 0~5)
  6. udtAttn: 출석 여부 (attn_yn: Y/N)
"""

import os
import json
import requests
import urllib.parse
from datetime import datetime
from bs4 import BeautifulSoup

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "config.json")

class DayRecordSyncBridge:
    def __init__(self, config_path=CONFIG_PATH):
        self.config_path = config_path
        self.load_config()
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": f"{self.base_url}/servlet/controller.cct.tutor.DayRecordServlet?p_process=Main"
        })
        if self.jsessionid:
            self.session.cookies.set("JSESSIONID", self.jsessionid)

    def load_config(self):
        with open(self.config_path, "r", encoding="utf-8") as f:
            self.config = json.load(f)
        self.base_url = self.config.get("base_url", "https://dc.gang-a.kr")
        self.teacher_pri_no = self.config.get("teacher_pri_no", "1292923")
        self.jsessionid = self.config.get("session", {}).get("JSESSIONID", "")

    def get_today_student_records(self, date_str=None, grp_seq="0"):
        """당일 수업일지 페이지에서 학생별 record_seq, cm_seq, course_seq, stu_pri_no 매핑 테이블 추출"""
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")
            
        url = f"{self.base_url}/servlet/controller.cct.tutor.DayRecordServlet?p_process=Main"
        params = {
            "std_date": date_str,
            "std_ymd": date_str.replace("-", ""),
            "teacher_pri_no": self.teacher_pri_no,
            "grp_seq": grp_seq
        }
        
        r = self.session.get(url, params=params, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        
        students = []
        # 테이블 내 학생 행 파싱
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 5:
                row_text = "".join(td.get_text(strip=True) for td in tds)
                # onclick 이나 입력 필드에서 파라미터 식별
                st_info = {}
                for btn in tr.find_all(["input", "a", "button", "select"]):
                    onclick = btn.get("onclick", "")
                    if "setDailyTest" in onclick or "setCourseData" in onclick or "udt" in onclick:
                        st_info["action_sample"] = onclick
                st_info["raw_text"] = row_text[:50]
                if st_info.get("action_sample"):
                    students.append(st_info)
                    
        return {
            "date": date_str,
            "total_found": len(students),
            "html_status": r.status_code
        }

    def sync_student_day_record(self, payload: dict) -> dict:
        """
        LLM이 정제한 학생 데이터를 dc.gang-a.kr 서버의 실제 필드에 1:1로 전송하여 반영
        
        payload 예시:
        {
            "course_seq": "12345",
            "stu_pri_no": "98765",
            "record_seq": "54321",
            "cm_seq": "11223",
            "progress_text": "[초등 5-1 가우스 2권] p.31 실력쌓기 5~8번 완벽 통과",
            "homework_text": "[초등 5-1 가우스 2권] p.32 1~6번 및 개념인출 퀴즈",
            "daily_memo": "하브루타 코칭을 통해 약분 시 단위분수 판별 원리를 스스로 완벽히 설명함.",
            "dt_score": 10,       # 0~10
            "hw_rate": 5,         # 0~5 (5: 완벽)
            "attendance": "Y"     # Y / N
        }
        """
        results = {}
        course_seq = payload.get("course_seq", "")
        stu_pri_no = payload.get("stu_pri_no", "")
        record_seq = payload.get("record_seq", "")
        cm_seq = payload.get("cm_seq", "")
        
        # 1. 진도 업데이트 (udtPrg)
        if "progress_text" in payload:
            prg_url = f"{self.base_url}/servlet/controller.cct.tutor.DayRecordServlet"
            params = {
                "reqCmd": "udtPrg",
                "prg_txt": payload["progress_text"],
                "course_seq": course_seq,
                "stu_pri_no": stu_pri_no,
                "record_seq": record_seq,
                "cm_seq": cm_seq,
                "dummy": datetime.now().timestamp()
            }
            r = self.session.get(prg_url, params=params, timeout=10)
            results["progress_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

        # 2. 숙제/과제 업데이트 (udtHw)
        if "homework_text" in payload:
            hw_url = f"{self.base_url}/servlet/controller.cct.tutor.DayRecordServlet"
            params = {
                "reqCmd": "udtHw",
                "hw_txt": payload["homework_text"],
                "course_seq": course_seq,
                "stu_pri_no": stu_pri_no,
                "record_seq": record_seq,
                "cm_seq": cm_seq,
                "dummy": datetime.now().timestamp()
            }
            r = self.session.get(hw_url, params=params, timeout=10)
            results["homework_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

        # 3. 데일리리포트 종합 메모 업데이트 (udtMemo)
        if "daily_memo" in payload:
            memo_url = f"{self.base_url}/servlet/controller.cct.tutor.DayRecordServlet"
            params = {
                "reqCmd": "udtMemo",
                "memo_txt": payload["daily_memo"],
                "course_seq": course_seq,
                "stu_pri_no": stu_pri_no,
                "record_seq": record_seq,
                "cm_seq": cm_seq,
                "dummy": datetime.now().timestamp()
            }
            r = self.session.get(memo_url, params=params, timeout=10)
            results["daily_memo_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

        # 4. 데일리테스트(DT) 점수 반영 (SetDailyTest)
        if "dt_score" in payload:
            common_url = f"{self.base_url}/servlet/controller.cct.common.CourseCommonServlet"
            data = {
                "reqCmd": "SetDailyTest",
                "cm_seq": cm_seq,
                "record_seq": record_seq,
                "tutor_pri_no": self.teacher_pri_no,
                "daily_test_radio": payload["dt_score"]
            }
            r = self.session.post(common_url, data=data, timeout=10)
            results["dt_score_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

        # 5. 숙제 성취도 반영 (SetHomeWorkRate)
        if "hw_rate" in payload:
            common_url = f"{self.base_url}/servlet/controller.cct.common.CourseCommonServlet"
            data = {
                "reqCmd": "SetHomeWorkRate",
                "cm_seq": cm_seq,
                "record_seq": record_seq,
                "tutor_pri_no": self.teacher_pri_no,
                "homework_rate_no": payload["hw_rate"]
            }
            r = self.session.post(common_url, data=data, timeout=10)
            results["hw_rate_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

        # 6. 출결 상태 반영 (udtAttn)
        if "attendance" in payload:
            attn_url = f"{self.base_url}/servlet/controller.cct.tutor.DayRecordServlet"
            params = {
                "reqCmd": "udtAttn",
                "attn_yn": payload["attendance"],
                "course_seq": course_seq,
                "stu_pri_no": stu_pri_no,
                "record_seq": record_seq,
                "cm_seq": cm_seq,
                "dummy": datetime.now().timestamp()
            }
            r = self.session.get(attn_url, params=params, timeout=10)
            results["attendance_sync"] = "OK" if r.status_code == 200 else f"ERR_{r.status_code}"

        return results

if __name__ == "__main__":
    print("Testing DayRecordSyncBridge Substrate...")
    bridge = DayRecordSyncBridge()
    status = bridge.get_today_student_records()
    print("Bridge connection status:", status)
