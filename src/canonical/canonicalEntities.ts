/**
 * Canonical Entity Registry & Dual-Runtime SSoT Wrapper (Bun / TypeScript)
 * 
 * Provides deterministic, typed, O(1) lookups for the Daechi Whole-Lens cohort.
 * Driven strictly by data/canonical/canonical_roster.json.
 * 
 * Invariants:
 * - Single Source of Truth (SSoT): canonical_roster.json
 * - Fail-Closed: Unknown queries throw CanonicalLookupError, never silent toxic fallbacks
 * - Path-Safe: Absolute resolution anchored to module location (import.meta.dir), independent of cwd
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export class CanonicalLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalLookupError';
    Object.setPrototypeOf(this, CanonicalLookupError.prototype);
  }
}

export type StudentId = '1293032' | '1294174' | '1293067' | '1293138' | '1235920' | (string & {});
export type CohortStudentId = '1293032' | '1294174' | '1293067' | '1293138';
export type ClassGroupId = '1' | '2' | '3' | '4' | (string & {});

export interface CanonicalTeacher {
  readonly teacherPriNo: string;
  readonly teacherId: string;
  readonly name: string;
  readonly academy: string;
  readonly branch: string;
  readonly sheetTabGid: string;
}

export interface CanonicalGroup {
  readonly groupId: string;
  readonly id: string;
  readonly name: string;
  readonly days: readonly number[]; // 1 = Monday, 2 = Tuesday, ...
  readonly time: string; // e.g. "15:00", "17:00"
}

export interface CanonicalStudent {
  readonly studentId: string;
  readonly name: string;
  readonly loginId: string;
  readonly grade: string | null;
  readonly schoolGrade: string | null;
  readonly group: string | null;
  readonly groupId: string | null;
  readonly groupName: string | null;
  readonly courseSeq: string | null;
  readonly cmSeq: string | null;
  readonly primaryBook: string | null;
  readonly secondaryBook: string | null;
  readonly isTest: boolean;
}

export interface CanonicalRosterData {
  readonly version: string;
  readonly academy: string;
  readonly branch: string;
  readonly teacher: CanonicalTeacher;
  readonly groups: Record<string, CanonicalGroup>;
  readonly students: readonly CanonicalStudent[];
}

/**
 * Robust cross-runtime directory resolution.
 * Anchors paths to the physical file location, immune to process.cwd() drift.
 */
function resolveModuleDir(): string {
  if (typeof import.meta !== 'undefined' && import.meta.dir) {
    return import.meta.dir;
  }
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return dirname(fileURLToPath(import.meta.url));
  }
  return __dirname;
}

export const CANONICAL_ROSTER_PATH = resolve(
  resolveModuleDir(),
  '../../data/canonical/canonical_roster.json'
);

export class CanonicalRegistry {
  private _raw: CanonicalRosterData;
  private _teacher: CanonicalTeacher;
  private _groupsById: Map<string, CanonicalGroup> = new Map();
  private _studentsById: Map<string, CanonicalStudent> = new Map();
  private _studentsByLoginId: Map<string, CanonicalStudent> = new Map();
  private _studentsByName: Map<string, CanonicalStudent> = new Map();
  private _studentsByGroup: Map<string, CanonicalStudent[]> = new Map();
  private _cohortStudents: CanonicalStudent[] = [];
  private _allStudents: CanonicalStudent[] = [];

  constructor(rosterPath: string = CANONICAL_ROSTER_PATH) {
    this._raw = this.loadRoster(rosterPath);
    this._teacher = Object.freeze({ ...this._raw.teacher });
    this.indexData();
  }

  private loadRoster(filePath: string): CanonicalRosterData {
    if (!existsSync(filePath)) {
      throw new CanonicalLookupError(`Canonical roster file not found at: '${filePath}'`);
    }
    const rawContent = readFileSync(filePath, 'utf-8');
    try {
      return JSON.parse(rawContent) as CanonicalRosterData;
    } catch (err) {
      throw new CanonicalLookupError(
        `Failed to parse canonical roster JSON at '${filePath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private indexData(): void {
    this._groupsById.clear();
    this._studentsById.clear();
    this._studentsByLoginId.clear();
    this._studentsByName.clear();
    this._studentsByGroup.clear();
    this._cohortStudents = [];
    this._allStudents = [];

    // Index groups
    for (const [key, group] of Object.entries(this._raw.groups)) {
      const frozenGroup: CanonicalGroup = Object.freeze({ ...group });
      this._groupsById.set(key, frozenGroup);
      this._groupsById.set(group.groupId, frozenGroup);
      this._groupsById.set(group.id, frozenGroup);
    }

    // Index students
    for (const student of this._raw.students) {
      const frozenStudent: CanonicalStudent = Object.freeze({ ...student });
      this._allStudents.push(frozenStudent);
      this._studentsById.set(frozenStudent.studentId, frozenStudent);
      this._studentsByLoginId.set(frozenStudent.loginId, frozenStudent);
      this._studentsByName.set(frozenStudent.name, frozenStudent);

      if (!frozenStudent.isTest) {
        this._cohortStudents.push(frozenStudent);
      }

      const grp = frozenStudent.groupId || frozenStudent.group;
      if (grp) {
        let grpList = this._studentsByGroup.get(grp);
        if (!grpList) {
          grpList = [];
          this._studentsByGroup.set(grp, grpList);
        }
        grpList.push(frozenStudent);
      }
    }
  }

  public reload(customPath?: string): void {
    const targetPath = customPath || CANONICAL_ROSTER_PATH;
    this._raw = this.loadRoster(targetPath);
    this._teacher = Object.freeze({ ...this._raw.teacher });
    this.indexData();
  }

  public getRawRoster(): CanonicalRosterData {
    return this._raw;
  }

  public getTeacher(): CanonicalTeacher {
    return this._teacher;
  }

  public getGroup(groupId: string): CanonicalGroup {
    const grp = this._groupsById.get(String(groupId));
    if (!grp) {
      throw new CanonicalLookupError(`Canonical group not found for ID: '${groupId}'`);
    }
    return grp;
  }

  public findGroup(groupId: string): CanonicalGroup | null {
    return this._groupsById.get(String(groupId)) || null;
  }

  public getAllGroups(): CanonicalGroup[] {
    const seen = new Set<string>();
    const result: CanonicalGroup[] = [];
    for (const grp of this._groupsById.values()) {
      if (!seen.has(grp.groupId)) {
        seen.add(grp.groupId);
        result.push(grp);
      }
    }
    return result;
  }

  public getStudentById(studentId: string): CanonicalStudent {
    const student = this._studentsById.get(String(studentId));
    if (!student) {
      throw new CanonicalLookupError(`Canonical student not found for ID: '${studentId}'`);
    }
    return student;
  }

  public findStudentById(studentId: string): CanonicalStudent | null {
    return this._studentsById.get(String(studentId)) || null;
  }

  public getStudentByName(name: string): CanonicalStudent {
    const student = this._studentsByName.get(name);
    if (!student) {
      throw new CanonicalLookupError(`Canonical student not found for name: '${name}'`);
    }
    return student;
  }

  public findStudentByName(name: string): CanonicalStudent | null {
    return this._studentsByName.get(name) || null;
  }

  public getStudentByLoginId(loginId: string): CanonicalStudent {
    const student = this._studentsByLoginId.get(loginId);
    if (!student) {
      throw new CanonicalLookupError(`Canonical student not found for login ID: '${loginId}'`);
    }
    return student;
  }

  public findStudentByLoginId(loginId: string): CanonicalStudent | null {
    return this._studentsByLoginId.get(loginId) || null;
  }

  /**
   * Universal polymorphic lookup: accepts studentId, loginId, or student name.
   * Throws CanonicalLookupError if not found.
   */
  public getStudent(identifier: string): CanonicalStudent {
    const student = this.findStudent(identifier);
    if (!student) {
      throw new CanonicalLookupError(`Canonical student not found for identifier: '${identifier}'`);
    }
    return student;
  }

  /**
   * Universal polymorphic lookup: accepts studentId, loginId, or student name.
   * Returns null if not found.
   */
  public findStudent(identifier: string): CanonicalStudent | null {
    const idMatch = this._studentsById.get(identifier);
    if (idMatch) return idMatch;

    const loginMatch = this._studentsByLoginId.get(identifier);
    if (loginMatch) return loginMatch;

    const nameMatch = this._studentsByName.get(identifier);
    if (nameMatch) return nameMatch;

    return null;
  }

  public getAllStudents(options: { includeTest?: boolean } = {}): CanonicalStudent[] {
    if (options.includeTest) {
      return [...this._allStudents];
    }
    return [...this._cohortStudents];
  }

  public getCohortStudents(): CanonicalStudent[] {
    return [...this._cohortStudents];
  }

  public getStudentsByGroup(groupId: string): CanonicalStudent[] {
    return [...(this._studentsByGroup.get(String(groupId)) || [])];
  }

  public isCohortStudent(studentId: string): boolean {
    const student = this._studentsById.get(String(studentId));
    return student ? !student.isTest : false;
  }

  public hasStudent(studentId: string): boolean {
    return this._studentsById.has(String(studentId));
  }
}

// Global singleton instance initialized from canonical SSoT
export const canonicalRegistry = new CanonicalRegistry();

// Export convenience direct accessor functions
export const getTeacher = (): CanonicalTeacher => canonicalRegistry.getTeacher();
export const getGroup = (groupId: string): CanonicalGroup => canonicalRegistry.getGroup(groupId);
export const findGroup = (groupId: string): CanonicalGroup | null => canonicalRegistry.findGroup(groupId);
export const getAllGroups = (): CanonicalGroup[] => canonicalRegistry.getAllGroups();

export const getStudent = (identifier: string): CanonicalStudent => canonicalRegistry.getStudent(identifier);
export const getStudentById = (studentId: string): CanonicalStudent => canonicalRegistry.getStudentById(studentId);
export const getStudentByName = (name: string): CanonicalStudent => canonicalRegistry.getStudentByName(name);
export const getStudentByLoginId = (loginId: string): CanonicalStudent => canonicalRegistry.getStudentByLoginId(loginId);

export const findStudent = (identifier: string): CanonicalStudent | null => canonicalRegistry.findStudent(identifier);
export const findStudentById = (studentId: string): CanonicalStudent | null => canonicalRegistry.findStudentById(studentId);
export const findStudentByName = (name: string): CanonicalStudent | null => canonicalRegistry.findStudentByName(name);
export const findStudentByLoginId = (loginId: string): CanonicalStudent | null => canonicalRegistry.findStudentByLoginId(loginId);

export const getAllStudents = (options?: { includeTest?: boolean }): CanonicalStudent[] => canonicalRegistry.getAllStudents(options);
export const getCohortStudents = (): CanonicalStudent[] => canonicalRegistry.getCohortStudents();
export const getStudentsByGroup = (groupId: string): CanonicalStudent[] => canonicalRegistry.getStudentsByGroup(groupId);
export const isCohortStudent = (studentId: string): boolean => canonicalRegistry.isCohortStudent(studentId);
export const hasStudent = (studentId: string): boolean => canonicalRegistry.hasStudent(studentId);

export const reloadCanonicalRegistry = (customPath?: string): void => canonicalRegistry.reload(customPath);
export const getRawCanonicalRoster = (): CanonicalRosterData => canonicalRegistry.getRawRoster();
