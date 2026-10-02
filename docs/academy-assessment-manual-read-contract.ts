export interface ManualAssessmentReadContract {
  schemaVersion: 1;
  kind: 'scoped_manual_assessment_read_contract';
  status: 'bounded_live_canary_verified_not_full_p2_acceptance';
  origin: 'https://dc.gang-a.kr';
  admission: { mode: 'current_teacher_scope_and_score_view'; maximumTargets: 2; unattended: false };
  operations: readonly { method: 'POST'; path: string; commandField: 'reqCmd' | 'p_process'; command: string;
    bodyFields: readonly string[]; semanticEffect: 'result_search' | 'existing_score_rendering' }[];
  renderingFlags: { score: 1; incorrect: 0; similar: 0; advance: 0; report: 0 };
  implementation: readonly string[];
  runbook: readonly string[];
  verification: { focused: string; portable: string; live: string; independentReview: 'not_dispatched' };
  limits: readonly string[];
  recovery: readonly string[];
}

/** Source contract and minimized canary evidence only. No student payload or authentication belongs here. */
export const manualAssessmentReadContract = {
  schemaVersion: 1,
  kind: 'scoped_manual_assessment_read_contract',
  status: 'bounded_live_canary_verified_not_full_p2_acceptance',
  origin: 'https://dc.gang-a.kr',
  admission: { mode: 'current_teacher_scope_and_score_view', maximumTargets: 2, unattended: false },
  operations: [
    { method: 'POST', path: '/servlet/controller.dailyzerotest.DailyZeroTestServlet', commandField: 'reqCmd',
      command: 'DtResultSearch', bodyFields: ['sort_date', 'stu_name'], semanticEffect: 'result_search' },
    { method: 'POST', path: '/servlet/controller.common.TestpageSelectExServlet', commandField: 'p_process',
      command: 'getStudyResultSingleTestingSingleUser', bodyFields: ['p_process', 'condition'], semanticEffect: 'existing_score_rendering' },
  ],
  renderingFlags: { score: 1, incorrect: 0, similar: 0, advance: 0, report: 0 },
  implementation: ['src/lms/assessmentReadProtocol.ts', 'harness/assessment_read.ts'],
  runbook: [
    'Use current task admission and user-supplied captures or an independently verified exact target. Raw HAR remains private; never load headers/cookies into output, copy captured requests or commit real student evidence.',
    'Run bun run academy:read-prepare --har <PRIVATE_CAPTURE.har> [--har <SECOND_PRIVATE_CAPTURE.har>] --teacher <AUTHORIZED_TEACHER_LABEL> --admit-score-view --output <ACTIVE_HERMES_HOME>/cache/scratch/<UNIQUE_SCRIPT.js>. The CLI performs no network requests and refuses overwriting an existing script.',
    'The generated script contains minimized private student/attempt identity. It is an ephemeral native-browser input, not a public artifact, shared database or admission token. Keep it in profile scratch with owner-only permissions.',
    'Open the exact academy origin through native browser_exec. On the login form call browser_vault_list, type the identifier, then browser_vault_fill. Use the site .webSend handler, not generic form submission. Wait until the authorized teacher/logout marker actually renders; use native code entry for 2FA if requested.',
    'Evaluate the owned prepared expression with native js immediately after authentication; this sends allowlisted same-origin POSTs using browser-managed credentials and never extracts or exports cookies. Print only minimized requested facts and blocked states, never keys, original bodies, answers or media.',
    'The adapter searches recent one week (sort_date=1), requires one exact student+attempt+name match and reads only that score view. It never invokes the site native Print/WebSocket command, a clinic/report renderer, grade save or messaging action.',
    'Numeric JSON student/attempt wire keys are required by the observed renderer. The adapter rejects noncanonical, leading-zero or unsafe keys instead of silently changing identity. Search/detail score disagreement, duplicate items or unknown O/X enums fail closed.',
    'Reuse prepareAssessmentRead/readAssessmentBatch for admitted continuations. No new HAR is inherently required for every read when a protected verified identity source is available; such a source is not installed by this change.',
  ],
  verification: {
    focused: 'bun run test:assessment-read', portable: 'bun run cloud:check',
    live: 'Two exact user-supplied attempts were independently searched and rendered through the current authenticated server. Both result scores and item totals agreed with captured source and teacher reports. No real values are included in this contract.',
    independentReview: 'not_dispatched',
  },
  limits: [
    'Manual native-browser acquisition is activated; browser-independent unattended authentication, services, scheduled refresh and production storage are not established.',
    'Hermes browser inactivity cleanup can remove authentication between engineering steps. Official documentation reports a default 120-second inactivity timeout. Do not disable cleanup, change installed engine/configuration or keep sessions alive by polling as a workaround; securely reauthenticate on demand.',
    'Teacher visibility and caller admission fields are integration guards, not cryptographic ownership proofs, server tenant isolation or authority to query another instructor. The trusted native caller owns actual task scope.',
    'The search period is a relative week, not a lesson date. Source grading timestamp, exact LMS occurrence, complete roster/pagination and full classroom-cycle coverage remain unverified. observedAt is acquisition time, not event or approval time.',
    'The score-view response echoes student identity, not attempt identity. Its attempt provenance comes from the exact current search match and request selector, not an independently echoed detail attempt ID.',
    'The teacher identified the captured score.create=1 variant as showing already-graded results; static module.js uses returned print_list for a native Print command. No server implementation or direct DB trace was obtained. This admission is specific to that score-view variant; no general GET/POST or create flag is certified safe.',
    'A transient live HTTP failure occurred before a later successful read. Automatic retries are disabled; successful targets remain visible when another target is blocked. No synthetic fallback substitutes for a failed read.',
    'Server score is preserved literally and is not recomputed from a simple correct-item percentage. Actual conceptual understanding and app-input correctness still require teacher inspection.',
    'Global endpointCatalog and legacy live services remain fail-closed. This narrow manual reader does not activate all historical routes, prestudy inspections/comments or clinic generation.',
  ],
  recovery: [
    'On authentication failure stop and use the native vault/2FA workflow; never expose credentials or extract a session.',
    'On source drift or score/identity conflict keep a blocked result and re-review only the affected contract; do not save or repair academy data.',
    'On a transport failure retain any successful target, report the blocked target and retry only the same admitted read deliberately; do not generate new attempts or clinics.',
    'No official record, Sheet, parent message, persistent service, scheduler or production DB was modified by this adapter. Reverting owned source changes disables preparation without erasing original captures or foreign work.',
  ],
} as const satisfies ManualAssessmentReadContract;
