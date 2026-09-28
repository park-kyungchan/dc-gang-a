import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export class ApiError extends Error{constructor(message:string,public status=400){super(message)}}
export function db(){if(!env.DB)throw new ApiError('기록 보관함에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',503);return env.DB;}
export function bucket(){if(!env.BUCKET)throw new ApiError('음성 보관함에 연결할 수 없습니다.',503);return env.BUCKET;}
export async function owner(request?:Request){
 const user=await getChatGPTUser();
 const email=user?.email.trim().toLowerCase();
 if(!email&&!user?.nativeOwnerKey)throw new ApiError('다시 로그인해 주세요.',401);
 if(request&&request.method!=='GET'){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)throw new ApiError('요청 출처를 확인할 수 없습니다.',403);
 }
 // Dispatch-owned SIWC authenticates this email for both the page and API.
 // Its user-ID header is absent in the observed production login flow.
 // Always use the same verified identity, even when an optional ID is present,
 // so records do not split between devices or dispatch contexts. Hash the
 // email to keep it out of audio object paths. Never accept an owner from input.
 // Production sessions and saved keys were empty before this key change.
 return user?.nativeOwnerKey||'siwc-'+await sha(new TextEncoder().encode(email).buffer);
}
export function result(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
export function failure(e:unknown){if(e instanceof ApiError)return result({error:e.message},e.status);console.error('spt_request_failed',e instanceof Error?e.name:'unknown');return result({error:e instanceof Error&&e.message.startsWith('입력')?e.message:'처리 결과를 확인하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.'},500)}
export async function body(request:Request,max=150000){const raw=await request.text();if(raw.length>max)throw new ApiError('입력 내용이 너무 깁니다.',413);try{return JSON.parse(raw)}catch{throw new ApiError('입력 형식을 확인해 주세요.')}}
export async function ownedSession(id:string,user:string){const s=await db().prepare('SELECT * FROM spt_sessions WHERE id=? AND owner=?').bind(id,user).first();if(!s)throw new ApiError('대화 기록을 찾을 수 없습니다.',404);return s;}
export async function ownedCapture(id:string,user:string){const c=await db().prepare('SELECT * FROM spt_captures WHERE id=? AND owner=?').bind(id,user).first();if(!c)throw new ApiError('녹음을 찾을 수 없습니다.',404);return c;}
export async function sha(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function hermesConnectionManaged(user:string){
 const bound=(env as unknown as Record<string,unknown>).SPT_ELEVENLABS_OWNER_KEY;
 return typeof bound==='string'&&/^(?:siwc-[0-9a-f]{64}|native-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(bound)&&bound===user;
}
function nativeElevenLabsKey(){
 const key=(env as unknown as Record<string,unknown>).ELEVENLABS_API_KEY;
 return typeof key==='string'&&key.length>=16&&key.length<=1024&&!/\s/.test(key)?key:null;
}
export async function connectionStatus(user:string):Promise<{connected:boolean;source:'hermes'|'app'|null}>{
 if(hermesConnectionManaged(user))return {connected:!!nativeElevenLabsKey(),source:'hermes'};
 const row=await db().prepare('SELECT updated_at FROM spt_secrets WHERE owner=?').bind(user).first();
 return {connected:!!row,source:row?'app':null};
}
async function vault(){const secret=(env as unknown as Record<string,string>).SPT_VAULT_KEY;if(!secret)throw new ApiError('전사 연결을 위한 서버 설정이 준비되지 않았습니다.',503);return crypto.subtle.importKey('raw',Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encrypt(secret:string){const iv=crypto.getRandomValues(new Uint8Array(12));const out=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await vault(),new TextEncoder().encode(secret)));return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...out));}
export async function apiKey(user:string){if(hermesConnectionManaged(user)){const key=nativeElevenLabsKey();if(!key)throw new ApiError('Hermes API Keys의 ELEVENLABS_API_KEY 등록 상태를 확인해 주세요.',409);return key;}const row=await db().prepare('SELECT cipher FROM spt_secrets WHERE owner=?').bind(user).first<{cipher:string}>();if(!row)throw new ApiError('전사 연결에서 ElevenLabs API 키를 등록해 주세요.',409);const [iv,cipher]=row.cipher.split('.');try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},await vault(),Uint8Array.from(atob(cipher),c=>c.charCodeAt(0))))}catch{throw new ApiError('저장된 전사 연결을 읽을 수 없습니다. 설정에서 다시 등록해 주세요.',503)}}
