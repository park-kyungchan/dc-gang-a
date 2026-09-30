import { describe, expect, it } from "bun:test";
import { LmsDeterministicReadRepository, JoinError } from "../../src/lms/lmsDeterministicReadRepository";
import { LMS_VERIFIED_READ_ENDPOINTS, type LmsTestPaperContract } from "../../src/lms/lmsBackendContracts";
import { TestPaperAdapter } from "../../src/assessment/testPaperAdapter";

function paper(): LmsTestPaperContract {
  return {
    pNo: "SYN-PAPER-A", assNo: "1001", categoryName: "DailyTest",
    title: "Synthetic Paper", bookTitle: "Synthetic Book",
    unitName: "Synthetic Unit", scope: "Synthetic items 1-2",
    totalQuestions: 2, timeLimitMinutes: 10,
    items: [
      { itemNo: 1, lectureKey: "SYN-ITEM-1", points: 5, correctAnswer: "A", topicDescription: "Synthetic topic 1" },
      { itemNo: 2, lectureKey: "SYN-ITEM-2", points: 5, correctAnswer: "B", topicDescription: "Synthetic topic 2" }
    ],
    provenance: "SYNTHETIC_HARNESS",
    registeredAt: "2099-01-01T10:00:00+09:00", checksum: ""
  };
}

describe("synthetic LMS evidence cache", () => {
  it("starts empty and allows only the reviewed DayRecord operation", () => {
    const repo = new LmsDeterministicReadRepository();
    expect(repo.listTestPapers()).toEqual([]);
    expect(repo.getTestPaper("SYN-PAPER-A")).toBeNull();
    expect(repo.getStudentAttempt("SYN-STUDENT-A", "SYN-PAPER-A")).toBeNull();
    expect(Object.keys(LMS_VERIFIED_READ_ENDPOINTS)).toEqual(["DAY_RECORD_MAIN"]);
    expect(LMS_VERIFIED_READ_ENDPOINTS.DAY_RECORD_MAIN.path)
      .toBe("/servlet/controller.cct.tutor.DayRecordServlet");
  });

  it("uses exact paper keys, copies inputs and outputs, and rejects claimed live papers", () => {
    const repo = new LmsDeterministicReadRepository();
    const input = paper();
    repo.registerTestPaper(input);
    input.items[0]!.correctAnswer = "changed input";
    expect(repo.getTestPaper("SYN-PAPER-A")?.items[0]?.correctAnswer).toBe("A");
    const output = repo.getTestPaper("SYN-PAPER-A")!;
    output.items[0]!.correctAnswer = "changed output";
    expect(repo.getTestPaper("SYN-PAPER-A")?.items[0]?.correctAnswer).toBe("A");
    expect(repo.listTestPapers("Synthetic Book")).toHaveLength(1);
    expect(repo.listTestPapers("Synthetic")).toHaveLength(0);
    expect(() => repo.registerTestPaper({ ...paper(), provenance: "LIVE_LMS" }))
      .toThrow("reviewed source read contract");
    expect(() => repo.getTestPaper("")).toThrow(JoinError);
  });

  it("keeps a locally registered attempt unverified and blocks ledger adaptation", () => {
    const repo = new LmsDeterministicReadRepository();
    repo.registerTestPaper(paper());
    const attempt = repo.registerPendingAttempt({
      pNo: "SYN-PAPER-A", studentId: "SYN-STUDENT-A",
      studentName: "Synthetic Student A", enrolledGroup: "2",
      sessionDate: "2099-01-01", submittedAt: "2099-01-01T10:10:00+09:00",
      timeSpentMinutes: 10, submissionMethod: "academy_app"
    });
    expect(attempt.score).toBeNull();
    expect(attempt.isVerifiedLive).toBe(false);
    expect(attempt.verificationStatus).toBe("unverified_synthetic");
    expect(attempt.dataSource).toBe("SYNTHETIC_HARNESS");
    expect(() => TestPaperAdapter.adaptAttemptToLedgerInput(attempt, repo.getTestPaper("SYN-PAPER-A")!))
      .toThrow(JoinError);
    attempt.wrongItemNumbers.push(9);
    expect(repo.getStudentAttempt("SYN-STUDENT-A", "SYN-PAPER-A")?.wrongItemNumbers).toEqual([]);
  });

  it("cannot turn caller-supplied answers into a verified LMS result", () => {
    const repo = new LmsDeterministicReadRepository();
    repo.registerTestPaper(paper());
    expect(() => repo.confirmVerifiedAttempt({ pNo: "SYN-PAPER-A", studentId: "SYN-STUDENT-A" }))
      .toThrow("verified LMS/app result read contract");
  });
});