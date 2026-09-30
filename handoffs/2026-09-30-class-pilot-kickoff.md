# 2026-09-30 Main Sheet classroom pilot: new-session kickoff

Paste the following into a new agent session opened at
`C:\Users\dcgan\OneDrive\Desktop\dc-gang-a`.

> 2026-09-30 수업 준비와 실제 사용 검증을 시작하자. 이번 세션에서는 내가 요청하는 조회·기록·수업 판단을 수행하면서, 그동안 만든 Main Sheet/하네스가 실제 실무에 맞는지도 계속 적대적으로 검증하고 발견한 결함은 로컬 코드·합성 시안에 수정해라. 먼저 `AGENTS.md`, `docs/CODEX_CONTEXT.md`, `docs/WHOLE_LENS_DECISION.md`, `handoffs/2026-09-29-main-sheet-harness.md`, `review/main_sheet_v3_architecture.md`, `review/main_sheet_backlog.md`, `.agents/skills/park-main-sheet/SKILL.md`를 읽고, 현재 날짜·Git 작업 상태와 학원 백엔드 상태를 재확인해라. Google Sheets 편집에는 연결된 전용 스킬/도구를 써라. 기존 dirty work를 보존해라.
>
> 학원 백엔드를 학생·반·수업 회차·교재·앱 채점의 SSoT로 삼아라. 신원과 경로는 `bun run harness roster/routes` 또는 `python -B harness/cli.py roster/routes`로만 찾고, 필요한 사실은 먼저 `python -B harness/academy.py plan --fact ... --student-id ... --date ...`로 라우팅해라. `blocked`를 빈 데이터나 완료로 해석하지 마라. 이미 허용된 범위의 검증된 read-only 계약만 사용하고, 세션 값은 새 세션에서 필요할 때 일시적으로 받아 메모리에서만 사용해라. 쿠키 자동 추출, raw dump, 무관한 학생 데이터 수집을 하지 마라.
>
> 14시 준비는 해당 날짜의 **전체 수업 대상 학생**을 먼저 확인한 뒤 학생별 직전 실제 수업·숙제, 예습 업로드, 앱 풀이·채점, 1차 오답, 별표 문항, 교사 확인을 점검하는 순서다. 이루한(`1294174`, 수금2부)의 9월 30일 페이지 감사가 첫 파일럿이다. 9월 23일 출석·숙제가 관찰되었지만 9월 25일 기록은 미확정이며, 직전 회차·교재 판본·쪽 범위의 정확한 연결은 다시 증명해야 한다. 내 날짜·교재 설명이 DB와 충돌하면 즉시 알려줘. 추석 휴강이나 10월 연휴처럼 취소·보강이 끼면 검증된 실제 다음 수업으로 연결해라.
>
> 내가 수업 중 학생·교재·페이지·문항별 관찰을 말하면 원문과 시각을 먼저 학생·회차에 묶어 보존하고, 모호한 연결은 질문해라. `직접 검사 완료`는 오답 수정까지 내가 확인한 경우에만 쓴다. 학생 완료 주장, 미완료, 확인 불가, 부분 진행을 구분해라. 강의영상을 봐도 모르는 별표 문항은 수업 중 처리한 뒤 해결 확인·추가 설명·다음 수업 이월 중 내가 선택하도록 해라. 학생 개인별 DB의 실제 저장 경로가 아직 연결되지 않았으면 저장했다고 주장하지 말고, 정확한 대상·원문·이전/이후 값·복구법을 갖춘 실행 가능한 기록안을 준비해라.
>
> 숙제는 14시 예상안과 반별 수업 종료 직전 최종안을 분리해라. 가우스 주 3~4소단원, 부교재 주 약 2소단원을 다음 실제 등원일까지의 날짜에 비례시킨 기준으로 삼되, 학생별 미완료 페이지와 축적된 수행 이력을 반영한 **검토용 범위**만 제안해라. 정답률 가중치는 앱의 정확한 학생·시도·채점 연결과 내 학생별 인터뷰 전에는 적용하지 말고, 소요시간은 사용하지 마라. 숙제 확정은 내가 고른 교재·쪽·문항을 Main Sheet에 기록한 때이고, LMS DayRecord 저장은 별도 검토·승인·동일 대상 재조회가 필요하다.
>
> 퇴근 전 정리는 언제든 열 수 있어야 한다. 마지막 반 종료와 보통 21:30~22:00에 모든 학생의 미정리 원문·별표·오답·페이지 검사 목록을 다시 보여줘. 기존 구현은 합성 모델과 청록색 A 시안까지이며 운영 시트 입력기·14시 자동 갱신·알림 서비스는 아직 배포되지 않았다. 학원 소유 시트 또는 LMS를 변경하기 전에는 `AGENTS.md`의 정확한 대상·이전/이후·복구·승인 절차를 지켜라. 운영 시트를 바꾸기 전까지는 합성 시안에서 검증하고, 실제 반응·실패·수정 사항을 날짜별로 남겨라.
>
> 시작할 때 핵심 게이트 `python -B -m unittest discover -s workbench_v2/tests -q`, `python -B -m unittest harness.tests.test_academy -q`, `bun test tests/assessment/carryForwardQueue.test.ts`를 확인하고, 내가 요청하는 실제 작업을 따라가며 실패나 잘못된 가정을 고쳐라. 과거 `tests/rubrics/verify_main_sheet_rubric.ts`는 합성 점수 기대값이 현재 fixture와 달라 실패하므로 운영 합격 근거로 쓰지 마라. 필요한 확인 질문은 실제 결정에 영향을 주는 것만 간결하게 해라.

Current synthetic design: `시안 A · 청록 강조` in
https://docs.google.com/spreadsheets/d/1wWCMWHbR_aEP4J3lXFkbKz8twaVhqjkrEcUFCzQpVw4/edit .
The operating workbook is `대치강아 학생진도현황`, `박경찬` tab; it was not edited
during the 2026-09-29 preparation.
