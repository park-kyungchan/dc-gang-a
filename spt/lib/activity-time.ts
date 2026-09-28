export type ActivityTiming={assignedAt:string;stoppedAt:string;visitedAt:string;revisitAt:string};
export function assignedTiming(at=new Date().toISOString()):ActivityTiming{return {assignedAt:at,stoppedAt:'',visitedAt:'',revisitAt:''};}
export function validateTiming(input:unknown):ActivityTiming|undefined{
 if(input===undefined)return undefined;
 if(!input||typeof input!=='object')throw new Error('활동 시간 형식을 확인해 주세요.');
 const p=input as Record<string,unknown>,out={} as ActivityTiming;
 for(const k of ['assignedAt','stoppedAt','visitedAt','revisitAt'] as const){const v=p[k];if(typeof v!=='string'||v!==''&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v))throw new Error('활동 시각을 확인해 주세요.');out[k]=v;}
 if(out.assignedAt){for(const k of ['stoppedAt','visitedAt','revisitAt'] as const)if(out[k]&&out[k]<out.assignedAt)throw new Error('배정 전의 시각으로 바꿀 수 없습니다.');}
 return out;
}
export function elapsedLabel(t:ActivityTiming|undefined,now:number){
 if(!t?.assignedAt)return '배정 시각 미기록';
 const end=t.stoppedAt?Date.parse(t.stoppedAt):now,seconds=Math.floor((end-Date.parse(t.assignedAt))/1000);
 if(!Number.isFinite(seconds))return '시간 확인 중';if(seconds<0)return '기기 시각 확인 필요';
 const min=Math.floor(seconds/60);return `${t.stoppedAt?'배정 후 경과':'배정 후'} ${min<60?min+'분':Math.floor(min/60)+'시간 '+min%60+'분'}`;
}
export function revisitLabel(t:ActivityTiming|undefined,now:number){if(!t?.revisitAt||t.stoppedAt)return '';const mins=Math.ceil((Date.parse(t.revisitAt)-now)/60000);return mins>0?`${mins}분 뒤 다시 보기`:mins===0?'다시 볼 시점':`다시 볼 시점 ${-mins}분 지남`;}
export function revisitDue(t:ActivityTiming|undefined,now:number){return !!t?.revisitAt&&!t.stoppedAt&&Date.parse(t.revisitAt)<=now;}
export function scheduleVisit(t:ActivityTiming|undefined,minutes:number|null,visited:boolean,at=new Date().toISOString()):ActivityTiming{
 return {...(t||{assignedAt:'',stoppedAt:'',visitedAt:'',revisitAt:''}),...(visited?{visitedAt:at}:{}),revisitAt:minutes===null?'':new Date(Date.parse(at)+minutes*60000).toISOString()};
}
export function transitionTiming(t:ActivityTiming|undefined,state:string,at=new Date().toISOString()){
 if(!t)return undefined;
 return ['done','skipped','pending'].includes(state)?{...t,stoppedAt:t.stoppedAt||at,revisitAt:''}:{...t,stoppedAt:''};
}
