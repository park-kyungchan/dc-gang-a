import {db} from './server';
import {students,type Student} from './initial-roster';
export async function readRoster(user:string):Promise<{roster:Student[];rosterRevision:string;rosterSource:'initial'|'sheet'|'synthetic'}>{
 const record=await db().prepare('SELECT r.id,r.body,r.source_hash FROM spt_sheet_settings s JOIN spt_roster_revisions r ON r.id=s.roster_revision_id AND r.owner=s.owner WHERE s.owner=?').bind(user).first<{id:string;body:string;source_hash:string}>();
 return record?{roster:JSON.parse(record.body).students,rosterRevision:record.id,rosterSource:record.source_hash==='SYNTHETIC_NOT_A_SHEET_READ'?'synthetic':'sheet'}:{roster:students,rosterRevision:'',rosterSource:'initial'};
}
