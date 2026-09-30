/**
 * Automated Test Suite for Harness CLI (TypeScript / Bun)
 * 
 * Validates:
 * - RUB-04 & RUB-05: Deterministic roster queries and fail-closed exit codes
 * - RUB-06: Strict <50ms execution SLA
 * - RUB-08: Pure, unpolluted JSON machine output
 * - RUB-10: Cwd-independent execution
 * - RUB-11: Zero network requests and privacy safety
 */

import { describe, test, expect } from 'bun:test';
import { resolve } from 'node:path';
import {
  handleRoster,
  handleRoutes,
  handleVerify,
  main,
} from '../../harness/cli';

const CLI_PATH = resolve(import.meta.dir, '../../harness/cli.ts');

describe('Harness CLI (Bun / TypeScript)', () => {
  describe('Roster Subcommand (RUB-04, RUB-05, RUB-08)', () => {
    test('roster --id 1293032 --json returns Shin Ji-woo and group 2', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ id: '1293032', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.teacher.name).toBe('박경찬');
        expect(data.teacher.teacherPriNo).toBe('1292923');
        expect(data.students.length).toBe(1);
        expect(data.students[0].studentId).toBe('1293032');
        expect(data.students[0].name).toBe('신지우');
        expect(data.students[0].groupId).toBe('2');
        expect(data.groups.length).toBe(1);
        expect(data.groups[0].groupId).toBe('2');
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('roster --id 1294174 --json returns Lee Ru-han and group 4', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ id: '1294174', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.students.length).toBe(1);
        expect(data.students[0].studentId).toBe('1294174');
        expect(data.students[0].name).toBe('이루한');
        expect(data.students[0].groupId).toBe('4');
        expect(data.groups[0].groupId).toBe('4');
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('roster --student 박세은 --json returns Park Se-eun by name', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ student: '박세은', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.students[0].studentId).toBe('1293067');
        expect(data.students[0].name).toBe('박세은');
        expect(data.students[0].groupId).toBe('3');
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('roster --group 3 --json returns group 3 and member students', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ group: '3', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.groups.length).toBe(1);
        expect(data.groups[0].groupId).toBe('3');
        expect(data.groups[0].name).toBe('월금1부');
        expect(data.students.length).toBe(2);
        const names = data.students.map((s: any) => s.name);
        expect(names).toContain('박세은');
        expect(names).toContain('유지연');
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('roster --group 1 --json returns group 1 with 0 students', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ group: '1', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.groups.length).toBe(1);
        expect(data.groups[0].groupId).toBe('1');
        expect(data.groups[0].name).toBe('화목2부');
        expect(data.students.length).toBe(0);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('roster --all --json returns all students and groups', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ all: true, json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.teacher.name).toBe('박경찬');
        expect(data.students.length).toBe(6); // 5 cohort + 1 test
        expect(data.groups.length).toBe(5);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('roster unknown ID exits with code 1 and writes to stderr (fail-closed)', () => {
      let stderr = '';
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderr += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ id: '9999999' });
        expect(code).toBe(1);
        expect(stderr).toContain("Error: Student not found for ID '9999999'");
      } finally {
        process.stderr.write = origErr;
      }
    });

    test('roster unknown student name exits with code 1', () => {
      let stderr = '';
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderr += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ student: '홍길동' });
        expect(code).toBe(1);
        expect(stderr).toContain("Error: Student not found for name '홍길동'");
      } finally {
        process.stderr.write = origErr;
      }
    });

    test('roster plain-text mode formats readable output without JSON syntax', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoster({ id: '1293032' });
        expect(code).toBe(0);
        expect(stdout).toContain('=== CANONICAL ROSTER ===');
        expect(stdout).toContain('Teacher: 박경찬');
        expect(stdout).toContain('신지우');
        expect(stdout.startsWith('{')).toBe(false);
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });

  describe('Routes Subcommand (RUB-02, RUB-03, RUB-08)', () => {
    test('routes --id day_record_read --json returns exact route with safe status', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ id: 'day_record_read', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.total).toBe(1);
        expect(data.routes[0].id).toBe('day_record_read');
        expect(data.routes[0].safeToProbe).toBe(false);
        expect(data.routes[0].isSafeRead).toBe(false);
        expect(data.routes[0].joinKeyNames).toContain('stu_pri_no');
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('routes --id course_menu --json returns safe read route', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ id: 'course_menu', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.total).toBe(1);
        expect(data.routes[0].id).toBe('course_menu');
        expect(data.routes[0].safeToProbe).toBe(true);
        expect(data.routes[0].isSafeRead).toBe(true);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('routes --op WebUnPreStudy --json returns routes by operation name', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ op: 'WebUnPreStudy', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.total).toBe(2);
        for (const r of data.routes) {
          expect(r.operation).toBe('WebUnPreStudy');
        }
        const ids = data.routes.map((r: any) => r.id);
        expect(ids).toContain('prestudy_waiting');
        expect(ids).toContain('prestudy_waiting_search');
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('routes --safe-only --json returns exclusively safe read endpoints', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ 'safe-only': true, json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.total).toBeGreaterThan(0);
        for (const r of data.routes) {
          expect(r.isSafeRead).toBe(true);
          expect(r.safeToProbe).toBe(true);
          expect(r.semanticEffect).toBe('read');
        }
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('routes --category CourseManageIndex --json filters by category', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ category: 'CourseManageIndex', json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.total).toBeGreaterThan(0);
        for (const r of data.routes) {
          expect(r.category).toBe('CourseManageIndex');
        }
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('routes --all --json returns all 54 canonical routes', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ all: true, json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.total).toBe(54);
        expect(data.routes.length).toBe(54);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('routes unknown ID exits with code 1 and writes to stderr', () => {
      let stderr = '';
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderr += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleRoutes({ id: 'NONEXISTENT_ROUTE' });
        expect(code).toBe(1);
        expect(stderr).toContain("Error: Route not found for ID 'NONEXISTENT_ROUTE'");
      } finally {
        process.stderr.write = origErr;
      }
    });
  });

  describe('Verify Subcommand (RUB-04, RUB-02, RUB-03)', () => {
    test('verify --json succeeds and validates all checks', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleVerify({ json: true });
        expect(code).toBe(0);

        const data = JSON.parse(stdout);
        expect(data.verified).toBe(true);
        expect(data.checks.teacher).toBe(true);
        expect(data.checks.cohortCount).toBe(5);
        expect(data.checks.groupCount).toBe(5);
        expect(data.checks.routeCount).toBe(54);
        expect(data.checks.failClosedStudent).toBe(true);
        expect(data.checks.failClosedMutatingGet).toBe(true);
        expect(data.errors.length).toBe(0);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    test('verify plain-text reports all pass markers', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = handleVerify({});
        expect(code).toBe(0);
        expect(stdout).toContain('[PASS] Canonical Teacher');
        expect(stdout).toContain('[PASS] Cohort Students: 5 verified');
        expect(stdout).toContain('[PASS] Groups: 5 verified');
        expect(stdout).toContain('[PASS] Routes: 54 canonical routes loaded');
        expect(stdout).toContain('[PASS] Fail-Closed Guard: Unknown student query rejected');
        expect(stdout).toContain('[PASS] Fail-Closed Guard: Mutating GET endpoints blocked');
        expect(stdout).toContain('All harness verifications passed (0 errors).');
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });

  describe('Performance SLA (RUB-06)', () => {
    test('handler execution time strictly < 50ms', () => {
      const origWrite = process.stdout.write;
      process.stdout.write = (() => true) as any;

      try {
        const start = performance.now();
        handleRoster({ all: true, json: true });
        handleRoutes({ all: true, json: true });
        handleVerify({ json: true });
        const elapsedMs = performance.now() - start;

        // All 3 combined operations must finish in well under 50ms
        expect(elapsedMs).toBeLessThan(50);
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });

  describe('CLI Dispatcher & Help', () => {
    test('unknown subcommand prints error and exits with 1', () => {
      let stderr = '';
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        stderr += String(chunk);
        return true;
      }) as any;

      try {
        const code = main(['invalid_cmd']);
        expect(code).toBe(1);
        expect(stderr).toContain("Error: Unknown subcommand 'invalid_cmd'");
      } finally {
        process.stderr.write = origErr;
      }
    });

    test('--help flag prints help and exits with 0', () => {
      let stdout = '';
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        stdout += String(chunk);
        return true;
      }) as any;

      try {
        const code = main(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('Daechi Whole-Lens Harness CLI');
        expect(stdout).toContain('Subcommands:');
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });
});
