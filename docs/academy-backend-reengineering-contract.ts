export interface AcademyBackendReengineeringContract {
  schemaVersion: 1;
  kind: 'source_and_operation_reengineering_contract';
  scope: readonly string[];
  executionBoundary: readonly string[];
  consumer: { command: string; source: string; evidence: string; projections: readonly string[] };
  validation: readonly string[];
  blockers: readonly string[];
  recovery: readonly string[];
}

/** Complete requested interface scope; evidence coverage is reported independently for every area. */
export const academyBackendReengineering = {
  schemaVersion: 1,
  kind: 'source_and_operation_reengineering_contract',
  scope: [
    'Teacher navigation and account/source declarations',
    'Student identity, enrollment, groups, schedule, regular and makeup occurrences, attendance',
    'DayRecord, official progress, homework, assessments, memo and curriculum fields',
    'Prestudy assignment, submission, teacher inspection and video/correction source relations',
    'DT/ZT, DA/FA/NA and diagnostic paper, attempt, score and item-result relations',
    'Paper pool, printed-paper representation, item/lecture/media and clinic generation boundaries',
    'Smartbook catalog, assignment, results, textbook resources and book-order source declarations',
    'Counseling, periodic CISM, community, device, registration and session bridge declarations',
    'Report preview, parent messaging, cancellation and independent delivery receipt gaps',
    'Native-app-only protocols and physical server/DB internals, explicitly unknown where inaccessible',
  ],
  executionBoundary: [
    'Use the connected Hermes Linux Backend; inspect HTTP responses and inert HTML/JavaScript structure, not screenshots.',
    'Retain the existing canonical route registry and frozen original evidence. Endpoint metadata is not a new dispatcher or permission registry.',
    'Reviewed fixed reads use current native browser-managed authentication; never export cookies or passwords, replay HAR headers, or restore retired saved-session clients.',
    'Inspect mutating GET, form submission, grading, inspection/comment, generation, native Print/WebSocket, sending and cancellation as source only. Execute no such operation under discovery authority.',
    'New selector strings, co-located servlet paths and HTTP 200 do not certify method, effects, joins, current roster, complete pages or delivery.',
    'Keep student/teacher decisions and source history at product owners. Shared/common owners receive only minimized contracts and verification, not student raw material.',
  ],
  consumer: {
    command: 'bun run endpoint:query', source: 'src/lms/endpointCatalog.ts',
    evidence: 'docs/academy-backend-source-survey-2026-10-02.json',
    projections: [
      '--projection coverage: all selected static catalog families, effect counts and observed document coverage',
      '--id <exact_registry_id> --projection full: original operation metadata plus source structure without effect/ownership promotion',
      '--operation <literal_selector> --projection declarations: function-local source declarations; no path/token cartesian joining',
    ],
  },
  validation: [
    'RED/GREEN coverage, declaration, provenance and refusal tests in tests/lms/backendCoverage.test.ts.',
    'Keep tests/lms/endpointCatalog.test.ts and all canonical source hashes unchanged; the manual assessment reader and printed code remain separately qualified.',
    'Run root/harness typechecks, the portable synthetic/source-integrity gate and explicit staged confidentiality audit.',
    'Publish only reviewed source/schema metadata; exact-head CI and merge readback establish repository delivery, not full academy or P2 acceptance.',
  ],
  blockers: [
    'The private canonical roster is absent in this Backend checkout. Do not invent canonical students or claim all current teacher/student joins.',
    'The selected fixed documents do not expose every deployment or server branch; declaration occurrence counts are not unique live operations.',
    'Native-app-only request/source evidence, physical DB schema and server implementation are unavailable. Teacher-site references do not substitute for those sources.',
    'Current complete request encoding, response schemas, exact lesson/course/attempt joins and pagination still need operation-specific evidence.',
    'Unattended authentication, protected durable student history, production migration and recurring write envelopes remain unestablished.',
  ],
  recovery: [
    'On source drift or unknown effect keep the original declaration and block only the affected read; continue independent approved source analysis.',
    'Prepare bounded expressions before sign-in to avoid idle cleanup. Use supported per-call CDP wait parameters for long reads; do not change engine/configuration or keep sessions alive by polling.',
    'Do not infer a missing form action from the analysis page URL; retain the literal nullable attribute and handler destination separately.',
    'Own only the current worktree/branch and explicit changed paths; preserve prior PRs, immutable evidence, private teacher artifacts and foreign work.',
  ],
} as const satisfies AcademyBackendReengineeringContract;
