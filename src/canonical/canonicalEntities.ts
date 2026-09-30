/** Live-only facade. Missing local roster fails closed; there is no synthetic fallback. */
import { CanonicalRegistry, type CanonicalRosterData, type CanonicalTeacher, type CanonicalGroup, type CanonicalStudent } from './canonicalRegistry';
export * from './canonicalRegistry';
// Lazy live facade keeps route metadata usable without private data. Roster access still fails closed.
let liveRegistry: CanonicalRegistry | undefined;
export const canonicalRegistry = new Proxy({} as CanonicalRegistry, {
  get(_target, key) {
    const registry = liveRegistry ??= new CanonicalRegistry();
    const value = Reflect.get(registry, key);
    return typeof value === 'function' ? value.bind(registry) : value;
  },
});

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
