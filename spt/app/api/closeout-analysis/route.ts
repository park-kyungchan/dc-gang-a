import {ApiError, body, failure, owner, result} from '@/lib/server';
import {text, validDate, uuid} from '@/lib/notebook';
import {readRoster} from '@/lib/roster-server';
import {analyzeCloseout} from '@/lib/closeout-analysis';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const user = await owner(request);
    const input = await body(request, 2000);
    if (!validDate(input.date) || !(await readRoster(user)).roster.some(s => s.id === input.studentId)) throw new ApiError('학생과 수업일을 확인해 주세요.');
    if (input.reanalyseFrom !== undefined && !uuid(input.reanalyseFrom)) throw new ApiError('이전 분석 요청을 확인해 주세요.');
    return result(await analyzeCloseout(user,input.studentId,input.date,text(input.basis,200),input.reanalyseFrom||''));
  } catch (error) {return failure(error);}
}
