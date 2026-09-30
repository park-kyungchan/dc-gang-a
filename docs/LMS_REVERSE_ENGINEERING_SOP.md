# LMS 백엔드 결정론적 역공학(Reverse Engineering) 표준 운영 절차서 (SOP)

**대상**: Zero-Context Coding Agents, Pair Programmers, Adversarial Evaluators  
**목적**: 신규 또는 미확인 LMS 페이지/엔드포인트 조우 시, 환각 없이 안전하게 백엔드 통신 계약(Contract)을 규명하고 레지스트리에 편입하는 4단계 절차.

---

## 1. 역공학 기본 원칙 (Invariants)

1. **Pure Read-Only 불변 원칙**:
   - `p_process`에 `delete`, `reg`, `update`, `insert` 등이 포함된 엔드포인트는 절대 호출하지 않습니다.
   - 조판(`Typeset`) 엔드포인트는 읽기 전용 생성(`createResultPaper`)으로만 호출하며 변이 플래그를 넘기지 않습니다.
2. **인메모리 세션 격리**:
   - 세션 쿠키(`JSESSIONID`)는 환경변수 `$env:SESSION_COOKIE`로 메모리에만 올리며, 스크립트 파일, 리포트, Git 커밋에 절대 남기지 않습니다.
3. **단일 진실 원천(SSOT) 편입 의무**:
   - 역공학으로 밝혀낸 새 엔드포인트는 즉시 `src/lms/lmsRouteRegistry.ts` 및 `docs/LMS_FULL_ROUTE_TREE_MAP.md`에 등록하여 후속 에이전트가 재활용할 수 있게 합니다.

---

## 2. 4단계 역공학 표준 절차 (Step-by-Step SOP)

```
┌──────────────────────────────────────────────────────────┐
│ Step 1. 타겟 페이지 스캔 및 정적 분석 (Static Analysis)  │
│ ➔ scripts/lms_reverse_engineer.ts 실행                   │
│ ➔ 외부 JS 번들 및 서블릿 엔드포인트 목록 수집           │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│ Step 2. 자바스크립트 호출 체인 역공학 (Call Chain Trace)│
│ ➔ 클릭 이벤트 핸들러 (externOn*, onPopup*) 역추적        │
│ ➔ ajax 요청 페이로드 (p_process, condition) 구조 확정    │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│ Step 3. LmsRouteRegistry 화이트리스트 및 파라미터 등록   │
│ ➔ src/lms/lmsRouteRegistry.ts 에 RouteDefinition 추가    │
│ ➔ READ_ONLY / TYPESET_READ 영향도 엄격 지정              │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│ Step 4. 단위 테스트 작성 및 실측 검증 (Test-Verified)    │
│ ➔ tests/lms/ 에 파싱 및 계약 검증 테스트 추가            │
│ ➔ bun test 100% 통과 확인                                │
└──────────────────────────────────────────────────────────┘
```

### [Step 1] 정적 스캔 실행
```bash
# 타겟 서블릿의 전체 스크립트 및 통신 라우트 분석
bun run scripts/lms_reverse_engineer.ts
```
- 결과 산출물: `docs/LMS_REVERSE_ENGINEERING_REPORT.json`에 엔드포인트 후보군 자동 저장.

### [Step 2] 자바스크립트 파라미터 규명
- 페이지 내 HTML 소스 및 `/jsutil/module.js` 등에서 해당 기능의 함수 선언을 grep합니다.
- 예: `externOnOneClinicButtonClick` ➔ `MODULE.Typeset.createResultPaper` ➔ `/servlet/controller.common.TestpageSelectExServlet` 호출 체인 도출.

### [Step 3] `src/lms/lmsRouteRegistry.ts` 등록
```typescript
[
  'NEW_DISCOVERED_ROUTE',
  {
    routeId: 'NEW_DISCOVERED_ROUTE',
    category: 'FAIndex',
    servletPath: '/servlet/controller....',
    processName: 'getSomething',
    httpMethod: 'POST',
    effect: 'READ_ONLY',
    description: '역공학으로 규명된 상세 설명',
    requiredParams: ['clg_no', 'condition'],
    optionalParams: [],
    responseFormat: 'JSON'
  }
]
```

### [Step 4] 단위 테스트 및 커밋
- `tests/lms/`에 신규 엔드포인트 파라미터 유효성 검사 테스트를 추가하고 `bun test` 통과 확인.
