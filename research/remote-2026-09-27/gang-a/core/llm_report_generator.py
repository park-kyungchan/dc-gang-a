# -*- coding: utf-8 -*-
"""
LLM 기반 수업일지 & 데일리리포트 자동 생성기 (LLM Report Generator)
- 학생의 실시간 풀이 이력(O/X, 오답 태그, 소요 시간, 하브루타 역질문)을 분석하여
- dc.gang-a.kr DayRecordServlet의 3대 핵심 입력란(진도/숙제/데일리리포트) 규격으로 자동 포맷팅
"""

import os
import json
from datetime import datetime

def generate_daily_report_payload(student_info: dict, problem_logs: list, teacher_prompt: str = "") -> dict:
    """
    학생 풀이 이력과 선생님 추가 메모를 결합하여 dc.gang-a.kr 서버 전송용 정규 페이로드 생성
    """
    total_probs = len(problem_logs)
    correct_count = sum(1 for p in problem_logs if p.get("result_status") == "CORRECT")
    error_tags = [p.get("error_tag") for p in problem_logs if p.get("error_tag")]
    
    # 1. 교재 및 진도 텍스트 (prg_txt)
    curriculum = problem_logs[0].get("curriculum", "2022개정") if problem_logs else "2022개정"
    grade = problem_logs[0].get("grade", "5-1") if problem_logs else "5-1"
    series = problem_logs[0].get("series", "가우스") if problem_logs else "가우스"
    volume = problem_logs[0].get("volume", 2) if problem_logs else 2
    book_page = problem_logs[0].get("book_page", 31) if problem_logs else 31
    prob_nos = [str(p.get("problem_no", "")) for p in problem_logs]
    prob_range_str = f"{min(prob_nos)}~{max(prob_nos)}번" if len(prob_nos) > 1 else f"{prob_nos[0]}번" if prob_nos else "전체"
    
    progress_text = f"[{grade} {series} {volume}권] p.{book_page} 실력쌓기 {prob_range_str} ({correct_count}/{total_probs} 통과)"

    # 2. 다음 시간 과제 (hw_txt)
    next_page = book_page + 1
    homework_text = f"[{grade} {series} {volume}권] p.{next_page} 1~6번 자가진단 및 개념 복습"

    # 3. 하브루타 코칭 & 학부모 발송용 데일리리포트 (memo_txt)
    student_name = student_info.get("student_name", "학생")
    
    # 하브루타 핵심 발문 정리
    habruta_notes = []
    for p in problem_logs:
        if p.get("habruta_q"):
            habruta_notes.append(f"- {p.get('problem_no')}번 발문: {p.get('habruta_q')}")
            
    habruta_str = "\n".join(habruta_notes[:2]) if habruta_notes else "- 약분 및 단위분수 개념 구두 설명 완료"
    
    tag_str = f" (보완태그: {', '.join(set(error_tags))})" if error_tags else ""
    
    daily_memo = (
        f"[1:1 하브루타 코칭 리포트]\n"
        f"오늘 {student_name} 학생은 {grade} {series} {volume}권 p.{book_page} 단원을 집중 학습했습니다.\n"
        f"1. 학습 성취도: {total_probs}문항 중 {correct_count}문항 완벽 정답{tag_str}\n"
        f"2. 하브루타 역질문 코칭:\n{habruta_str}\n"
        f"3. 강사 소견: {teacher_prompt if teacher_prompt else '기약분수 변환 과정에서 분모 약수 조건을 스스로 정확히 도출해 냈습니다.'}"
    )

    # 4. 숙제 성취도(0~5) 및 DT 점수(0~10) 자동 환산
    hw_rate = 5 if correct_count == total_probs else 4
    dt_score = round((correct_count / total_probs) * 10) if total_probs > 0 else 10

    payload = {
        "student_name": student_name,
        "course_seq": student_info.get("course_seq", ""),
        "stu_pri_no": student_info.get("stu_pri_no", ""),
        "record_seq": student_info.get("record_seq", ""),
        "cm_seq": student_info.get("cm_seq", ""),
        "progress_text": progress_text,
        "homework_text": homework_text,
        "daily_memo": daily_memo,
        "dt_score": dt_score,
        "hw_rate": hw_rate,
        "attendance": "Y"
    }
    return payload

if __name__ == "__main__":
    sample_st = {"student_name": "김민준", "stu_pri_no": "1001", "record_seq": "2001", "cm_seq": "3001"}
    sample_logs = [
        {"curriculum": "2022개정", "grade": "5-1", "series": "가우스", "volume": 2, "book_page": 31, "problem_no": 5, "result_status": "CORRECT", "habruta_q": "128의 약수는 8개인데, 왜 정답은 7개일까?"},
        {"curriculum": "2022개정", "grade": "5-1", "series": "가우스", "volume": 2, "book_page": 31, "problem_no": 6, "result_status": "CORRECT", "habruta_q": "약분하기 전 분수를 찾으려면 무엇을 곱해야 할까?"}
    ]
    res = generate_daily_report_payload(sample_st, sample_logs, "단위분수 약분 역연산 개념을 완벽하게 설명함.")
    print("Generated Payload for dc.gang-a.kr:")
    print(json.dumps(res, indent=2, ensure_ascii=False))
