# -*- coding: utf-8 -*-
"""
학생별 독립 데이터베이스 관리 모듈 (Student-Isolated DB Substrate)
- 학생 1명당 1개의 전용 SQLite DB 파일 배정: data/students/{student_id}.db
- 유지/보수/이관/백업에 최적화된 독립 파일 구조
- 벡터 필기 좌표(JSON), O/X 채점, 오답 태그, 시계열 타임스탬프 영구 보존
"""

import os
import sqlite3
import json
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDENTS_DIR = os.path.join(BASE_DIR, "data", "students")
os.makedirs(STUDENTS_DIR, exist_ok=True)

def get_student_db_path(student_id: str, student_name: str = "") -> str:
    """학생 ID 기반의 개별 파일 경로 반환 (파일명에 이름 포함하여 식별 용이)"""
    safe_name = "".join(c for c in student_name if c.isalnum() or c in ('_', '-'))
    fname = f"{student_id}_{safe_name}.db" if safe_name else f"{student_id}.db"
    return os.path.join(STUDENTS_DIR, fname)

def get_student_connection(student_id: str, student_name: str = ""):
    """개별 학생 DB 연결 및 기본 스키마 자동 초기화"""
    db_path = get_student_db_path(student_id, student_name)
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    
    # 학생별 단일 DB 스키마 초기화
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS student_profile (
        student_id TEXT PRIMARY KEY,
        student_name TEXT NOT NULL,
        grade TEXT,
        target_school TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS problem_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        curriculum TEXT NOT NULL,       -- e.g. '2022개정'
        grade TEXT NOT NULL,            -- e.g. '5-1'
        series TEXT NOT NULL,           -- e.g. '가우스'
        volume INTEGER NOT NULL,        -- e.g. 2
        book_page INTEGER NOT NULL,     -- e.g. 31
        problem_no INTEGER NOT NULL,    -- e.g. 5
        lecture_key TEXT,               -- e.g. '1348938'
        result_status TEXT NOT NULL,    -- 'CORRECT', 'INCORRECT', 'PARTIAL'
        error_tag TEXT,                 -- '계산실수', '개념부족', '문맥오해' 등
        student_answer TEXT,            -- 학생 제출 정답
        teacher_feedback TEXT,          -- 선생님 실시간 피드백
        drawing_strokes_json TEXT,      -- 벡터 필기 좌표 스트로크
        drawing_image_b64 TEXT,         -- 썸네일 이미지
        time_spent_sec INTEGER,         -- 소요 시간(초)
        timestamp TEXT NOT NULL,        -- 시계열 타임스탬프 (ISO-8601)
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prob_lookup ON problem_logs(grade, series, volume, book_page, problem_no);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON problem_logs(timestamp);")
    
    # 프로필 기본 등록 (최초 생성 시)
    if student_name:
        cursor.execute("""
        INSERT INTO student_profile (student_id, student_name, last_active)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(student_id) DO UPDATE SET student_name=excluded.student_name, last_active=CURRENT_TIMESTAMP;
        """, (student_id, student_name))
    
    conn.commit()
    return conn

def record_student_submission(student_id: str, student_name: str, data: dict) -> int:
    """학생의 문제 풀이 및 채점 이력을 개별 DB에 기록"""
    conn = get_student_connection(student_id, student_name)
    cursor = conn.cursor()
    
    now_iso = datetime.now().isoformat()
    strokes_json = json.dumps(data.get("drawing_strokes", []), ensure_ascii=False)
    
    cursor.execute("""
    INSERT INTO problem_logs (
        curriculum, grade, series, volume, book_page, problem_no,
        lecture_key, result_status, error_tag, student_answer,
        teacher_feedback, drawing_strokes_json, drawing_image_b64,
        time_spent_sec, timestamp
    ) VALUES (
        :curriculum, :grade, :series, :volume, :book_page, :problem_no,
        :lecture_key, :result_status, :error_tag, :student_answer,
        :teacher_feedback, :drawing_strokes_json, :drawing_image_b64,
        :time_spent_sec, :timestamp
    );
    """, {
        "curriculum": data.get("curriculum", "2022개정"),
        "grade": data.get("grade", "5-1"),
        "series": data.get("series", "가우스"),
        "volume": data.get("volume", 2),
        "book_page": data.get("book_page", 31),
        "problem_no": data.get("problem_no", 5),
        "lecture_key": data.get("lecture_key", ""),
        "result_status": data.get("result_status", "CORRECT"),
        "error_tag": data.get("error_tag", ""),
        "student_answer": data.get("student_answer", ""),
        "teacher_feedback": data.get("teacher_feedback", ""),
        "drawing_strokes_json": strokes_json,
        "drawing_image_b64": data.get("drawing_image_b64", ""),
        "time_spent_sec": data.get("time_spent_sec", 0),
        "timestamp": data.get("timestamp", now_iso)
    })
    
    log_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return log_id

def get_student_history(student_id: str, student_name: str = "", book_page: int = None, problem_no: int = None):
    """특정 학생의 과거 풀이 이력 및 필기 스트로크 조회"""
    conn = get_student_connection(student_id, student_name)
    cursor = conn.cursor()
    
    query = "SELECT * FROM problem_logs WHERE 1=1"
    params = []
    if book_page is not None:
        query += " AND book_page = ?"
        params.append(book_page)
    if problem_no is not None:
        query += " AND problem_no = ?"
        params.append(problem_no)
    query += " ORDER BY timestamp DESC"
    
    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def list_all_students():
    """존재하는 모든 학생 DB 목록 조회"""
    students = []
    if not os.path.exists(STUDENTS_DIR):
        return students
    for f in os.listdir(STUDENTS_DIR):
        if f.endswith(".db"):
            sid = f.replace(".db", "").split("_")[0]
            db_path = os.path.join(STUDENTS_DIR, f)
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            try:
                prof = cur.execute("SELECT * FROM student_profile LIMIT 1;").fetchone()
                if prof:
                    students.append(dict(prof))
                else:
                    students.append({"student_id": sid, "student_name": sid})
            except Exception:
                students.append({"student_id": sid, "student_name": sid})
            finally:
                conn.close()
    return students

if __name__ == "__main__":
    # Test individual student creation
    print("Testing Student-Isolated DB Substrate...")
    conn = get_student_connection("STU001", "김민준")
    record_student_submission("STU001", "김민준", {
        "grade": "5-1", "series": "가우스", "volume": 2, "book_page": 31, "problem_no": 5,
        "lecture_key": "1348938", "result_status": "CORRECT", "error_tag": "",
        "student_answer": "7개", "teacher_feedback": "단위분수 약분 개념 완벽 이해"
    })
    hist = get_student_history("STU001", "김민준", 31, 5)
    print(f"Recorded {len(hist)} entries in STU001_김민준.db")
    print("Student list:", list_all_students())
