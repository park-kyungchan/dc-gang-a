# LMS 백엔드 7대 메뉴 전체 라우트 트리 맵 (Full Route Tree Map)

**대상 사이트**: 강의하는 아이들 (`https://dc.gang-a.kr`)  
**문서 상태**: 검증 완료 (Production Ready, Read-Only Enforced)  
**주 언어 스택**: TypeScript (`src/lms/lmsRouteRegistry.ts`)

---

## 1. 7대 메뉴 인덱스 및 상위 구조

LMS 사이트는 상단 메뉴에서 `TutorMenuIndexServlet?p_process={MenuIndex}`를 통해 각 관리 영역으로 진입합니다:

| 인덱스 프로세스 (`p_process`) | 메뉴명 | 주요 역할 | 주요 하위 서블릿 |
|:---|:---:|:---|:---|
| **`FAIndex`** | **형성평가** | 대단원 총괄평가, 단원평가, **오답/유사문제 클리닉 조판** | `TestPageListServlet`, `TestpageSelectExServlet` |
| **`NAIndex`** | **수시평가** | Daily Test, Zero Test, 단원별 수시평가 출제 및 채점 | `na.TestPageListServlet` |
| **`DAIndex`** | **학력인증평가** | 진단평가, 학력인증 시험지 목록 및 응시 결과 | `diag.DiagnostManageServlet` |
| **`TestPoolIndex`** | **문제지제작** | 단원별 문항 검색 및 신규 커스텀 시험지 자동 생성 | `TestPoolIndex2` |
| **`CourseMainIndex`** | **학습관리** | 학습일지 작성, 학생별 출결/과제 상태 관리 | `CourseMainIndex` |
| **`CourseManageIndex`** | **수업관리** | 강의실 배정, 강좌 시간표, 시간별 수업 일정 | `CourseManageIndex` |
| **`BaseManageIndex`** | **사용자관리** | 원생 검색, 학생 승인 및 반편성, 학습 패드(태블릿) 인증 | `UserSearchServlet`, `UserClsManageServlet` |

---

## 2. 세부 서블릿 엔드포인트 및 스키마 명세

### 2.1 형성평가 (`FAIndex`) — 핵심 평가 및 클리닉 영역

#### 1) 학생별 시험지 목록 및 총점 조회
- **Route ID**: `FA_USER_SEARCH_RESULT`
- **Method / URL**: `POST /servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=1001`
- **필수 Form 파라미터**:
  - `clg_no`: 학원 지점 번호 (대치: `14581`)
  - `cls_no`: 반 번호 (전체: `0`)
  - `stu_name`: 학생 이름 (예: `유지연`)
  - `sort_date1`: 검색 시작일 (YYYY-MM-DD)
  - `sort_date2`: 검색 종료일 (YYYY-MM-DD)
  - `checkAllPage`: `'Y'`
- **반환 데이터**: HTML 내 `EXTERN_DIALOG = { testResultList: JSON.parse(...) }`
  - `pNo`: 시험지 고유 식별자 (1급 시민)
  - `testingNo`: 응시 고유번호
  - `score`: 최종 점수
  - `oQuestions`: 총 문항 수
  - `applyDate`: 제출 일시 (예: `09-28 16:35`)

#### 2) 문항별 O/X 및 학생 답안 상세 조회
- **Route ID**: `FA_PUPIL_SEARCH`
- **Method / URL**: `GET /servlet/controller.tutor.fa.TestPageListServlet?p_process=PupilSearch`
- **필수 Query 파라미터**:
  - `testing_no`: 응시 번호
  - `p_no`: 시험지 번호
  - `o_questions`: 문항 수
- **반환 데이터**: HTML 내 `examResultList` JSON
  - `_examNo`: 문항 번호 (1-indexed)
  - `examScore`: 획득 점수
  - `examScoreMax`: 배점
  - `answer1`: 학생 제출 답안

#### 3) 오답 클리닉 및 유사문제 조판 엔진 ★
- **Route ID**: `TYPESET_STUDY_RESULT_SINGLE`
- **Method / URL**: `POST /servlet/controller.common.TestpageSelectExServlet`
- **Form 파라미터**:
  - `p_process`: `"getStudyResultSingleTestingSingleUser"`
  - `condition`: JSON 문자열
    ```json
    {
      "testing_no": 20549621,
      "pri_no": 1293138,
      "student_name": "유지연",
      "score": { "create": 0 },
      "incorrect": { "create": 1 },
      "similar": { "create": 1, "mode": 1, "exam_cnt": 1 },
      "advance": { "create": 0 },
      "report": { "create": 0 }
    }
    ```
- **반환 데이터**: `JSON`
  - `print_list[0]`: **단원평가 [오답 클리닉]** (학생이 틀렸던 원문항 번호, 유형명 `pat_name`, 난이도, `lecture_key`)
  - `print_list[1]`: **단원평가 [유사 클리닉]** (오답 유형과 매핑된 유사문제, `pat_name`, 난이도, 유사문제 `lecture_key`)

---

### 2.2 수시평가 (`NAIndex`) — Daily Test / Zero Test

#### 1) Daily Test / Zero Test 응시 결과 조회
- **Route ID**: `NA_USER_SEARCH_RESULT`
- **Method / URL**: `POST /servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=1002`
- **Form 파라미터**: `clg_no`, `stu_name`, `sort_date1`, `sort_date2`
- **반환 데이터**: `EXTERN_DIALOG_HTML`

#### 2) Daily Test 문항별 상세 채점 조회
- **Route ID**: `NA_PUPIL_SEARCH`
- **Method / URL**: `GET /servlet/controller.tutor.na.TestPageListServlet?p_process=PupilSearch`
- **Query 파라미터**: `testing_no`, `p_no`, `test_no`

---

### 2.3 사용자관리 (`BaseManageIndex`)

#### 1) 사용자(원생) 검색
- **Route ID**: `BASE_USER_SEARCH`
- **Method / URL**: `GET /servlet/controller.tutor.base.UserSearchServlet?p_process=Main`
- **용도**: 학생 식별키(`stu_pri_no`), 학년, 등록 상태 조회

#### 2) 학습패드(태블릿) 관리
- **Route ID**: `BASE_PAD_CERTIFICATE`
- **Method / URL**: `GET /servlet/controller.tutor.base.UserSearchServlet?p_process=GetCertificateMain`
- **용도**: 원내 비치용 태블릿(Galaxy Tab 등) 인증 기기 일치 여부 확인

---

## 3. Zero-Context Agent 호출 가이드 (TypeScript)

에이전트는 `LmsRouteRegistry`를 활용하여 안전하게 요청을 생성하고 파싱합니다:

```typescript
import { LmsRouteRegistry } from '../src/lms/lmsRouteRegistry';

// 1. 요청 생성 (안전 가드 자동 적용)
const req = LmsRouteRegistry.buildRequest('FA_USER_SEARCH_RESULT', {
  clg_no: '14581',
  cls_no: 0,
  stu_name: '유지연',
  sort_date1: '2026-09-14',
  sort_date2: '2026-09-28'
});

// 2. Fetch 실행 (쿠키는 메모리에서만 주입)
const res = await fetch(req.url, {
  method: req.method,
  headers: { ...req.headers, Cookie: `JSESSIONID=${sessionCookie}` },
  body: req.body
});
```
