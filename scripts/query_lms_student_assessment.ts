/**
 * Zero-Context Agent Command Line Interface:
 * Deterministic LMS Live Student Assessment Reader.
 * 
 * Usage:
 *   $env:SESSION_COOKIE = "..." # Or automatic in-memory clipboard read
 *   bun run scripts/query_lms_student_assessment.ts --student=유지연 --date=2026-09-28
 *   bun run scripts/query_lms_student_assessment.ts --all --date=2026-09-28
 */

import { LmsLiveQueryService } from '../src/lms/lmsLiveQueryService';

async function getSessionCookie(): Promise<string> {
  const envCookie = process.env.SESSION_COOKIE;
  if (envCookie && envCookie.length > 20) {
    return envCookie.trim();
  }

  // Optional: Read from clipboard in Windows environment if not in env
  try {
    const proc = Bun.spawn(['powershell', '-NoProfile', '-Command', '(Get-Clipboard).Trim()']);
    const text = (await new Response(proc.stdout).text()).trim();
    if (text.length > 20 && /^[a-zA-Z0-9_\-\.]+$/.test(text)) {
      return text;
    }
  } catch (e) {}

  throw new Error('No valid JSESSIONID found in process.env.SESSION_COOKIE or clipboard.');
}

async function main() {
  const args = process.argv.slice(2);
  let studentArg = '';
  let dateArg = '2026-09-28';
  let allStudents = false;

  for (const arg of args) {
    if (arg.startsWith('--student=')) {
      studentArg = arg.split('=')[1].trim();
    } else if (arg.startsWith('--date=')) {
      dateArg = arg.split('=')[1].trim();
    } else if (arg === '--all') {
      allStudents = true;
    }
  }

  const cookie = await getSessionCookie();
  const service = new LmsLiveQueryService();

  const targetStudents = allStudents || !studentArg 
    ? ['유지연', '신지우', '박세은'] 
    : [studentArg];

  console.log(`\n======================================================================`);
  console.log(`[LMS Live Deterministic Assessment Reader] Session Date: ${dateArg}`);
  console.log(`Target Cohort: ${targetStudents.join(', ')}`);
  console.log(`======================================================================\n`);

  for (const student of targetStudents) {
    try {
      console.log(`>>> Querying LMS backend for: ${student}...`);
      const results = await service.queryStudentTestResults({
        sessionCookie: cookie,
        studentName: student,
        startDate: '2026-09-14',
        endDate: dateArg,
        assNo: '1001'
      });

      if (results.length === 0) {
        console.log(`[!] No test results found for ${student}`);
        continue;
      }

      // Filter by today's date if possible
      const hangDate = dateArg.substring(5).replace('-', '.'); // e.g. "09.28"
      const todayResults = results.filter(r => r.hangDate === hangDate);
      const target = todayResults.length > 0 ? todayResults[0] : results[0];

      console.log(`  • Exam Paper: ${target.testingName}`);
      console.log(`  • pNo: ${target.pNo} | testingNo: ${target.testingNo} | Score: ${target.score}점`);
      console.log(`  • Total Questions: ${target.oQuestions} | Applied: ${target.applyDate}`);

      const pupilDetail = await service.queryPupilGradingDetails({
        sessionCookie: cookie,
        item: target
      });

      if (!pupilDetail) {
        console.log(`  [!] Could not parse pupil question details for ${student}`);
        continue;
      }

      const wrongQuestions = pupilDetail.examResultList.filter(q => q.examScore < q.examScoreMax);
      const correctCount = pupilDetail.examResultList.length - wrongQuestions.length;

      console.log(`  • Verified Score: ${pupilDetail.score}점 (${correctCount}/${pupilDetail.examResultList.length} 정답)`);
      if (wrongQuestions.length > 0) {
        console.log(`  • Wrong Questions (${wrongQuestions.length}개):`);
        for (const w of wrongQuestions) {
          console.log(`    - [${w._examNo}번] 배점: ${w.examScoreMax}점 | 득점: ${w.examScore}점 | 학생제출답안: "${w.answer1}"`);
        }
      } else {
        console.log(`  • All questions 100% correct!`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`  [X] Error querying ${student}:`, err.message);
    }
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
