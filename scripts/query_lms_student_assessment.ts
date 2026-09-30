#!/usr/bin/env bun
/** Retired direct assessment query. Use the reviewed Bun lead plan and exact reader contract. */
const result = {
  status: 'blocked',
  reason: 'legacy_assessment_routes_and_student_join_unverified',
  details: 'This former CLI used automatic clipboard session discovery, name-only fallback, and raw answer output.',
  next: 'bun run harness/lead.ts plan --fact assessment_results --student-id <canonical-id> --date <date> --json',
  backendRequests: 0,
};
process.stderr.write(JSON.stringify(result) + '\n');
process.exit(1);
