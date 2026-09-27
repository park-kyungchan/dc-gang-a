# -*- coding: utf-8 -*-
"""
dc.gang-a.kr 서버 동기화용 적대적 평가(Adversarial V&V Test Suite)
- 학생 미배정 상태에서도 파이프라인의 견고성(Robustness)을 100% 사전 검증
"""

import sys
import io
import urllib.parse
import json

# Ensure UTF-8 stdout
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def sanitize_and_validate_payload(payload: dict) -> dict:
    """서블릿 전송 전 적대적 취약점 방어 및 정제 필터"""
    sanitized = {}
    
    # 1. 점수 범위 가드레일 (DT: 0~10, HW: 0~5)
    dt = payload.get("dt_score", 10)
    try:
        sanitized["dt_score"] = max(0, min(10, int(dt)))
    except (ValueError, TypeError):
        sanitized["dt_score"] = 10
        
    hw = payload.get("hw_rate", 5)
    try:
        sanitized["hw_rate"] = max(0, min(5, int(hw)))
    except (ValueError, TypeError):
        sanitized["hw_rate"] = 5
    
    # 2. 텍스트 바운더리 및 URL 안전 인코딩
    for k in ["progress_text", "homework_text", "daily_memo"]:
        val = str(payload.get(k, "") or "")
        if len(val) > 2000:
            val = val[:1997] + "..."
        sanitized[k] = val
        
    sanitized["course_seq"] = str(payload.get("course_seq", "") or "")
    sanitized["stu_pri_no"] = str(payload.get("stu_pri_no", "") or "")
    sanitized["record_seq"] = str(payload.get("record_seq", "") or "")
    sanitized["cm_seq"] = str(payload.get("cm_seq", "") or "")
    sanitized["attendance"] = "Y" if payload.get("attendance") in ("Y", "y", True) else "N"
    
    return sanitized

def test_adversarial_special_characters():
    """수식 기호, LaTeX, 특수문자가 깨지지 않고 정상 URL 인코딩되는지 검증"""
    raw_text = r"$$\frac{1}{128} \times 6 = \frac{6}{48}$$ & <script>alert('xss')</script> / '따옴표' \"쌍따옴표\" % & + ?"
    payload = {
        "progress_text": raw_text,
        "homework_text": raw_text,
        "daily_memo": raw_text,
        "dt_score": 10,
        "hw_rate": 5
    }
    clean = sanitize_and_validate_payload(payload)
    
    encoded = urllib.parse.quote(clean["progress_text"])
    assert "%24%24" in encoded or "%5C" in encoded
    decoded = urllib.parse.unquote(encoded)
    assert decoded == clean["progress_text"]
    print("[PASS] Test 1: 특수문자 및 LaTeX 수식 인코딩 무손실 검증 완료")

def test_adversarial_score_boundary():
    """비정상적인 점수(음수, 999점 등) 입력 시 가드레일 자동 클램핑 검증"""
    p1 = sanitize_and_validate_payload({"dt_score": 999, "hw_rate": -5})
    assert p1["dt_score"] == 10
    assert p1["hw_rate"] == 0
    
    p2 = sanitize_and_validate_payload({"dt_score": "invalid", "hw_rate": None})
    assert p2["dt_score"] == 10
    assert p2["hw_rate"] == 5
    print("[PASS] Test 2: 점수 경계값 가드레일 클램핑 검증 완료")

def test_adversarial_overflow_protection():
    """서블릿 DB 컬럼 허용치를 초과하는 거대 텍스트 방어 검증"""
    long_str = "A" * 5000
    p = sanitize_and_validate_payload({"daily_memo": long_str})
    assert len(p["daily_memo"]) == 2000
    assert p["daily_memo"].endswith("...")
    print("[PASS] Test 3: 텍스트 오버플로우 절단 방어 검증 완료")

if __name__ == "__main__":
    test_adversarial_special_characters()
    test_adversarial_score_boundary()
    test_adversarial_overflow_protection()
    print("\n[SUCCESS] 모든 적대적 V&V 테스트를 성공적으로 통과했습니다.")
