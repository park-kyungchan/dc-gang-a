import { describe, it, expect, beforeEach } from 'bun:test';
import { LmsLiveQueryService } from '../../src/lms/lmsLiveQueryService';
import type { LmsTestSummaryItem } from '../../src/lms/lmsLiveQueryService';

describe('LmsLiveQueryService & Deterministic Parser', () => {
  let service: LmsLiveQueryService;

  beforeEach(() => {
    service = new LmsLiveQueryService();
  });

  it('fails closed before any legacy live assessment or clinic request', async () => {
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => { networkCalls++; throw new Error('network_called'); }) as unknown as typeof fetch;
    try {
      await expect(service.queryStudentTestResults({
        sessionCookie: 'synthetic', studentName: 'synthetic', startDate: '2099-01-01', endDate: '2099-01-02',
      })).rejects.toThrow(/unverified_live_route_contract/);
      await expect(service.queryPupilGradingDetails({
        sessionCookie: 'synthetic', item: {} as LmsTestSummaryItem,
      })).rejects.toThrow(/unverified_live_route_contract/);
      await expect(service.queryClinicPaper({
        sessionCookie: 'synthetic', studentName: 'synthetic', priNo: '0', testingNo: '0',
      })).rejects.toThrow(/unverified_live_route_contract/);
      expect(networkCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe('EXTERN_DIALOG testResultList Parsing', () => {
    it('deterministically parses testResultList from mock LMS HTML', () => {
      const mockHtml = `
        <script>
        EXTERN_DIALOG = {
          testResultList: JSON.parse('[{"pNo":6343283,"testingNo":20549621,"score":84,"oQuestions":25,"userName":"유지연","testingName":"[대단원총괄평가] [가우스] 3 방정식 대단원 총괄 - 유지연","hangDate":"09.28","applyDate":"09-28 16:35"}]')
        };
        </script>
      `;

      const list = service.parseTestSummaryList(mockHtml);
      expect(list.length).toBe(1);
      expect(list[0].pNo).toBe('6343283');
      expect(list[0].testingNo).toBe('20549621');
      expect(list[0].score).toBe(84);
      expect(list[0].oQuestions).toBe(25);
      expect(list[0].userName).toBe('유지연');
      expect(list[0].applyDate).toBe('09-28 16:35');
    });

    it('throws clear error when session expired or login redirect happens', () => {
      const loginHtml = `<html><body><script>alert("로그인이 필요합니다."); location.href="/login.jsp";</script></body></html>`;
      expect(() => service.parseTestSummaryList(loginHtml)).toThrow(/Session expired/);
    });

    it('returns empty array when no EXTERN_DIALOG exists and not login page', () => {
      const emptyHtml = `<html><body><div>No data</div></body></html>`;
      const list = service.parseTestSummaryList(emptyHtml);
      expect(list).toEqual([]);
    });
  });

  describe('PupilSearch Question-Level Parsing', () => {
    it('extracts question-level scoring and answers for specified student', () => {
      const mockPupilHtml = `
        <script>
        var cache = JSON.parse('[{"studentName":"유지연","score":84.0,"allCorrect":false,"priNo":1293138,"pNo":"6343283","testingNo":20549621,"applyDate":"09.28","applyEndDate":"16:35","examResultList":[{"_examNo":1,"examScore":0.0,"examScoreMax":4.0,"answer1":"3"},{"_examNo":2,"examScore":4.0,"examScoreMax":4.0,"answer1":"2"}]}]');
        </script>
      `;

      const detail = service.parsePupilGradingDetails(mockPupilHtml, '유지연');
      expect(detail).not.toBeNull();
      expect(detail!.studentName).toBe('유지연');
      expect(detail!.score).toBe(84);
      expect(detail!.examResultList.length).toBe(2);
      expect(detail!.examResultList[0]._examNo).toBe(1);
      expect(detail!.examResultList[0].examScore).toBe(0);
      expect(detail!.examResultList[0].answer1).toBe('3');
      expect(detail!.examResultList[1]._examNo).toBe(2);
      expect(detail!.examResultList[1].examScore).toBe(4);
    });

    it('converts PupilResultDetail into normalized RawAppAssessmentSubmission', () => {
      const detail = {
        studentName: '유지연',
        priNo: 1293138,
        pNo: '6343283',
        testingNo: 20549621,
        score: 84,
        allCorrect: false,
        applyDate: '09.28',
        applyEndDate: '16:35',
        examResultList: [
          { _examNo: 1, examScore: 0, examScoreMax: 4, answer1: '3' },
          { _examNo: 2, examScore: 4, examScoreMax: 4, answer1: '1' }
        ]
      };

      const summary: LmsTestSummaryItem = {
        pNo: '6343283',
        testingNo: '20549621',
        testNo: 1180,
        priNo: '1293138',
        userName: '유지연',
        testingName: '[대단원총괄평가] [가우스] 3 방정식 대단원 총괄 - 유지연',
        printTestingName: '[가우스] 3 방정식 대단원 총괄',
        gradeName: '(2022 개정) 중1',
        paperType: 1,
        assNo: 1001,
        score: 84,
        oQuestions: 2,
        sQuestions: 0,
        dQuestions: 0,
        hangDate: '09.28',
        applyDate: '09-28 16:35',
        useTerm: -1
      };

      const submission = service.toRawAppSubmission({
        detail,
        summary,
        studentId: '1293138',
        enrolledGroup: '월금1부',
        bookTitle: '가우스 1-1',
        unitName: '3. 방정식',
        scope: '3. 방정식 대단원 총괄',
        sessionDate: '2026-09-28'
      });

      expect(submission.studentId).toBe('1293138');
      expect(submission.questions.length).toBe(2);
      expect(submission.questions[0].questionNo).toBe(1);
      expect(submission.questions[0].submittedAnswer).toBe('3');
      expect(submission.questions[1].questionNo).toBe(2);
      expect(submission.questions[1].submittedAnswer).toBe('1');
    });
  });
});
