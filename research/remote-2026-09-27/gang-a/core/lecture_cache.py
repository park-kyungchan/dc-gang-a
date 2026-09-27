# -*- coding: utf-8 -*-
"""
강의 영상 오프라인 캐시 관리 모듈 (Lecture Video Cache Substrate)
- 문항당 3~5분 해설 클립(8~12MB) 로컬 캐싱 관리: data/lectures/{lecture_key}.mp4
- 로컬 파일 존재 시 0초 즉시 오프라인 재생, 부재 시 온라인 스트림 폴백
"""

import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LECTURE_CACHE_DIR = os.path.join(BASE_DIR, "data", "lectures")
os.makedirs(LECTURE_CACHE_DIR, exist_ok=True)

def get_lecture_video_path(lecture_key: str) -> str:
    """로컬 캐시 비디오 경로 반환"""
    return os.path.join(LECTURE_CACHE_DIR, f"{lecture_key}.mp4")

def is_lecture_cached(lecture_key: str) -> bool:
    """로컬 캐시 파일 존재 및 크기 검증 (> 100KB)"""
    path = get_lecture_video_path(lecture_key)
    return os.path.exists(path) and os.path.getsize(path) > 100 * 1024

def get_lecture_metadata(lecture_key: str) -> dict:
    """강의 메타데이터 및 로컬/온라인 재생 경로 반환"""
    db_path = os.path.join(BASE_DIR, "data", "curriculum_bank.db")
    meta = {
        "lecture_key": lecture_key,
        "is_cached": is_lecture_cached(lecture_key),
        "local_path": get_lecture_video_path(lecture_key),
        "stream_url": f"https://dc.gang-a.kr/lecture/{lecture_key}",
        "title": f"문항 해설강의 #{lecture_key}",
        "duration": "04:00",
        "estimated_size_mb": 9.5
    }
    
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            row = conn.cursor().execute("SELECT * FROM problem_lectures WHERE lecture_key = ?", (lecture_key,)).fetchone()
            if row:
                r_dict = dict(row)
                meta["title"] = r_dict.get("title", meta["title"])
                meta["duration"] = f"{r_dict.get('duration_sec', 240)//60:02d}:{r_dict.get('duration_sec', 240)%60:02d}"
                meta["stream_url"] = r_dict.get("video_stream_url") or meta["stream_url"]
                if r_dict.get("time_markers_json"):
                    meta["chapters"] = json.loads(r_dict["time_markers_json"])
            conn.close()
        except Exception:
            pass
            
    return meta

if __name__ == "__main__":
    print("Lecture cache substrate initialized. Cache dir:", LECTURE_CACHE_DIR)
    print("Sample lookup #1348938:", get_lecture_metadata("1348938"))
