import {env} from 'cloudflare:workers';
import {ApiError} from './server';

/** Trusted launcher binding for an entire isolated store, never a query flag. */
export function rehearsalScope():{id:string;date:string;studentIds:string[]}|null {
 const values=env as unknown as Record<string,unknown>,id=values.SPT_REHEARSAL_ID;
 if(id===undefined)return null;
 const fail=()=>{throw new ApiError('리허설 실행 범위를 확인하지 못했습니다.',503);};
 if(typeof id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)||values.SPT_BACKEND_MODE!=='paired-local'||typeof values.SPT_BACKEND_OWNER_KEY!=='string')return fail();
 const date=values.SPT_REHEARSAL_DATE;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)return fail();
 let students:unknown;try{students=JSON.parse(String(values.SPT_REHEARSAL_STUDENTS));}catch{return fail();}
 if(!Array.isArray(students)||!students.length||students.length>3||students.some(s=>typeof s!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(s))||new Set(students).size!==students.length)return fail();
 return {id,date,studentIds:students as string[]};
}
export function rehearsalId():string|null{return rehearsalScope()?.id||null;}
