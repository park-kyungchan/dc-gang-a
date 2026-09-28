import {uuid,validDate} from './notebook';
import type {AudioImport} from './audio-import-model';

export const AUDIO_TRANSFER_PROTOCOL='spt.audio-transfer.v1';
export const AUDIO_TRANSFER_SHORTCUT='SPT 녹음 자동전송';
export type TransferGrant={protocol:string;importId:string;sessionId:string;studentId:string;classDate:string;token:string;expiresAt:number;uploadURL:string;statusURL:string};

// Only a temporary per-import capability is handed to the native Shortcut.
// Never persist this URL in localStorage, an outbox, clipboard or telemetry.
export function transferShortcutURL(value:unknown,row:AudioImport,origin:string,now=Date.now()){
 const g=value as Partial<TransferGrant>|null;
 const site=new URL(origin);
 if(site.origin!==origin||site.protocol!=='https:'&&!(site.protocol==='http:'&&site.hostname==='127.0.0.1'))throw new Error('SPT 전송 주소를 확인하세요.');
 if(!g||g.protocol!==AUDIO_TRANSFER_PROTOCOL||!uuid(g.importId)||g.importId!==row.id||g.sessionId!==row.session_id||g.studentId!==row.student_id||g.classDate!==row.class_date||!validDate(g.classDate)||typeof g.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(g.token)||!Number.isFinite(g.expiresAt)||g.expiresAt!*1000<=now||g.expiresAt!*1000>now+21900000||g.uploadURL!==origin+'/api/audio-transfer/upload'||g.statusURL!==origin+'/api/audio-transfer/status')throw new Error('이 녹음의 전송 권한과 유효 시간을 확인하세요.');
 const destination=new URL('/',origin);destination.search=new URLSearchParams({student:g.studentId!,date:g.classDate!,view:'record',audioImport:g.importId!}).toString();
 const input={protocol:AUDIO_TRANSFER_PROTOCOL,importId:g.importId,token:g.token,expiresAt:g.expiresAt,uploadURL:g.uploadURL,statusURL:g.statusURL,returnURL:destination.href};
 return 'shortcuts://run-shortcut?'+new URLSearchParams({name:AUDIO_TRANSFER_SHORTCUT,input:'text',text:JSON.stringify(input)}).toString();
}

export function transferReturnTarget(search:string,row:AudioImport){
 const q=new URLSearchParams(search),id=q.get('audioImport');
 if(!uuid(id)||row.id!==id||!uuid(row.session_id)||!row.student_id||q.get('student')!==row.student_id||q.get('date')!==row.class_date||!validDate(row.class_date))throw new Error('전송 결과의 원래 학생·수업일·녹음 연결을 확인하세요.');
 return {importId:id!,studentId:row.student_id,date:row.class_date!,sessionId:row.session_id,title:row.session_title||'',purpose:row.session_purpose==='test'?'test':'lesson'};
}
