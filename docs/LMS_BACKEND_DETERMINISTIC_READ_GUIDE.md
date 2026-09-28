# 학원 LMS 백엔드 결정론적 Read-Only 연동 및 키 조인 마스터 가이드
**LMS Backend Deterministic Read & Key-Join Architecture Guide for Zero-Context Agents**

- **작성 일자**: 2026-09-28
- **대상 독자**: 대화 컨텍스트가 초기화되었거나 사전 지식이 없는 신규 AI 코딩 에이전트(Zero-Context Agent), 서브에이전트, 타 머신 적대적 평가관(Adversarial Auditor)
- **적용 범위**: 학원 LMS 백엔드(JSP 서블릿), 학원 태블릿/스마트폰 앱 채점 데이터, 구글 스프레드시트(Main Sheet) 연동

---

## 1. 개요 및 이것이 왜 절대적으로 중요한가? (Why This Is Critical)

### [배경 및 핵심 교훈: 유지연 학생 사례]
2026-09-28 세션에서 에이전트가 교재 범위(`가우스 1-1 p.176~p.179`)만 보고 임의로 "95점 (19/20), 12번 오답"이라는 가상 채점 데이터를 생성하여 보고했을 때, 현장 강사님께서 즉시 지적하셨습니다:
> *"잘못 읽은 것 같은데? 유지연 학생은 pNo:6343283 인데, 잘못 읽은 것 아니야?"*

이 사건은 학원 도메인에서 **"결정론적 백엔드 읽기 계약과 키 조인 체계"**가 부재할 때 어떤 치명적 문제가 발생하는지 명확히 보여줍니다:
1. **임의 데이터 위조(Hallucination & Fabrication)의 현장 파괴력**:
   - 학원에서 시험 채점 결과는 단순 숫자가 아닙니다. 오답 클리닉지 인쇄, 유사문제 자동 출제, 풀이노트 작성 지도, 학부모 일일 알림톡, 학생별 맞춤 학습 진도로 직결됩니다.
   - 실제 시험지 번호(`pNo`)와 문항 메타데이터(`lecture_key`) 없이 만들어진 가짜 점수는 학생의 실제 취약점을 가리고 강사와 학부모의 신뢰를 무너뜨립니다.
2. **Zero-Context Agent의 재현성 (Deterministic Reproducibility)**:
   - LLM 에이전트는 컨텍스트 축약(Truncation)이나 새 세션 시작 시 사전 기억이 완전히 소멸합니다.
   - 이때 코드베이스 내에 "어디에 어떤 데이터가 있고, 어떤 식별자로 읽어야 하는가?"가 **단일 진실 원천(Single Source of Truth)**으로 고정되어 있지 않으면, 에이전트마다 서로 다른 추측(Guesswork)을 남발하게 됩니다.
3. **LMS 시스템 안전성 (Read-Only Safety Invariant)**:
   - 학원 백엔드는 레거시 서블릿 구조로, GET 파라미터 하나로도 서버 상태가 변이(Mutation)되거나 세션이 만료될 위험이 있습니다.
   - 검증된 안전한 Read-Only 엔드포인트만 화이트리스트화하여 멱등성(Idempotency)을 보장해야 합니다.

---

## 2. 5-Tier 백엔드 핵심 키 조인 스파인 (The 5-Tier Join Spine)

학원 백엔드 DB와 앱 채점 데이터는 다음 5가지 식별자로 엄격히 연결됩니다. 단순 학생 이름이나 교재명으로 조인해서는 안 됩니다:

| 계층 | 키 식별자 | 설명 및 실제 예시 | 주요 용도 및 바인딩 위치 |
| :--- | :--- | :--- | :--- |
| **Tier 1** | `stu_pri_no`<br>(`studentId`) | **학생 고유 식별자**<br>• 신지우: `1293032`<br>• 박세은: `1293067`<br>• 유지연: `1293138` | 학생 개별 DB (`DB_{학생명}`), 출결 그리드, 일지 레코드 매핑 |
| **Tier 2** | `course_seq`<br>`cm_seq` | **수강 과정 및 반 배정 키**<br>• 신지우: `course_seq: 4`, `cm_seq: 82150`<br>• 박세은: `course_seq: 4`, `cm_seq: 82151`<br>• 유지연: `course_seq: 5`, `cm_seq: 82168` | 과정별 진도, 교재 권수, 예습 영상 업로드 현황 조회 |
| **Tier 3** | **`p_no` / `pNo`**<br>**(★ 1급 시민)** | **LMS 시험지 고유 번호**<br>• 유지연(가우스 1-1 총괄): **`6343283`**<br>• 신지우(가우스 5-2 총괄): `6343110`<br>• 박세은(가우스 5-2 총괄): `6343188` | 시험지 문항 수, 배점, 정답, 총 제한시간 메타데이터의 단일 원천 |
| **Tier 4** | `testing_no`<br>(`attemptId`) | **학생 시험 응시 회차 고유 번호**<br>• 예: `att_20260928_6343283_1293138` | 학생이 학원 앱/태블릿에서 입력하여 제출한 특정 시험 회차 세션 |
| **Tier 5** | `lecture_key` | **문항별 고유 해설강의/콘텐츠 키**<br>• 예: `LEC_G7_1_CH2_P178_Q12` | 오답 문제 해설 강의 매핑, 유사 문제(Clinic) 자동 추출 |

---

## 3. 코드베이스 내 구현 위치 및 아키텍처 지도

Zero-context 에이전트는 아래 파일 경로를 통해 결정론적으로 데이터를 조회하고 처리해야 합니다:

```text
src/
  ├── lms/
  │    ├── lmsBackendContracts.ts         # [계약] 엔드포인트 화이트리스트, 시험지/응시/예습영상 타입 정의
  │    └── lmsDeterministicReadRepository.ts # [저장소] pNo 기반 시험지 조회, 응시 결과 검증, 팩트 쿼리
  ├── assessment/
  │    ├── testPaperAdapter.ts             # [어댑터] LMS 응시 결과 ➔ 학생 원장(Ledger) 안전 변환
  │    ├── studentAssessmentLedger.ts      # [원장] 학생별 DB (DB_{학생명}) 누적, SHA-256 무결성 검증
  │    ├── appGradingReader.ts             # [리더] 학원 앱 실시간 채점 입력 정규화
  │    └── carryForwardQueue.ts            # [큐] 미완료 클리닉 및 DT 차기 수업 이월 엔진
  └── sheets/
       └── mainSheetAssessmentProjector.ts # [프로젝터] Main Sheet 뱃지 및 멀티라인 호버 메모 생성
workbench_v2/
  └── lms_read_adapter.py                  # Python 표준 라이브러리 기반 LMS DayRecord/Course 읽기 어댑터
research/backend-map/
  ├── README.md                            # 백엔드 연구 맵 및 조사 원칙
  ├── route-registry.json                  # 52개 LMS 엔드포인트 상세 명세
  └── learning-assessment.md               # 평가/시험지/앱 서블릿 상세 분석
```

---

## 4. 데이터 소스 및 검증 상태 불변식 (Anti-Hallucination Invariants)

모든 시험 및 평가 데이터는 다음 4가지 검증 상태(`VerificationStatus`) 중 하나를 반드시 명시해야 합니다:

1. **`verified_live`**:
   - 라이브 LMS 백엔드 세션 또는 학원 앱 실제 API로부터 직접 수신한 데이터.
2. **`verified_snapshot`**:
   - 강사님이 직접 입력/확인하였거나 무결성이 증명된 로컬 불변 스냅샷.
3. **`pending_verification`**:
   - 학생이 앱으로 시험을 제출했으나(제출 확인됨), 구체적인 채점 결과(점수, 오답 문항)가 아직 강사/백엔드로부터 검증되지 않은 상태.
   - **불변 규칙**: **`score: null`**, **`correctCount: null`**, **`isVerifiedLive: false`**로 표기되어야 하며, 절대로 가짜 점수를 표기해서는 안 됨.
4. **`unverified_synthetic`**:
   - 오프라인 단위 테스트용 가상 픽스처. 프로덕션 시트나 강사 보고에 노출 엄금.

---

## 5. Zero-Context Agent 작업 프로토콜 (Checklist)

새로운 에이전트가 학생 평가나 백엔드 데이터를 다룰 때 준수해야 하는 행동 수칙:

1. **[Step 1: pNo 확인]**
   - 학생의 시험 결과를 다룰 때 반드시 시험지 고유 번호(`pNo`)를 먼저 확인한다.
   - `repository.getTestPaper(pNo)`를 호출하여 해당 시험지가 등록되어 있는지 검증한다.
2. **[Step 2: 실측 여부 확인]**
   - 실측 데이터가 없으면 솔직하게 `pending_verification` 상태로 표시하고, 강사님께 점수/오답 문항 확인을 요청한다.
   - 절대로 교재 페이지만으로 점수를 지어내지 않는다.
3. **[Step 3: 조인 무결성 확인]**
   - `attempt.pNo === paper.pNo` 일치 여부를 `TestPaperAdapter`로 검증한다.
4. **[Step 4: 암호학적 체크섬 보존]**
   - 데이터 변경 시 SHA-256 체크섬을 재계산하여 위변조를 방지한다.
