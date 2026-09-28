# 강의하는아이들 대치점 시스템 아키텍처 명세서

## 1. 개요 및 인프라 구조
강의하는아이들 대치점(`dc.gang-a.kr`)의 웹 시스템과 모바일 앱(학생/학부모/교사용 패드 및 앱)은 중앙 집중식 Java EE Servlet 백엔드 및 통합 RDBMS를 공유하는 멀티 클라이언트 구조로 운영됩니다.

```mermaid
flowchart TD
    WebBrowser["PC 웹 브라우저<br/>(선생님/관리자)"] -->|HTTPS (JSESSIONID)| Gateway["dc.gang-a.kr / studyq.net<br/>Java EE Servlet Container"]
    MobileApp["모바일 앱 / 태블릿 패드<br/>(otmathon://, WebSocket)"] -->|Native / API| Gateway
    
    Gateway --> AuthLayer["인증/세션 레이어<br/>(fran_no, pri_no, mem_type)"]
    AuthLayer --> TutorController["controller.tutor.*<br/>TutorMenuIndexServlet"]
    AuthLayer --> CommonController["controller.common.*<br/>PqatServlet, RegAppServlet"]
    
    TutorController --> CoreDB[("공통 통합 데이터베이스<br/>(StudyQ Core DB)")]
    CommonController --> CoreDB

    subgraph DB_Entities ["핵심 데이터 엔티티"]
        CoreDB --- Users["사용자 / 원생 테이블<br/>(stud_no, pri_no)"]
        CoreDB --- Classes["반 / 클래스 편성 테이블<br/>(cls_no, g_chn_no=1680)"]
        CoreDB --- ExamPool["시험지 / 문제은행 Pool<br/>(test_page, ass_no)"]
        CoreDB --- Records["응시 결과 / 하브루타 진단<br/>(marks_result, diag_result)"]
    end
```

---

## 2. 대치점 고유 메타데이터 식별자
* **가맹점 번호 (fran_no / g_chn_no)**: `1680` (강의하는아이들 대치점)
* **학교/학원 고유 식별키 (G_SCHOOL_KEY)**: `14581`
* **교사 고유 식별키 (G_USER_KEY / pri_no)**: `1292923` (박경찬 선생님)
* **회원 권한 타입 (MEMBERTYPE / mem_type)**: `1` (튜터/교사 권한)
* **학원 가입 코드**: `8511`
* **모바일 커스텀 스킴**: `otmathon://`, `studyurlscm://`

---

## 3. 웹-앱 데이터 동기화 및 공통 DB 작동 원리
1. **Multiple clients:** The web and mobile clients expose related academy workflows. The exact deployed database relations and app-to-teacher-site joins require selected-student verification; this diagram is a dated structural hypothesis.
2. **Teacher-site views:** Course, assessment, and user-management page shells have been observed. Their availability does not prove real-time synchronization, complete rows, or a particular student's app submission or grading state.
3. **Current read path:** The saved-session Python harness was retired on 2026-09-27. Use the logged-in Codex in-app Browser for source-reviewed, bounded UI reads. Classify each operation by effect: some `GET` requests mutate, while some `POST` requests only render a view. No HTTP method or page shell alone guarantees read-only behavior.
