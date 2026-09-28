import type {AudioImport,ImportTranscription} from './audio-import-model';

type Source=Pick<AudioImport,'id'|'session_id'|'status'|'transcript_id'>&{owner:string};
export type ImportTranscriptEntry={id:string;owner:string;session_id:string;capture_id:string|null;kind:string;body:string};

// Availability is a projection of retained source evidence, not a new attempt
// outcome. In particular, a session can contain several distinct recordings.
export function importTranscription(row:Source,entries:ImportTranscriptEntry[]):ImportTranscription{
 const ids:string[]=[];let conflict=false;
 for(const e of entries){
  if(e.owner!==row.owner||e.kind!=='transcript'||e.capture_id!==row.id)continue;
  if(e.session_id!==row.session_id){conflict=true;continue;}
  try{
   const body=JSON.parse(e.body);
   if(!body||typeof body.text!=='string'||!body.text.trim()||body.text.length>100000||body.originalAudioId!==undefined&&body.originalAudioId!==row.id){conflict=true;continue;}
   ids.push(e.id);
  }catch{conflict=true;}
 }
 const entryIds=[...new Set(ids)];
 if(row.transcript_id&&!entryIds.includes(row.transcript_id)||row.status==='transcribed'&&!entryIds.length||row.status==='invalid'&&entryIds.length)conflict=true;
 return {state:conflict?'needs_review':entryIds.length?'available':'not_found',entryIds};
}
