#!/usr/bin/env bun
/**
 * Deterministic Dual-Runtime Harness CLI (TypeScript / Bun)
 * 
 * Provides instantaneous (<50ms), fail-closed queries for the Daechi Whole-Lens cohort
 * and canonical LMS backend routes without grepping directories or probing networks.
 * 
 * Invariants:
 * - SLA: Strictly <50ms execution (RUB-06)
 * - Machine Output: --json emits pure, unpolluted JSON (RUB-08)
 * - Cwd Independence: Anchored imports independent of process.cwd() (RUB-10)
 * - Privacy Guard: Zero network requests, zero session discovery (RUB-11)
 * - Zero-Grep Governance: SSoT query tool for agents (RUB-12)
 */

import {
  canonicalRegistry,
  getTeacher,
  getGroup,
  findGroup,
  getAllGroups,
  getStudent,
  getStudentById,
  findStudentById,
  getStudentByName,
  findStudentByName,
  getAllStudents,
  getCohortStudents,
  getStudentsByGroup,
  CanonicalLookupError,
  type CanonicalTeacher,
  type CanonicalGroup,
  type CanonicalStudent
} from '../src/canonical/canonicalEntities';

import {
  LmsRouteRegistry,
  getRoute,
  getAllRoutes,
  hasRoute,
  isSafeRead,
  assertSafeRead,
  RouteLookupError,
  UnsafeMutatingOperationError,
  type LmsRouteDefinition
} from '../src/lms/lmsRouteRegistry';

interface ParsedArgs {
  subcommand: string;
  flags: Record<string, string | boolean>;
}

function parseCliArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  let subcommand = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      flags[key] = true;
    } else if (!subcommand) {
      subcommand = arg;
    }
  }

  return { subcommand, flags };
}

function printHelp(): void {
  const text = `
Daechi Whole-Lens Harness CLI (Zero-Grep Deterministic SSoT)

Usage:
  bun run harness/cli.ts <subcommand> [flags]
  bun run harness <subcommand> [flags]

Subcommands:
  roster    Query canonical teacher, cohort students, and class groups
    Flags:
      --id <studentId>      Query student by numeric ID
      --student <name>      Query student by Korean name
      --group <groupId>     Query class group and member students
      --all                 List teacher, all students, and all groups
      --json                Output clean, parseable JSON

  routes    Query the canonical LMS backend route registry
    Flags:
      --id <routeId>        Query route by canonical ID
      --op <operation>      Query route by operation name
      --category <name>     Filter routes by category (DayRecord, FAIndex, etc.)
      --safe-only           Filter only safe-to-probe read routes
      --all                 List all routes
      --json                Output clean, parseable JSON

  verify    Run automated health & safety checks (cohort, groups, routes, fail-closed)
    Flags:
      --json                Output clean, parseable JSON

Examples:
  bun run harness roster --id 1293032 --json
  bun run harness roster --student "이루한"
  bun run harness routes --id DAY_RECORD_LIST --json
  bun run harness routes --safe-only
  bun run harness verify
`;
  process.stdout.write(text.trim() + '\n');
}

export function handleRoster(flags: Record<string, string | boolean>): number {
  const isJson = Boolean(flags.json);
  const studentId = flags.id as string | undefined;
  const studentName = flags.student as string | undefined;
  const groupId = flags.group as string | undefined;
  const isAll = Boolean(flags.all);

  const teacher = getTeacher();
  let matchingStudents: CanonicalStudent[] = [];
  let matchingGroups: CanonicalGroup[] = [];

  if (studentId) {
    const student = findStudentById(studentId);
    if (!student) {
      process.stderr.write(`Error: Student not found for ID '${studentId}'\n`);
      return 1;
    }
    matchingStudents = [student];
    if (student.groupId) {
      const grp = findGroup(student.groupId);
      if (grp) matchingGroups = [grp];
    }
    if (matchingGroups.length === 0) {
      matchingGroups = getAllGroups();
    }
  } else if (studentName) {
    const student = findStudentByName(studentName);
    if (!student) {
      process.stderr.write(`Error: Student not found for name '${studentName}'\n`);
      return 1;
    }
    matchingStudents = [student];
    if (student.groupId) {
      const grp = findGroup(student.groupId);
      if (grp) matchingGroups = [grp];
    }
    if (matchingGroups.length === 0) {
      matchingGroups = getAllGroups();
    }
  } else if (groupId) {
    const group = findGroup(groupId);
    if (!group) {
      process.stderr.write(`Error: Group not found for ID '${groupId}'\n`);
      return 1;
    }
    matchingGroups = [group];
    matchingStudents = getStudentsByGroup(groupId);
  } else if (isAll || (!studentId && !studentName && !groupId)) {
    matchingStudents = getAllStudents({ includeTest: true });
    matchingGroups = getAllGroups();
  }

  if (isJson) {
    const payload = {
      teacher: {
        teacherPriNo: teacher.teacherPriNo,
        teacherId: teacher.teacherId,
        name: teacher.name,
        academy: teacher.academy,
        branch: teacher.branch,
        sheetTabGid: teacher.sheetTabGid,
      },
      students: matchingStudents.map(s => ({
        studentId: s.studentId,
        name: s.name,
        loginId: s.loginId,
        grade: s.grade,
        schoolGrade: s.schoolGrade,
        group: s.group,
        groupId: s.groupId,
        groupName: s.groupName,
        courseSeq: s.courseSeq,
        cmSeq: s.cmSeq,
        primaryBook: s.primaryBook,
        secondaryBook: s.secondaryBook,
        isTest: s.isTest,
      })),
      groups: matchingGroups.map(g => ({
        groupId: g.groupId,
        id: g.id,
        name: g.name,
        days: g.days,
        time: g.time,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  // Plain-text formatted output
  const lines: string[] = [
    '=== CANONICAL ROSTER ===',
    `Teacher: ${teacher.name} (PriNo: ${teacher.teacherPriNo}, Academy: ${teacher.academy}, Branch: ${teacher.branch}, Sheet Tab GID: ${teacher.sheetTabGid})`,
    '',
    `Groups (${matchingGroups.length}):`,
  ];

  for (const g of matchingGroups) {
    const dayNames = g.days.map(d => ['', '월', '화', '수', '목', '금', '토', '일'][d] || String(d)).join(', ');
    lines.push(`  [Group ${g.groupId}] ${g.name} (Days: ${dayNames} | Time: ${g.time})`);
  }

  lines.push('');
  lines.push(`Students (${matchingStudents.length}):`);
  for (const s of matchingStudents) {
    const testTag = s.isTest ? ' [TEST ACCOUNT]' : '';
    lines.push(
      `  - [${s.studentId}] ${s.name} (Group: ${s.groupName || s.groupId || 'None'}, Login: ${s.loginId}, Grade: ${s.grade || 'N/A'}${testTag})`
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

export function handleRoutes(flags: Record<string, string | boolean>): number {
  const isJson = Boolean(flags.json);
  const routeId = flags.id as string | undefined;
  const operation = flags.op as string | undefined;
  const category = flags.category as string | undefined;
  const isSafeOnly = Boolean(flags['safe-only']);

  let matchingRoutes: LmsRouteDefinition[] = [];

  if (routeId) {
    const rIdLower = routeId.toLowerCase();
    matchingRoutes = getAllRoutes().filter(r => r.id.toLowerCase() === rIdLower);
    if (matchingRoutes.length === 0 && hasRoute(routeId)) {
      matchingRoutes = [getRoute(routeId)];
    }
    if (matchingRoutes.length === 0) {
      process.stderr.write(`Error: Route not found for ID '${routeId}'\n`);
      return 1;
    }
  } else if (operation) {
    const opLower = operation.toLowerCase();
    matchingRoutes = getAllRoutes().filter(
      r => r.operation.toLowerCase() === opLower
    );
    if (matchingRoutes.length === 0 && hasRoute(operation)) {
      matchingRoutes = [getRoute(operation)];
    }
    if (matchingRoutes.length === 0) {
      process.stderr.write(`Error: Route not found for operation '${operation}'\n`);
      return 1;
    }
  } else {
    matchingRoutes = getAllRoutes();
  }

  if (category) {
    matchingRoutes = matchingRoutes.filter(
      r => r.category.toLowerCase() === category.toLowerCase()
    );
    if (matchingRoutes.length === 0) {
      process.stderr.write(`Error: No routes found for category '${category}'\n`);
      return 1;
    }
  }

  if (isSafeOnly) {
    matchingRoutes = matchingRoutes.filter(r => isSafeRead(r.id));
  }

  if (isJson) {
    const payload = {
      total: matchingRoutes.length,
      routes: matchingRoutes.map(r => ({
        id: r.id,
        routeTemplate: r.routeTemplate,
        operation: r.operation,
        httpMethod: r.httpMethod,
        semanticEffect: r.semanticEffect,
        safeToProbe: r.safeToProbe,
        isSafeRead: isSafeRead(r.id),
        category: r.category,
        joinKeyNames: r.joinKeyNames,
        requiredParams: r.requiredParams,
        optionalParams: r.optionalParams,
        reason: r.reason,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  // Plain-text formatted output
  const lines: string[] = [
    '=== LMS ROUTE REGISTRY ===',
    `Total Routes: ${matchingRoutes.length}`,
    '',
  ];

  for (const r of matchingRoutes) {
    const safeRead = isSafeRead(r.id) ? 'YES' : 'NO';
    const safeProbe = r.safeToProbe ? 'YES' : 'NO';
    lines.push(`[${r.id}]`);
    lines.push(`  Operation: ${r.operation}`);
    lines.push(`  Method: ${r.httpMethod || 'N/A'}`);
    lines.push(`  Effect: ${r.semanticEffect} (Safe Read: ${safeRead}, Safe to Probe: ${safeProbe})`);
    lines.push(`  Category: ${r.category}`);
    lines.push(`  Template: ${r.routeTemplate}`);
    if (r.joinKeyNames.length > 0) {
      lines.push(`  Join Keys: ${r.joinKeyNames.join(', ')}`);
    }
    if (r.requiredParams.length > 0) {
      lines.push(`  Required Params: ${r.requiredParams.join(', ')}`);
    }
    if (r.reason) {
      lines.push(`  Reason: ${r.reason}`);
    }
    lines.push('');
  }

  process.stdout.write(lines.join('\n'));
  return 0;
}

export function handleVerify(flags: Record<string, string | boolean>): number {
  const isJson = Boolean(flags.json);

  const checks = {
    teacher: false,
    cohortCount: 0,
    groupCount: 0,
    routeCount: 0,
    failClosedStudent: false,
    failClosedMutatingGet: false,
  };

  const errors: string[] = [];

  // 1. Verify Teacher
  try {
    const teacher = getTeacher();
    if (teacher.teacherPriNo === '1292923' && teacher.name === '박경찬') {
      checks.teacher = true;
    } else {
      errors.push(`Invalid teacher: priNo=${teacher.teacherPriNo}, name=${teacher.name}`);
    }
  } catch (err) {
    errors.push(`Teacher lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Verify Cohort
  try {
    const cohort = getCohortStudents();
    checks.cohortCount = cohort.length;
    const requiredIds = ['1293032', '1294174', '1293067', '1293138', '1294575'];
    const actualIds = cohort.map(s => s.studentId);
    const missing = requiredIds.filter(id => !actualIds.includes(id));
    if (missing.length > 0) {
      errors.push(`Missing required cohort students: ${missing.join(', ')}`);
    }

    const testStudent = findStudentById('1235920');
    if (!testStudent || !testStudent.isTest) {
      errors.push('Test account 1235920 missing or not marked isTest=true');
    }
  } catch (err) {
    errors.push(`Cohort verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Verify Groups
  try {
    const groups = getAllGroups();
    checks.groupCount = groups.length;
    const groupIds = groups.map(g => g.groupId).sort();
    if (JSON.stringify(groupIds) !== JSON.stringify(['1', '2', '3', '4', '5'])) {
      errors.push(`Expected groups [1, 2, 3, 4, 5], got: ${JSON.stringify(groupIds)}`);
    }
  } catch (err) {
    errors.push(`Groups verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Verify Routes
  try {
    const routes = getAllRoutes();
    checks.routeCount = routes.length;
    if (routes.length === 0 || new Set(routes.map(route => route.id)).size !== routes.length) {
      errors.push('Canonical route registry must be nonempty with unique operation IDs');
    }
  } catch (err) {
    errors.push(`Route count verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Verify Fail-Closed Guards
  try {
    const unknown = findStudentById('unknown_student_9999');
    let threwStudent = false;
    try {
      getStudentById('unknown_student_9999');
    } catch (e) {
      if (e instanceof CanonicalLookupError) threwStudent = true;
    }

    if (unknown === null && threwStudent) {
      checks.failClosedStudent = true;
    } else {
      errors.push('Fail-closed student lookup invariant failed');
    }

    // Mutating GET safety
    const mutatingGetSafe = isSafeRead('day_record_udtprg');
    let threwMutatingGet = false;
    try {
      assertSafeRead('day_record_udtprg');
    } catch (e) {
      if (e instanceof UnsafeMutatingOperationError) threwMutatingGet = true;
    }

    if (!mutatingGetSafe && threwMutatingGet) {
      checks.failClosedMutatingGet = true;
    } else {
      errors.push('Fail-closed mutating GET guard invariant failed');
    }
  } catch (err) {
    errors.push(`Fail-closed guard verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const allPassed = errors.length === 0;

  if (isJson) {
    const payload = {
      verified: allPassed,
      checks,
      errors: allPassed ? [] : errors,
      message: allPassed
        ? 'All canonical entities, routes, and safety guards verified successfully.'
        : `Verification failed with ${errors.length} error(s).`,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return allPassed ? 0 : 1;
  }

  // Plain-text output
  const lines: string[] = ['=== HARNESS DETERMINISTIC VERIFICATION ==='];
  lines.push(checks.teacher ? '[PASS] Canonical Teacher: 박경찬 (1292923)' : '[FAIL] Canonical Teacher');
  lines.push(
    checks.cohortCount === 5 && errors.filter(e => e.includes('cohort')).length === 0
      ? '[PASS] Cohort Students: 5 verified (Shin Ji-woo, Lee Ru-han, Park Se-eun, Yoo Ji-yeon, Lee Hyun-seung)'
      : `[FAIL] Cohort Students (Count: ${checks.cohortCount})`
  );
  lines.push(checks.groupCount === 5 ? '[PASS] Groups: 5 verified (Groups 1, 2, 3, 4, 5)' : `[FAIL] Groups (Count: ${checks.groupCount})`);
  lines.push(checks.routeCount > 0 ? `[PASS] Routes: ${checks.routeCount} canonical routes loaded` : '[FAIL] Routes: no validated operations');
  lines.push(checks.failClosedStudent ? '[PASS] Fail-Closed Guard: Unknown student query rejected' : '[FAIL] Fail-Closed Guard: Student');
  lines.push(
    checks.failClosedMutatingGet
      ? '[PASS] Fail-Closed Guard: Mutating GET endpoints blocked from read probing'
      : '[FAIL] Fail-Closed Guard: Mutating GET'
  );

  if (allPassed) {
    lines.push('');
    lines.push('All harness verifications passed (0 errors).');
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } else {
    lines.push('');
    lines.push(`Verification FAILED with ${errors.length} error(s):`);
    for (const err of errors) {
      lines.push(`  - ${err}`);
    }
    process.stderr.write(lines.join('\n') + '\n');
    return 1;
  }
}

export function main(args: string[] = process.argv.slice(2)): number {
  const { subcommand, flags } = parseCliArgs(args);

  if (flags.help || flags.h || !subcommand) {
    printHelp();
    return 0;
  }

  switch (subcommand) {
    case 'roster':
      return handleRoster(flags);
    case 'routes':
      return handleRoutes(flags);
    case 'verify':
      return handleVerify(flags);
    default:
      process.stderr.write(`Error: Unknown subcommand '${subcommand}'. Run with --help for usage.\n`);
      return 1;
  }
}

// Direct execution guard
if (import.meta.main) {
  const exitCode = main();
  process.exit(exitCode);
}
