import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { CanonicalRegistry, CanonicalLookupError } from '../../src/canonical/canonicalRegistry';
const path = resolve(import.meta.dir, '../fixtures/synthetic-roster.json');
describe('explicit synthetic canonical registry', () => {
  test('binds names, login IDs and class membership to one explicit synthetic source', () => {
    const r = new CanonicalRegistry(path);
    expect(r.getStudent('synthetic-a')).toEqual(r.getStudentById('student-a'));
    expect(r.getStudentByName('Synthetic Student B').groupId).toBe('group-b');
    expect(r.getStudentsByGroup('group-a').map(x => x.studentId)).toEqual(['student-a','test-a']);
    expect(r.getCohortStudents().map(x => x.studentId)).toEqual(['student-a','student-b']);
    expect(r.getAllStudents({ includeTest: true })).toHaveLength(3);
    expect(r.isCohortStudent('test-a')).toBe(false);
    expect(r.getAllGroups()).toHaveLength(2);
  });
  test('missing data and unknown identities remain fail closed', () => {
    const r = new CanonicalRegistry(path);
    expect(() => r.getStudentById('unknown')).toThrow(CanonicalLookupError);
    expect(() => r.getGroup('unknown')).toThrow(CanonicalLookupError);
    expect(r.findStudent('unknown')).toBeNull();
    expect(() => new CanonicalRegistry(resolve(import.meta.dir, 'missing-roster.json'))).toThrow(CanonicalLookupError);
  });
});
