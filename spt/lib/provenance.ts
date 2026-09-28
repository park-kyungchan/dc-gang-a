// Client input time is evidence about recording the event, not proof of when
// the student action happened. Old/offline clients may not have captured it.
export function clientRecordedAt(value:unknown):string|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('기기 입력 시각의 형식을 확인해 주세요.');
 const normalized=new Date(value).toISOString();
 if(normalized.slice(0,19)!==value.slice(0,19))throw new Error('기기 입력 시각의 날짜와 시간을 확인해 주세요.');
 return normalized;
}
export function stampInput<T extends {recordedAtClient?:string}>(p:T):T{return {...p,recordedAtClient:p.recordedAtClient??new Date().toISOString()};}
