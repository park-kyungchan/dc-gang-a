import {type Student,validDate} from './notebook';
import type {SheetSnapshot,SheetMapping} from './sheet-bridge';

/** Values are derived only from the teacher-compared source snapshot. */
export function mergeRoster(previous:Student[],snapshot:SheetSnapshot,mappings:SheetMapping[],hash:string,confirmedAt:string):Student[]{
 const next=new Map(previous.map(s=>[s.id,s]));
 for(const m of mappings){const p=snapshot.profileSource.profiles.find(p=>p.id===m.studentId)!;
  const value=(key:string)=>String(p[key]??'').trim();
  const daysRaw=value('days');const tokens=daysRaw.replace(/요일/g,'').split(/[\s·,、/]+/).filter(Boolean);
  const days=tokens.length&&tokens.every(t=>/^[일월화수목금토]+$/.test(t))?[...new Set(tokens.join('').split('').map(c=>'일월화수목금토'.indexOf(c)))]:[];
  next.set(m.studentId,{id:m.studentId,name:p.name,active:p.status==='재원',days,part:value('part'),time:value('time'),firstDate:validDate(value('firstDate'))?value('firstDate'):'',books:[value('book1'),value('book2')].filter(Boolean),source:{kind:'sheet',hash,confirmedAt,profileRow:m.profileRow,mainRow:m.mainRow,status:p.status,daysRaw}});
 }
 return [...next.values()];
}
