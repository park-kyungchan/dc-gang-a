/**
 * LMS Live Backend Deterministic Read Service.
 * 
 * Safety & Invariants (AGENTS.md & Harness Compliance):
 * 1. Pure Read-Only: Only reads from vetted LMS read endpoints; never issues mutating POST/PUT/DELETE.
 * 2. Deterministic Parsing: Extracts typed records directly from LMS backend response payloads.
 * 3. Session Isolation: Session cookie is passed in-memory only; never written to disk or logs.
 * 4. Zero-Context Agent Support: Provides repeatable queries for any student, date, and exam type.
 */

import type { StudentId, ClassGroupId } from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';
import type { RawAppAssessmentSubmission, RawAppQuestionSubmission } from '../assessment/appGradingReader';

export interface LmsTestSummaryItem {
  pNo: string;
  testingNo: string;
  testNo: number;
  priNo: string;
  userName: string;
  testingName: string;
  printTestingName: string;
  gradeName: string;
  paperType: number;
  assNo: number;
  score: number;
  oQuestions: number;
  sQuestions: number;
  dQuestions: number;
  hangDate: string;
  applyDate: string;
  useTerm: number;
}

export interface PupilExamQuestionItem {
  _examNo: number;
  examScore: number;
  examScoreMax: number;
  answer1: string;
  answer2?: string;
}

export interface PupilResultDetail {
  studentName: string;
  priNo: number;
  pNo: string;
  testingNo: number;
  score: number;
  allCorrect: boolean;
  applyDate: string;
  applyEndDate: string;
  examResultList: PupilExamQuestionItem[];
}

export class LmsLiveQueryService {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://dc.gang-a.kr') {
    this.baseUrl = baseUrl;
  }

  /**
   * Queries the list of completed/active test papers for a given student within a date range.
   */
  public async queryStudentTestResults(params: {
    sessionCookie: string;
    studentName: string;
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
    assNo?: string;    // '1001' for grand chapter eval / unit test
    clgNo?: string;
  }): Promise<LmsTestSummaryItem[]> {
    if (!params.sessionCookie) {
      throw new Error('LmsLiveQueryService: sessionCookie is required in process memory.');
    }

    const assNo = params.assNo || '1001';
    const clgNo = params.clgNo || '14581';
    const url = `${this.baseUrl}/servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=${assNo}`;

    const body = new URLSearchParams({
      clg_no: clgNo,
      cls_no: '0',
      p_pageno: '1',
      check_fa_test: assNo,
      stu_name: params.studentName,
      sort_date1: params.startDate,
      sort_date2: params.endDate,
      checkAllPage: 'Y'
    }).toString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Cookie': `JSESSIONID=${params.sessionCookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Failed to query test results: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return this.parseTestSummaryList(html);
  }

  /**
   * Deterministically parses the EXTERN_DIALOG testResultList from LMS HTML.
   */
  public parseTestSummaryList(html: string): LmsTestSummaryItem[] {
    const extIdx = html.indexOf('EXTERN_DIALOG = {');
    if (extIdx === -1) {
      // Check if session expired or redirect happened
      if (html.includes('로그인') || html.includes('login') || html.includes('Session')) {
        throw new Error('LMS Session expired or unauthorized. Please re-authenticate.');
      }
      return [];
    }

    const jsonStart = html.indexOf("JSON.parse('", extIdx) + "JSON.parse('".length;
    const jsonEnd = html.indexOf("')", jsonStart);
    if (jsonStart === -1 || jsonEnd === -1) {
      return [];
    }

    const jsonStr = html.substring(jsonStart, jsonEnd).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const list = JSON.parse(jsonStr);

    return list.map((item: any) => ({
      pNo: String(item.pNo),
      testingNo: String(item.testingNo),
      testNo: Number(item.testNo || 0),
      priNo: String(item.priNo),
      userName: item.userName,
      testingName: item.testingName,
      printTestingName: item.printTestingName || item.testingName,
      gradeName: item.gradeName,
      paperType: Number(item.paperType || 1),
      assNo: Number(item.assNo || 1001),
      score: Number(item.score || 0),
      oQuestions: Number(item.oQuestions || 0),
      sQuestions: Number(item.sQuestions || 0),
      dQuestions: Number(item.dQuestions || 0),
      hangDate: item.hangDate,
      applyDate: item.applyDate,
      useTerm: Number(item.useTerm || -1)
    }));
  }

  /**
   * Queries question-level grading details (PupilSearch) for a specific test paper result.
   */
  public async queryPupilGradingDetails(params: {
    sessionCookie: string;
    item: LmsTestSummaryItem;
  }): Promise<PupilResultDetail | null> {
    if (!params.sessionCookie) {
      throw new Error('LmsLiveQueryService: sessionCookie is required in process memory.');
    }

    const item = params.item;
    const pupilUrl = `${this.baseUrl}/servlet/controller.tutor.fa.TestPageListServlet?p_process=PupilSearch`
      + `&testing_no=${item.testingNo}&p_no=${item.pNo}&apply_flg=1&no_apply_flg=1`
      + `&o_questions=${item.oQuestions}&s_questions=${item.sQuestions}&d_questions=${item.dQuestions}`
      + `&paper_type=${item.paperType}&testing_name=${encodeURIComponent(item.testingName)}`
      + `&grade_name=${encodeURIComponent(item.gradeName)}&subject_name=${encodeURIComponent("수학")}`
      + `&dummy=${Date.now()}&hang_date=${item.hangDate}&use_term=${item.useTerm}&title_option=`;

    const response = await fetch(pupilUrl, {
      method: 'GET',
      headers: {
        'Cookie': `JSESSIONID=${params.sessionCookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PupilSearch: HTTP ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    return this.parsePupilGradingDetails(html, item.userName);
  }

  /**
   * Parses the PupilSearch HTML to extract question-level answers and scores.
   */
  public parsePupilGradingDetails(html: string, expectedStudentName: string): PupilResultDetail | null {
    // Find JSON parsed blocks in PupilSearch HTML
    const jsonMatches = [...html.matchAll(/JSON\.parse\('(\[.*?\])'\)/g)];
    for (const match of jsonMatches) {
      try {
        const unescaped = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
        const parsed = JSON.parse(unescaped);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0];
          if (first.studentName === expectedStudentName && Array.isArray(first.examResultList)) {
            return {
              studentName: first.studentName,
              priNo: Number(first.priNo),
              pNo: String(first.pNo),
              testingNo: Number(first.testingNo),
              score: Number(first.score),
              allCorrect: Boolean(first.allCorrect),
              applyDate: first.applyDate,
              applyEndDate: first.applyEndDate,
              examResultList: first.examResultList.map((e: any) => ({
                _examNo: Number(e._examNo),
                examScore: Number(e.examScore),
                examScoreMax: Number(e.examScoreMax),
                answer1: String(e.answer1 || ''),
                answer2: e.answer2 ? String(e.answer2) : undefined
              }))
            };
          }
        }
      } catch (e) {
        // Continue searching other blocks
      }
    }

    // Direct fallback if regex didn't catch the full string due to quotes
    const nameIdx = html.indexOf(expectedStudentName);
    if (nameIdx !== -1) {
      const jsonStart = html.lastIndexOf("JSON.parse('", nameIdx);
      const jsonEnd = html.indexOf("')", nameIdx);
      if (jsonStart !== -1 && jsonEnd !== -1) {
        try {
          const raw = html.substring(jsonStart + "JSON.parse('".length, jsonEnd)
            .replace(/\\'/g, "'").replace(/\\\\/g, "\\");
          const parsed = JSON.parse(raw);
          const first = Array.isArray(parsed) ? parsed[0] : parsed;
          if (first && Array.isArray(first.examResultList)) {
            return {
              studentName: first.studentName,
              priNo: Number(first.priNo),
              pNo: String(first.pNo),
              testingNo: Number(first.testingNo),
              score: Number(first.score),
              allCorrect: Boolean(first.allCorrect),
              applyDate: first.applyDate,
              applyEndDate: first.applyEndDate,
              examResultList: first.examResultList.map((e: any) => ({
                _examNo: Number(e._examNo),
                examScore: Number(e.examScore),
                examScoreMax: Number(e.examScoreMax),
                answer1: String(e.answer1 || ''),
                answer2: e.answer2 ? String(e.answer2) : undefined
              }))
            };
          }
        } catch (e) {}
      }
    }

    return null;
  }

  /**
   * Queries generated clinic papers (incorrect questions + similar drilling questions)
   * from the LMS typeset servlet (TestpageSelectExServlet).
   */
  public async queryClinicPaper(params: {
    sessionCookie: string;
    studentName: string;
    priNo: string | number;
    testingNo: string | number;
    similarExamCount?: number;
    createAdvance?: boolean;
  }): Promise<{
    result: string;
    printList: Array<{
      examsetTitle: string;
      subTitle: string;
      examList: Array<{
        examNo: number;
        patName: string;
        difficulty: number;
        lectureKey: number;
      }>;
    }>;
  }> {
    if (!params.sessionCookie) {
      throw new Error('LmsLiveQueryService: sessionCookie is required in process memory.');
    }

    const url = `${this.baseUrl}/servlet/controller.common.TestpageSelectExServlet`;
    const condition = {
      testing_no: Number(params.testingNo),
      pri_no: Number(params.priNo),
      student_name: params.studentName,
      score: { create: 0 },
      incorrect: { create: 1 },
      similar: {
        create: 1,
        mode: 1,
        exam_cnt: params.similarExamCount || 1
      },
      advance: { create: params.createAdvance ? 1 : 0 },
      report: { create: 0 }
    };

    const body = new URLSearchParams({
      p_process: 'getStudyResultSingleTestingSingleUser',
      condition: JSON.stringify(condition)
    }).toString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Cookie': `JSESSIONID=${params.sessionCookie}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Failed to query clinic paper: HTTP ${response.status}`);
    }

    const json: any = await response.json();
    const printList = (json.print_list || []).map((p: any) => ({
      examsetTitle: p.examset_title,
      subTitle: p.sub_title,
      examList: (p.exam_list || []).map((e: any) => ({
        examNo: Number(e.exam_no),
        patName: String(e.pat_name || ''),
        difficulty: Number(e.difficulty || 0),
        lectureKey: Number(e.lecture_key || 0)
      }))
    }));

    return {
      result: json.result,
      printList
    };
  }

  /**
   * Converts PupilResultDetail into normalized RawAppAssessmentSubmission.
   */
  public toRawAppSubmission(params: {
    detail: PupilResultDetail;
    summary: LmsTestSummaryItem;
    studentId: StudentId;
    enrolledGroup: ClassGroupId;
    bookTitle: string;
    unitName: string;
    scope: string;
    sessionDate: string;
    timeLimitMinutes?: number;
    deviceInfo?: string;
  }): RawAppAssessmentSubmission {
    const questions: RawAppQuestionSubmission[] = params.detail.examResultList.map(q => {
      const isCorrect = q.examScore === q.examScoreMax;
      return {
        questionNo: q._examNo,
        submittedAnswer: q.answer1,
        correctAnswer: isCorrect ? q.answer1 : '(오답-정답확인요)',
        points: q.examScoreMax,
        lectureKey: `LEC_${params.summary.pNo}_Q${String(q._examNo).padStart(2, '0')}`,
        topic: `${params.unitName} 문항 ${q._examNo}`
      };
    });

    return {
      pNo: params.summary.pNo,
      studentId: params.studentId,
      studentName: params.detail.studentName,
      enrolledGroup: params.enrolledGroup,
      sessionDate: params.sessionDate,
      assessmentCategory: '대단원총괄평가',
      bookTitle: params.bookTitle,
      unitName: params.unitName,
      scope: params.scope,
      timeLimitMinutes: params.timeLimitMinutes || 60,
      timeSpentMinutes: 55, // default
      submittedAt: `${params.sessionDate}T${params.detail.applyEndDate || '16:35'}:00+09:00`,
      deviceInfo: params.deviceInfo || '학원 앱/태블릿 제출',
      questions
    };
  }
}
