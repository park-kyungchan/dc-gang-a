"use strict";

const assert = require("node:assert/strict");
const {
  DEMO_DATE, DEMO_STUDENTS, visibleStudents, selectedStudent,
} = require("./whole_lens_1400.js");

assert.equal(DEMO_STUDENTS.length, 12);
assert.equal(new Set(DEMO_STUDENTS.map(student => student.id)).size, 12);
assert.equal(visibleStudents(DEMO_DATE, "all").length, 12);
assert.equal(visibleStudents(DEMO_DATE, "A").length, 6);
assert.equal(visibleStudents(DEMO_DATE, "B").length, 6);
assert.equal(visibleStudents("2099-01-15", "all").length, 0);
assert.equal(selectedStudent(DEMO_DATE, "B", DEMO_STUDENTS[0].id), null);
assert.equal(selectedStudent("2099-01-15", "all", DEMO_STUDENTS[0].id), null);
assert.equal(selectedStudent(DEMO_DATE, "A", DEMO_STUDENTS[0].id)?.id,
  DEMO_STUDENTS[0].id);
console.log("12-student synthetic date/group/selection checks passed");
