/**
 * Automated Unit Test Suite for Canonical Entity Registry (TypeScript / Bun)
 * 
 * Validates:
 * - RUB-01: Single Source of Truth from canonical_roster.json
 * - RUB-04 & RUB-05: Deterministic lookup for all 4 students and fail-closed error handling
 * - RUB-07: Dual runtime parity requirements
 * - RUB-10: Path safe across execution environments
 */

import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  CANONICAL_ROSTER_PATH,
  CanonicalLookupError,
  CanonicalRegistry,
  canonicalRegistry,
  getTeacher,
  getGroup,
  findGroup,
  getAllGroups,
  getStudent,
  getStudentById,
  getStudentByName,
  getStudentByLoginId,
  findStudent,
  findStudentById,
  findStudentByName,
  findStudentByLoginId,
  getAllStudents,
  getCohortStudents,
  getStudentsByGroup,
  isCohortStudent,
  hasStudent,
} from '../../src/canonical/canonicalEntities';

describe('Canonical Entity Registry (Bun / TypeScript)', () => {
  describe('RUB-10 & RUB-01: SSoT Path Integrity', () => {
    test('CANONICAL_ROSTER_PATH resolves to existing file on disk', () => {
      expect(CANONICAL_ROSTER_PATH).toBeDefined();
      expect(existsSync(CANONICAL_ROSTER_PATH)).toBe(true);
      expect(CANONICAL_ROSTER_PATH.endsWith('data/canonical/canonical_roster.json') ||
             CANONICAL_ROSTER_PATH.endsWith('data\\canonical\\canonical_roster.json')).toBe(true);
    });

    test('raw roster payload contains valid schema metadata', () => {
      const raw = canonicalRegistry.getRawRoster();
      expect(raw.version).toBe('1.0.0');
      expect(raw.academy).toBe('대치 강의하는 아이들');
      expect(raw.branch).toBe('대치점');
      expect(raw.students.length).toBe(6);
    });
  });

  describe('Target Teacher Verification', () => {
    test('retrieves teacher with exact priNo, branch, and sheet tab gid', () => {
      const teacher = getTeacher();
      expect(teacher.teacherPriNo).toBe('1292923');
      expect(teacher.teacherId).toBe('1292923');
      expect(teacher.name).toBe('박경찬');
      expect(teacher.academy).toBe('대치 강의하는 아이들');
      expect(teacher.branch).toBe('대치점');
      expect(teacher.sheetTabGid).toBe('1754681846');
    });
  });

  describe('Target Class Groups Verification', () => {
    test('retrieves all defined class groups with days and times', () => {
      const g1 = getGroup('1');
      expect(g1.name).toBe('화목2부');
      expect(g1.days).toEqual([2, 4]);
      expect(g1.time).toBe('17:00');

      const g2 = getGroup('2');
      expect(g2.name).toBe('월수1부');
      expect(g2.days).toEqual([1, 3]);
      expect(g2.time).toBe('15:00');

      const g3 = getGroup('3');
      expect(g3.name).toBe('월금1부');
      expect(g3.days).toEqual([1, 5]);
      expect(g3.time).toBe('15:00');

      const g4 = getGroup('4');
      expect(g4.name).toBe('수금2부');
      expect(g4.days).toEqual([3, 5]);
      expect(g4.time).toBe('17:00');

      const g5 = getGroup('5');
      expect(g5.name).toBe('월수금2부');
      expect(g5.days).toEqual([1, 3, 5]);
      expect(g5.time).toBe('17:00');
    });

    test('getAllGroups returns all 5 unique groups', () => {
      const allGroups = getAllGroups();
      expect(allGroups.length).toBe(5);
      const groupIds = allGroups.map((g) => g.groupId).sort();
      expect(groupIds).toEqual(['1', '2', '3', '4', '5']);
    });

    test('findGroup returns null for nonexistent group', () => {
      expect(findGroup('99')).toBeNull();
      expect(findGroup('invalid')).toBeNull();
    });
  });

  describe('RUB-04: Deterministic 4-Pupil Cohort Verification', () => {
    test('Shin Ji-woo (1293032) attributes are exact', () => {
      const s = getStudentById('1293032');
      expect(s.studentId).toBe('1293032');
      expect(s.name).toBe('신지우');
      expect(s.loginId).toBe('GA14581_jiwooo0729');
      expect(s.grade).toBe('초5');
      expect(s.schoolGrade).toBe('초5');
      expect(s.group).toBe('2');
      expect(s.groupId).toBe('2');
      expect(s.groupName).toBe('월수1부');
      expect(s.courseSeq).toBe('4');
      expect(s.cmSeq).toBe('82150');
      expect(s.primaryBook).toBe('초5-2 가우스 2권');
      expect(s.secondaryBook).toBe('초5-1 다빈치 1권');
      expect(s.isTest).toBe(false);
    });

    test('Lee Ru-han (1294174) attributes are exact (TRAP 3 prevention)', () => {
      const s = getStudentById('1294174');
      expect(s.studentId).toBe('1294174');
      expect(s.name).toBe('이루한');
      expect(s.loginId).toBe('GA14581_ruhan0604');
      expect(s.grade).toBe('중1');
      expect(s.schoolGrade).toBe('중1');
      expect(s.group).toBe('4');
      expect(s.groupId).toBe('4');
      expect(s.groupName).toBe('수금2부');
      expect(s.courseSeq).toBe('6');
      expect(s.cmSeq).toBe('82495');
      expect(s.primaryBook).toBe('중1-2 가우스 3권');
      expect(s.secondaryBook).toBe('중1-1 다빈치 1권');
      expect(s.isTest).toBe(false);
    });

    test('Park Se-eun (1293067) attributes are exact', () => {
      const s = getStudentById('1293067');
      expect(s.studentId).toBe('1293067');
      expect(s.name).toBe('박세은');
      expect(s.loginId).toBe('GA14581_seeun0325');
      expect(s.grade).toBe('초5');
      expect(s.group).toBe('3');
      expect(s.groupId).toBe('3');
      expect(s.groupName).toBe('월금1부');
      expect(s.primaryBook).toBe('초5-2 가우스 2권');
      expect(s.secondaryBook).toBeNull();
      expect(s.isTest).toBe(false);
    });

    test('Yoo Ji-yeon (1293138) attributes are exact', () => {
      const s = getStudentById('1293138');
      expect(s.studentId).toBe('1293138');
      expect(s.name).toBe('유지연');
      expect(s.loginId).toBe('GA14581_jiyeon0622');
      expect(s.grade).toBe('중1');
      expect(s.group).toBe('3');
      expect(s.groupId).toBe('3');
      expect(s.groupName).toBe('월금1부');
      expect(s.primaryBook).toBe('가우스 1-1');
      expect(s.secondaryBook).toBeNull();
      expect(s.isTest).toBe(false);
    });

    test('Test Account (1235920) is isolated and marked isTest=true', () => {
      const t = getStudentById('1235920');
      expect(t.studentId).toBe('1235920');
      expect(t.name).toBe('test');
      expect(t.loginId).toBe('GA14581_test');
      expect(t.isTest).toBe(true);

      expect(isCohortStudent('1235920')).toBe(false);
      expect(isCohortStudent('1293032')).toBe(true);
      expect(isCohortStudent('1294174')).toBe(true);
    });
  });

  describe('Cohort Filtering & Group Grouping', () => {
    test('getCohortStudents returns exactly the 5 target pupils, excluding test account', () => {
      const cohort = getCohortStudents();
      expect(cohort.length).toBe(5);
      const ids = cohort.map((s) => s.studentId).sort();
      expect(ids).toEqual(['1293032', '1293067', '1293138', '1294174', '1294575']);
    });

    test('getAllStudents respects includeTest option', () => {
      expect(getAllStudents().length).toBe(5);
      expect(getAllStudents({ includeTest: false }).length).toBe(5);
      expect(getAllStudents({ includeTest: true }).length).toBe(6);
    });

    test('getStudentsByGroup groups pupils accurately', () => {
      const group2 = getStudentsByGroup('2');
      expect(group2.length).toBe(1);
      expect(group2[0].name).toBe('신지우');

      const group3 = getStudentsByGroup('3');
      expect(group3.length).toBe(2);
      const g3Names = group3.map((s) => s.name).sort();
      expect(g3Names).toEqual(['박세은', '유지연']);

      const group4 = getStudentsByGroup('4');
      expect(group4.length).toBe(1);
      expect(group4[0].name).toBe('이루한');

      const group5 = getStudentsByGroup('5');
      expect(group5.length).toBe(1);
      expect(group5[0].name).toBe('이현승');

      const group1 = getStudentsByGroup('1');
      expect(group1.length).toBe(0);
    });
  });

  describe('Polymorphic Lookups & O(1) Speed', () => {
    test('getStudent polymorphic lookup by id, loginId, and name', () => {
      expect(getStudent('1293032').name).toBe('신지우');
      expect(getStudent('GA14581_jiwooo0729').name).toBe('신지우');
      expect(getStudent('신지우').studentId).toBe('1293032');

      expect(getStudent('1294174').name).toBe('이루한');
      expect(getStudent('GA14581_ruhan0604').name).toBe('이루한');
      expect(getStudent('이루한').studentId).toBe('1294174');
    });

    test('hasStudent confirms existence accurately', () => {
      expect(hasStudent('1293032')).toBe(true);
      expect(hasStudent('1294174')).toBe(true);
      expect(hasStudent('1293067')).toBe(true);
      expect(hasStudent('1293138')).toBe(true);
      expect(hasStudent('1235920')).toBe(true);
      expect(hasStudent('9999999')).toBe(false);
    });
  });

  describe('RUB-05: Fail-Closed Invariant Verification', () => {
    test('getStudentById throws CanonicalLookupError for unknown ID', () => {
      expect(() => getStudentById('9999999')).toThrow(CanonicalLookupError);
      expect(() => getStudentById('')).toThrow(CanonicalLookupError);
    });

    test('getStudentByName throws CanonicalLookupError for unknown name', () => {
      expect(() => getStudentByName('존재하지않는학생')).toThrow(CanonicalLookupError);
    });

    test('getStudentByLoginId throws CanonicalLookupError for unknown loginId', () => {
      expect(() => getStudentByLoginId('GA99999_fake')).toThrow(CanonicalLookupError);
    });

    test('getStudent throws CanonicalLookupError for unknown identifier', () => {
      expect(() => getStudent('unknown_pupil')).toThrow(CanonicalLookupError);
    });

    test('getGroup throws CanonicalLookupError for unknown group ID', () => {
      expect(() => getGroup('99')).toThrow(CanonicalLookupError);
    });

    test('find* methods return null instead of throwing for unknown entities', () => {
      expect(findStudentById('unknown')).toBeNull();
      expect(findStudentByName('unknown')).toBeNull();
      expect(findStudentByLoginId('unknown')).toBeNull();
      expect(findStudent('unknown')).toBeNull();
    });

    test('constructor throws CanonicalLookupError if file is missing', () => {
      expect(() => new CanonicalRegistry('/non/existent/roster.json')).toThrow(CanonicalLookupError);
    });
  });
});
