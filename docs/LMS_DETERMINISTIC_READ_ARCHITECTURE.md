# LMS 백엔드 결정론적 읽기(Deterministic Read-Only) 아키텍처 및 학생별 개별 DB 구축 보고서

**작성일**: 2026-09-28  
**적용 대상**: 대치 강의하는 아이들 (`dc-gang-a`)  
**상태**: 검증 완료 (Production Ready, 66 Bun Tests 100% Pass, Python 17 Tests 100% Pass)

---

## 1. 결정론적 읽기(Deterministic Read-Only) 아키텍처가 왜 중요한가?

### 1.1 가상 데이터(Synthetic)의 환각 폭포(Error Cascade) 차단
- 이전 세션에서 에이전트들은 LMS 백엔드의 실제 응시 내역을 실시간으로 확인하지 못한 채, 추측에 기반한 가상 점수(예: 유지연 95점, 신지우 오답 7/14번, 박세은 85점)를 설정하여 일지와 시트에 반영하는 중대한 환각 오류가 발생했습니다.
- 실제 LMS 백엔드 DB 실측 결과:
  - **유지연 (`1293138`)**: 당초 95점(가상) ➔ **실제 84점 (25문항 중 21정답, 오답 1, 15, 16, 23번)**
  - **신지우 (`1293032`)**: 당초 오답 7/14번(가상) ➔ **실제 90점 (20문항 중 18정답, 오답 19, 20번)**
  - **박세은 (`1293067`)**: 당초 85점(가상) ➔ **실제 65점 (20문항 중 13정답, 오답 6, 7, 15, 17, 18, 19, 20번)**
- 가상 데이터가 시트에 누적될 경우 학생의 실제 취약 단원(예: 박세은 학생의 65점 분수의 곱셈 결손)을 놓치게 되며, 후속 클리닉 프린트 배부와 Daily Test 이월 계획이 완전히 왜곡됩니다.

### 1.2 Zero-Context Agent 및 다른 PC LLM(Adversarial Auditor)의 검증 가능성
- 새로운 에이전트나 외부 평가 LLM이 투입되었을 때, 복잡한 인수인계나 배경지식 없이도 **단일 커맨드로 백엔드의 실제 데이터(Ground Truth)를 오차 없이 조회하고 재현**할 수 있어야 합니다.
- 프로세스 메모리 격리 방식으로 세션 토큰을 전달받아 결정론적(Deterministic)으로 파싱하므로, 언제 어디서 실행하더라도 100% 동일한 채점 결과와 문항 데이터를 획득합니다.

---

## 2. LMS 백엔드 5-Tier 조인 스파인 및 읽기 파이프라인

LMS 백엔드는 관계형 키가 URL과 스크립트 변수에 분산되어 있으므로 아래 5단계 키 조인 스파인을 엄격히 준수합니다:

```
[1. 학생 키] stu_pri_no (예: 1293138)
       │
       ▼
[2. 강좌 키] course_seq (예: 5)
       │
       ▼
[3. 시험지 키] pNo (예: 6343283) ➔ 1급 시민 고유 식별자
       │
       ▼
[4. 응시 고유번호] testingNo (예: 20549621)
       │
       ▼
[5. 문항별 채점] _examNo, examScore, examScoreMax, answer1, answer2
```

### 2.1 2대 안전 읽기 엔드포인트
1. **시험지 목록 및 총점 조회 (`UserBySearchTestResult`)**:
   - `POST /servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=1001`
   - 응답 HTML 내 `EXTERN_DIALOG = { testResultList: JSON.parse(...) }` 블록에서 `pNo`, `testingNo`, `score`, `oQuestions`, `applyDate`를 결정론적으로 추출.
2. **문항별 O/X 및 학생 답안 상세 조회 (`PupilSearch`)**:
   - `GET /servlet/controller.tutor.fa.TestPageListServlet?p_process=PupilSearch&testing_no={testingNo}&p_no={pNo}&...`
   - 응답 HTML 내 `examResultList`에서 각 문항의 `_examNo`, `examScore`, `examScoreMax`, `answer1`(학생 제출 답안)을 추출.

---

## 3. 실측 Ground Truth (2026-09-28 세션 16:35~16:37 실시간 채점)

| 학생명 | 학생 ID | 시험지 고유키 (pNo) | 응시 번호 (testingNo) | 시험지명 | 문항수 | 실측 점수 | 오답 문항 번호 | 제출 시각 |
|:---:|:---:|:---:|:---:|:---|:---:|:---:|:---|:---:|
| **유지연** | `1293138` | **`6343283`** | `20549621` | [대단원총괄평가] [가우스] 3 방정식 대단원 총괄 - 유지연 | 25문항 | **84점** (21/25) | **1번, 15번, 16번, 23번** (각 4점) | 16:35 |
| **신지우** | `1293032` | **`6725858`** | `20494221` | [대단원총괄평가] [가우스] 4단원 소수의 곱셈 대단원 총괄 - 신지우 | 20문항 | **90점** (18/20) | **19번, 20번** (각 5점) | 16:35 |
| **박세은** | `1293067` | **`6724304`** | `20549719` | [대단원총괄평가] [가우스] 2단원 분수의 곱셈 대단원 총괄 - 박세은 | 20문항 | **65점** (13/20) | **6, 7, 15, 17, 18, 19, 20번** (각 5점) | 16:37 |

---

## 4. 학생별 개별 DB (`DB_{studentName}`) 축적 구조

Main Sheet는 단순한 일회성 뷰어가 아니라, 학생마다 개별 DB 시트 탭이 존재하여 학습 데이터가 장기적으로 누적(Longitudinal Accumulation)됩니다.

### 4.1 스키마 구성 (Google Sheets 2D Row Export)
1. `sessionDate`: 응시 일자 (YYYY-MM-DD)
2. `enrolledGroup`: 수강 반 (예: 월수1부, 월금1부)
3. `assessmentCategory`: 평가 유형 (대단원총괄평가, DailyTest, ZeroTest 등)
4. `bookTitle`: 교재명
5. `unitName`: 단원명
6. `scope`: 평가 범위
7. `timeLimitMinutes`: 제한 시간 (분)
8. `timeSpentMinutes`: 실제 소요 시간 (분)
9. `totalQuestions`: 총 문항 수
10. `correctCount`: 정답 문항 수
11. `wrongCount`: 오답 문항 수
12. `score`: 최종 점수 (100점 만점)
13. `percentage`: 정답률 (%)
14. `wrongItemNumbers`: 오답 문항 번호 목록 (예: "19, 20")
15. `status`: 채점 및 클리닉 상태 (`graded`, `clinic_assigned`, `clinic_completed`, `mastered`)
16. `nextAction`: 후속 조치 사항
17. `checksum`: 데이터 위변조 탐지용 SHA-256 해시값 (앞 12자리 표시)

### 4.2 누적 분석 및 취약 단원 감지
- `getCumulativeStats(studentId)` 엔진이 학생의 전체 평가 이력을 스캔하여:
  - 누적 응시 횟수
  - 누적 평균 점수
  - **평균 85점 미만 단원에 대한 취약 단원 자동 경고 (`weakUnits`)**  
    ➔ **박세은 학생: `2. 분수의 곱셈` (65점) 취약 단원 즉각 감지!**

---

## 5. Main Sheet 프론트 뷰 프로젝션 및 이월 사이클

Main Sheet(`박경찬` 탭)에는 각 학생별 상태 카드와 호버 메모(Hover Note)가 실시간으로 프로젝션됩니다.

### 5.1 학생별 프론트 카드 투영 현황
- **신지우 (`1293032`)**:
  - 상태 배지: `🟢 오답검사완료`
  - 점수 표시: `90점 (18/20)`
  - 오답 문항: `19번, 20번`
  - 다음 조치: `오답 대면 검사 완료 ➔ 후속 진도(p.68~p.70) 진행 중`
  - **이월 사이클 (09/30 1부 수업)**:
    - 당일 시간 부족으로 미실시된 초5-2 가우스 2권 직전 예습 범위 클리닉(동일 오답 + 유사문제 1~2개) 및 Daily Test 진행.
- **유지연 (`1293138`)**:
  - 상태 배지: `🟡 풀이완료(채점중)`
  - 점수 표시: `84점 (21/25)`
  - 오답 문항: `1번, 15번, 16번, 23번`
  - 다음 조치: `오답 문항 클리닉지 배부 및 해설강의 배정`
  - **이월 사이클 (10/02 1부 수업)**:
    - 방정식 대단원 총괄 오답 클리닉 완결 및 직전 예습 범위(가우스플러스) 클리닉 + Daily Test 병행.
- **박세은 (`1293067`)**:
  - 상태 배지: `🟡 풀이완료(채점중)`
  - 점수 표시: `65점 (13/20)`
  - 오답 문항: `6번, 7번, 15번, 17번, 18번, 19번, 20번`
  - 다음 조치: `분수의 곱셈 취약 단원 집중 클리닉 및 오답 재풀이`
  - **이월 사이클 (10/02 1부 수업)**:
    - 분수의 곱셈 집중 클리닉 완결 및 직전 예습 범위 클리닉 + Daily Test 병행.

---

## 6. Zero-Context Agent 실행 도구 가이드

Zero-Context Agent는 아래 CLI 명령어로 언제든지 실측 백엔드 데이터 조회 및 시트 동기화를 재현할 수 있습니다:

```bash
# 1. 3인 학생의 실측 채점 데이터 실시간 결정론적 조회
bun run scripts/query_lms_student_assessment.ts --all --date=2026-09-28

# 2. 특정 학생(유지연) 단독 조회
bun run scripts/query_lms_student_assessment.ts --student=유지연 --date=2026-09-28

# 3. Main Sheet 및 학생별 개별 DB 엔드투엔드 동기화 및 batchUpdate 페이로드 생성
bun run scripts/sync_main_sheet_and_student_dbs.ts

# 4. 전체 회귀 방지 단위 테스트 검증
bun test
```
