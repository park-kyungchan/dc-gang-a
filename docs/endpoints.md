# 강의하는아이들 대치점 READ-ONLY 엔드포인트 명세서

본 문서는 실측 및 검증 완료된 `https://dc.gang-a.kr`의 읽기 전용(GET) 서블릿 엔드포인트 목록입니다.

---

## 1. 튜터 메인 메뉴 및 포털 인덱스
호출 기본 경로: `/servlet/controller.tutor.TutorMenuIndexServlet`

| 기능 명칭 | `p_process` 파라미터 값 | 설명 |
| :--- | :--- | :--- |
| **사용자관리 인덱스** | `BaseManageIndex` | 원생 명단 검색, 반 편성, 학습패드 관리 허브 |
| **학력인증평가 (DA)** | `DAIndex` | 학력인증평가 출제 및 응시 결과 통계 |
| **형성평가 (FA)** | `FAIndex` | 단원별/개념별 형성평가 결과 및 오답 관리 |
| **수시평가 (NA)** | `NAIndex` | 주간/수시 테스트 결과 집계 |
| **문제지제작 Pool** | `TestPoolIndex` | 문항 데이터베이스 및 출제 시험지 풀 |
| **학습관리 메인** | `CourseMainIndex` | 학생별 진도율, 플립러닝 영상 시청률 |
| **수업관리 메인** | `CourseManageIndex`| 일자별/클래스별 수업 일정 및 출석 현황 |
| **커뮤니티/고객센터** | `CommunityMainIndex` | 공지사항 및 학원 운영 게시판 |

---

## 2. 사용자 및 반 편성 서블릿

### 사용자 검색 / 학생 상세
* **서블릿 경로**: `/servlet/controller.tutor.base.UserSearchServlet`
* **주요 파라미터**:
  * `p_process=Main`: 학생 검색 메인 화면
  * `p_process=GetCertificateMain`: 학습이수증 발급 내역

### 학생 승인 및 반편성
* **서블릿 경로**: `/servlet/controller.tutor.base.UserClsManageServlet`
* **주요 파라미터**:
  * `p_process=Main`: 현재 등록된 반(Class) 목록 및 소속 학생 리스트

---

## 3. 평가 및 시험지 결과 서블릿

### 학력인증평가(DA) 결과 서블릿
* `/servlet/controller.tutor.da.TestPageListGrpServlet?p_process=Main` (시험지 그룹 목록)
* `/servlet/controller.tutor.da.TestPageListServlet` (회차별 시험 결과)
* `/servlet/controller.tutor.da.MarksResultDigestServlet?p_process=Main` (기간별 응시결과 요약)
* `/servlet/controller.tutor.base.TestPageListServlet?p_process=UserByMain&ass_no=1000` (학생별 시험지 및 채점 결과)

### 진단평가(Diagnostic) 서블릿
* `/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestPaperList` (진단평가 시험지 목록)
* `/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestResultList` (진단평가 채점 결과)

---

## 4. 모바일 앱 / 공통 서블릿
* `/servlet/controller.common.TestpageSelectExServlet`: 문항/시험지 선택 모듈
* `/servlet/controller.common.TestPageShowExServlet?p_process=GetLectureList&lecture_list={key1,key2}`: 문항 번호(lecture_key)로 문제 메타데이터(단원, 유형, 정답 `answer`, 난이도 `difficulty`, 풀이시간 등) JSON 일괄 조회
* `/servlet/controller.first.RegAppServlet`: 앱 등록 및 세션 상태 동기화
* `/servlet/controller.first.RegAppCommandServlet?reqCmd=getVideoLecture&lecture_key={key}`: 문항/강의 동영상 URL 조회
* `/servlet/controller.orientation.OrientationServlet?reqCmd=viewOnlyOTVideo&pri_no=1292923`: 오리엔테이션 영상 조회

---

## 5. 문제은행(StudyQ) 스토리지 자원 경로 규칙
* **기본 스토리지**: `https://storage.studyq.net`
* **문항 이미지 경로 생성 공식** (`key = lecture_key`):
  * `d6 = "d6-" + ("000" + Math.floor(key / 1000000)).slice(-3)`
  * `d4 = "d4-" + ("00" + Math.floor((key % 1000000) / 10000)).slice(-2)`
  * `d2 = "d2-" + ("00" + Math.floor((key % 10000) / 100)).slice(-2)`
  * `path = "/data/contents/exam/" + d6 + "/" + d4 + "/" + d2 + "/ek-" + key`
* **주요 이미지 리소스**:
  * 객관식 문항: `{path}/{key}-obj-exam.png`
  * 주관식 문항: `{path}/{key}-sbj-exam.png`
  * 서술형 문항: `{path}/{key}-des-exam.png`
  * 카드 썸네일: `{path}/{key}-examcard-obj.png`

