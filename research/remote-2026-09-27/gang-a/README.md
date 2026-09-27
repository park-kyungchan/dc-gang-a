# 📚 강의하는아이들 대치점 교재/수업/학습 자동화 시스템 (Ganga Tutor Automation)

본 저장소는 **강의하는아이들 대치점(dc.gang-a.kr)** 강사 업무 지원 및 초·중등 수학 교재의 **결정론적 로컬 데이터베이스 질의, 300 DPI 초정밀 스냅샷 분할, LaTeX 수식 검증 및 Zero-HITL 자율 파이프라인**을 제공합니다.

---

## ⚡ 빠른 시작 가이드 (Quick Start for Zero-Context Agents)

> [!IMPORTANT]
> **토큰 절약 및 결정론적 원칙**:
> 1. 이미 파싱/적재된 문항 질의 시 PDF 전문을 프롬프트로 읽지 마시고, **SQLite DB(`data/curriculum_bank.db`)를 쿼리(0.01초, 토큰 0)**하세요.
> 2. 신규 페이지/단원 인덱싱 시 수작업 코드를 작성하지 마시고, **`core/run_autonomous_pipeline.py` CLI(Gate 1~7 자가치유)**를 단 1회 실행하세요.
> 3. 사용자 요청이 모호할 경우 임의로 추측하지 마시고 **Gate 0 규칙에 따라 명확해질 때까지 되물으세요**.

---

## 🔍 1. 결정론적 로컬 DB 질의 (0.01초 / 토큰 0)

기구축된 문항의 정답, $\LaTeX$ 상세 풀이, 강의코드(#lec_key), 300 DPI 스냅샷 경로를 즉시 질의합니다.

```python
from core.curriculum_db import get_connection

conn = get_connection()
cursor = conn.cursor()
cursor.execute("""
    SELECT grade, series, volume, book_page, problem_no, lecture_key, answer, solution, snapshot_path 
    FROM problem_answers 
    WHERE grade = '5-1' AND series = '다빈치' AND volume = 2 AND book_page = 30
    ORDER BY problem_no ASC;
""")
rows = cursor.fetchall()
for r in rows:
    print(f"[{r['book_page']}쪽 {r['problem_no']}번] 정답: {r['answer']} | 강의코드: #{r['lecture_key']}")
```

---

## 🚀 2. Zero-HITL 자율 파이프라인 실행 (신규 페이지/단원 인덱싱)

지정한 교재 및 페이지 범위에 대해 **Gate 1(PUA 정규화) ~ Gate 7(Base64 대시보드)**을 완전 무인으로 일괄 실행합니다.

```bash
# 5-1 다빈치 2권 32쪽~35쪽 대단원 총괄평가 자동 크롭 및 DB 적재
python core/run_autonomous_pipeline.py --grade 5-1 --series 다빈치 --volume 2 --page-start 32 --page-end 35
```

### [실행 완료 후 생성 산출물]
* **로컬 DB 갱신**: `data/curriculum_bank.db`
* **300 DPI 스냅샷**: `data/snapshots/p{page}_q{prob}.png`
* **통합 검증 리포트**: `autonomous_vv_report.html` (Base64 인라인 내장)

---

## 🛡️ 3. 8대 게이트 및 Gate 0 (의도 명확화 되묻기) 규칙

| 게이트 | 명칭 | 기능 및 규칙 |
| :---: | :--- | :--- |
| **Gate 0** | **의도 명확화 (Intent Clarification)** | `(grade, series, volume, unit, section, page, prob)` 6대 인자 중 누락/모호 시 **임의 추측 금지 & 정밀 되묻기** |
| **Gate 1** | **PUA 유니코드 정규화** | 0xE000~0xF8FF 특수 수학 폰트를 표준 LaTeX/수식으로 100% 매핑 |
| **Gate 2** | **교재 구조 분할** | 목차(TOC) 및 페이지 헤더/푸터 기반 섹션 계층 분할 |
| **Gate 3** | **다단 기하학 & 앵커링** | 좌/우 2단 분할 및 고유 7자리 강의코드(#lec_key) 앵커링 |
| **Gate 4** | **300 DPI 초정밀 크롭 & 가드** | Method C (벡터+텍스트 융합) 및 4면 외곽 1px 절단(Clipping) 0% 검증 |
| **Gate 5** | **LaTeX & OCR 역검증** | KaTeX AST 문법 검증 및 크롭 이미지 역인식 토큰 일치도 자체 감사 |
| **Gate 6** | **SQLite DB B-Tree 적재** | ACID 트랜잭션 기반 결정론적 색인 적재 |
| **Gate 7** | **자가치유 & Base64 리포트** | 이상 감지 시 거터/패딩 자동 확장 자가치유 및 독립형 HTML 발행 |
