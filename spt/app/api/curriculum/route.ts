import {owner,db,body,result,failure,ApiError} from '@/lib/server';
import {validDate} from '@/lib/notebook';
import {readSheet} from '@/lib/sheet-bridge';
import {catalogFromSnapshot} from '@/lib/curriculum';
export const dynamic='force-dynamic';
export async function GET(){try{const user=await owner();const row=await db().prepare('SELECT body FROM spt_sheet_snapshots WHERE owner=? ORDER BY rowid DESC LIMIT 1').bind(user).first<{body:string}>();return result({catalog:row?catalogFromSnapshot(JSON.parse(row.body)):null});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await owner(request),p=await body(request);if(p.action!=='refresh'||!validDate(p.date))throw new ApiError('목차를 확인할 수업일을 선택해 주세요.');const {snapshot}=await readSheet(user,p.date);return result({catalog:catalogFromSnapshot(snapshot)});}catch(e){return failure(e);}}
