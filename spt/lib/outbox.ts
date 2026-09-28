// A device outbox, not the authoritative notebook. Only authenticated server
// acknowledgements remove jobs. Draft promotion and dependencies are durable.
import {stampInput} from './provenance';
export type RevisionMode='draft'|'event';
export type OutboxApiTransport=(url:string,init:RequestInit)=>Promise<Response>;
export type Mutation={id:string;sessionId?:string;studentId?:string;date?:string;kind?:string;entityId?:string;baseId?:string;captureId?:string;createdAt?:string;recordedAtClient?:string;data?:unknown;dependsOn?:string[];[key:string]:unknown}&({action:'create';title:string;purpose:string}|{action?:'entry'|'start'|'end';interrupted?:boolean});
export type LocalItem={key:string;owner:string;type:'job'|'draft'|'audioDraft'|'cache'|'active'|'receipt'|'noteDraft'|'conflictArchive';order:number;url?:string;payload?:Mutation;bytes?:Uint8Array;audioSize?:number;depends?:string[];scope?:string;error?:string;code?:number;value?:unknown;acknowledgedAt?:number;client?:string};
type StoredItem<T>=Omit<LocalItem,'value'>&{value:T};
type Active={id:string;sessionId:string;studentId:string;date:string;client:string;expires:number;seconds:number;lastAudio:string};
const identityPendingMessage='연결·로그인을 확인하는 중입니다. 미전송 기록은 이 기기에 보관합니다.';
const requestValue=<T>(request:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
function openStore(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('spt-device-outbox',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('items',{keyPath:'key'});s.createIndex('owner','owner');r.result.createObjectStore('audio',{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('아이폰 임시 보관함을 열 수 없습니다. Safari 저장 공간을 확인해 주세요.'));r.onblocked=()=>reject(new Error('다른 기록장 화면을 닫고 다시 열어 주세요.'));});}
export function jobDependencies(p:Mutation,url:string){return [...new Set([...(p.sessionId?[p.sessionId]:[]),...(p.captureId?['capture-'+p.captureId]:[]),...(url==='/api/notebook'&&p.action==='end'?[p.id]:[]),...(p.baseId?[p.baseId]:[]),...(Array.isArray(p.dependsOn)?p.dependsOn:[])])];}
export class DeviceOutbox{
 private noteMemory=new Map<string,unknown>();
 rememberNoteDraft(scope:string,value:unknown){this.noteMemory.set(scope,value);}
 get hasUnstoredNotes(){return [...this.noteMemory].some(([scope,value])=>JSON.stringify(value)!==JSON.stringify(this.items.find(x=>x.key===this.key('noteDraft:'+scope))?.value));}
 readonly client=crypto.randomUUID();private database:Promise<IDBDatabase>;private writing:Promise<unknown>=Promise.resolve();private flushing:Promise<void>|null=null;private listeners=new Set<()=>void>();private ordinal=0;
 items:LocalItem[]=[];message='';
 // `owner` is the legacy IndexedDB partition key. A rehearsal partition is
 // intentionally distinct from the authenticated server account identity.
 constructor(readonly owner:string,private readonly authenticatedOwner:string=owner,private readonly transport:OutboxApiTransport=(url,init)=>fetch(url,init)){this.database=openStore();}
 private key(id:string){return this.owner+'/'+id;}
 private serial<T>(fn:()=>Promise<T>){const next=this.writing.then(fn,fn);this.writing=next.catch(()=>{});return next;}
 private async transact<T>(fn:(store:IDBObjectStore,audio:IDBObjectStore)=>Promise<T>){const database=await this.database,tx=database.transaction(['items','audio'],'readwrite'),store=tx.objectStore('items');const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('임시 보관 중단'));});try{const value=await fn(store,tx.objectStore('audio'));await done;return value;}catch(e){try{tx.abort()}catch{}await done.catch(()=>{});throw e;}}
 private stamp(){return Date.now()*1000+(this.ordinal++%1000);}
 private emit(){this.listeners.forEach(fn=>fn());}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 async read(){const database=await this.database;this.items=(await requestValue(database.transaction('items').objectStore('items').index('owner').getAll(this.owner))).sort((a,b)=>a.order-b.order);this.emit();return this.items;}
 get pending(){return this.items.filter(x=>['job','draft','audioDraft'].includes(x.type));}
 private async changed(){await this.read();}
 async enqueue(id:string,url:string,payload:Mutation|undefined,depends:string[]=[],bytes?:Uint8Array){if(payload&&(payload.action==='entry'||url==='/api/classroom'))payload=stampInput(payload);return this.serial(async()=>{await this.transact(async store=>{const key=this.key(id);if(await requestValue(store.get(key)))return;store.put({key,owner:this.owner,type:'job',order:this.stamp(),url,payload,depends:depends.map(x=>this.key(x)),bytes} satisfies LocalItem);});await this.changed();});}
 async revision(url:string,payload:Mutation,scope:string,mode:RevisionMode='draft'){
  payload=stampInput(payload);return this.serial(async()=>{let saved:Mutation=payload;
   await this.transact(async store=>{
    const key=this.key('draft:'+this.client+':'+scope),draft=await requestValue<LocalItem|undefined>(store.get(key));
    const all=await requestValue<LocalItem[]>(store.index('owner').getAll(this.owner));
    const chain=all.filter(x=>x.scope===scope&&x.client===this.client&&(x.type==='job'||x.type==='receipt')).sort((a,b)=>a.order-b.order);
    let baseId=payload.baseId??'';
    // A receipt can precede React's next render. Advance only along a known
    // causal chain; a different writer's freshly observed base remains intact.
    for(const item of chain)if(item.payload&&(item.type==='job'||item.payload.baseId===baseId))baseId=item.payload.id;
    if(mode==='event'){
     const eventKey=this.key(payload.id);
     if(await requestValue(store.get(eventKey)))throw new Error('이미 보관된 동작 ID입니다. 기존 기록을 확인해 주세요.');
     // Seal any preceding text edit before appending this explicit action.
     // Both operations share one durable transaction and the existing queue.
     if(draft){store.delete(key);store.put({...draft,key:this.key(draft.payload!.id),type:'job'});}
     saved={...payload,baseId:draft?.payload?.id??baseId};
     store.put({key:eventKey,owner:this.owner,type:'job',client:this.client,order:this.stamp(),url,payload:saved,scope,depends:jobDependencies(saved,url).map(x=>this.key(x))} satisfies LocalItem);
    }else{
     saved={...payload,id:draft?.payload?.id||payload.id,baseId:draft?.payload?.baseId??baseId};
     store.put({key,owner:this.owner,type:'draft',client:this.client,order:draft?.order||this.stamp(),url,payload:saved,scope,depends:jobDependencies(saved,url).map(x=>this.key(x))} satisfies LocalItem);
    }
   });await this.changed();return saved;
  });
 }
 async saveNoteDraft(scope:string,value:unknown,baseId:string){return this.serial(async()=>{const id=crypto.randomUUID();let conflict=false;await this.transact(async s=>{const key=this.key('noteDraft:'+scope),old=await requestValue<StoredItem<{revision?:string}>|undefined>(s.get(key));if((old?.value?.revision||'')!==baseId){conflict=true;s.put({key:this.key('noteRecovery:'+id),owner:this.owner,type:'noteDraft',scope,order:this.stamp(),value:{...(value as object),revision:baseId},error:'다른 화면의 초안과 충돌하여 따로 보관한 글'});return;}s.put({key,owner:this.owner,type:'noteDraft',order:this.stamp(),value:{...(value as object),revision:id}});});await this.changed();if(conflict)throw new Error('다른 화면에서 초안이 바뀌어 이 글도 따로 보관했습니다. 아래 보관한 초안을 확인해 주세요.');return id;});}
 recoveredNotes<T=unknown>(scope:string){return this.items.filter(x=>x.type==='noteDraft'&&x.scope===scope&&x.error) as StoredItem<T>[];}
 noteDraft<T=unknown>(scope:string){return (this.noteMemory.get(scope)||this.items.find(x=>x.key===this.key('noteDraft:'+scope))?.value) as T|undefined;}
 storedNoteDraft<T=unknown>(scope:string){return this.items.find(x=>x.key===this.key('noteDraft:'+scope))?.value as T|undefined;}
 async archiveConflict(key:string){return this.serial(async()=>{await this.transact(async s=>{const item=await requestValue<LocalItem|undefined>(s.get(key));if(!item||item.owner!==this.owner||item.code!==409)throw new Error('비교한 입력을 찾을 수 없습니다.');s.put({...item,type:'conflictArchive'});});await this.changed();});}
 async appendCard(payload:Mutation,draft?:{scope:string;revision:string}){payload=stampInput(payload);return this.serial(async()=>{await this.transact(async s=>{const key=this.key(payload.id);if(await requestValue(s.get(key)))return;s.put({key,owner:this.owner,type:'job',order:this.stamp(),url:'/api/notebook',payload,scope:'entry:'+payload.sessionId+':'+payload.kind,client:this.client,depends:jobDependencies(payload,'/api/notebook').map(x=>this.key(x))});if(draft){const draftKey=this.key('noteDraft:'+draft.scope),old=await requestValue<StoredItem<{revision?:string}>|undefined>(s.get(draftKey));if(old?.value?.revision===draft.revision)s.delete(draftKey);}});await this.changed();});}
 async cache(key:string,value:unknown){return this.serial(async()=>{await this.transact(async s=>{s.put({key:this.key('cache:'+key),owner:this.owner,type:'cache',order:0,value});});});}
 cached<T=unknown>(key:string){return this.items.find(x=>x.key===this.key('cache:'+key))?.value as T|undefined;}
 async reconcile(before:number,sessionIds:string[],entryIds:string[]=[]){return this.serial(async()=>{await this.transact(async s=>{const all=await requestValue<LocalItem[]>(s.index('owner').getAll(this.owner));for(const j of all){if(j.type!=='receipt'||!j.acknowledgedAt||j.acknowledgedAt>=before)continue;const p=j.payload!;if(p.action==='entry'&&p.kind?.startsWith('observation_card:')){if(entryIds.includes(p.id))s.delete(j.key);}else if(j.url==='/api/classroom'||sessionIds.includes(p.sessionId||p.id))s.delete(j.key);}});await this.changed();});}
 async promote(){return this.serial(async()=>{await this.transact(async s=>{const all=await requestValue<LocalItem[]>(s.index('owner').getAll(this.owner));for(const item of all){if(item.type==='draft'){s.delete(item.key);s.put({...item,key:this.key(item.payload!.id),type:'job'});}else if(item.type==='audioDraft'){s.put({...item,type:'job'});}}});await this.changed();});}
 async beginCapture(a:Omit<Active,'client'|'expires'|'seconds'|'lastAudio'>){return this.serial(async()=>{await this.transact(async s=>{const key=this.key('active'),old=await requestValue<LocalItem|undefined>(s.get(key));if(old)throw new Error('다른 화면 또는 이전 녹음의 보관을 확인 중입니다. 잠시 뒤 다시 시도해 주세요.');s.put({key,owner:this.owner,type:'active',order:this.stamp(),value:{...a,client:this.client,expires:Date.now()+12000,seconds:0,lastAudio:''}});s.put({key:this.key('capture-'+a.id),owner:this.owner,type:'job',order:this.stamp(),url:'/api/capture',payload:{action:'start',id:a.id,sessionId:a.sessionId,createdAt:new Date().toISOString()},depends:[this.key(a.sessionId)]});});await this.changed();});}
 async heartbeat(){return this.serial(async()=>{await this.transact(async s=>{const key=this.key('active'),a=await requestValue<StoredItem<Active>|undefined>(s.get(key));if(!a||a.value.client!==this.client)throw new Error('녹음 화면이 변경되어 이 화면의 녹음을 중단합니다.');s.put({...a,value:{...a.value,expires:Date.now()+12000}});});});}
 // Every worklet frame updates durable bytes. Only closed ~2s segments are
 // eligible for upload; an unfinished segment is promoted during recovery.
 async audio(id:string,seq:number,bytes:Uint8Array,closed:boolean,seconds:number){return this.serial(async()=>{await this.transact(async (s,audio)=>{const key=this.key(`audio-${id}-${seq}`),activeKey=this.key('active'),a=await requestValue<StoredItem<Active>|undefined>(s.get(activeKey));if(!a||a.value.id!==id||a.value.client!==this.client)throw new Error('현재 녹음의 임시 보관 대상을 확인할 수 없습니다.');const old=await requestValue<LocalItem|undefined>(s.get(key));if(old?.type==='job')throw new Error('이미 마친 음성 구간을 바꿀 수 없습니다.');s.put({key,owner:this.owner,type:closed?'job':'audioDraft',order:old?.order||this.stamp(),url:`/api/audio?capture=${id}&seq=${seq}`,audioSize:bytes.byteLength,depends:[this.key('capture-'+id),...(seq?[this.key(`audio-${id}-${seq-1}`)]:[])]} satisfies LocalItem);audio.put({key,bytes});s.put({...a,value:{...a.value,seconds,lastAudio:`audio-${id}-${seq}`,expires:Date.now()+12000}});});await this.changed();});}
 async finishCapture(id:string,interrupted:boolean){await this.serial(async()=>{await this.transact(async s=>{const key=this.key('active'),a=await requestValue<StoredItem<Active>|undefined>(s.get(key));if(!a||a.value.id!==id||a.value.client!==this.client)return;const all=await requestValue<LocalItem[]>(s.index('owner').getAll(this.owner));for(const j of all.filter(x=>x.type==='audioDraft'&&x.key.includes(`audio-${id}-`)))s.put({...j,type:'job'});s.put({key:this.key('end-'+id),owner:this.owner,type:'job',order:this.stamp(),url:'/api/capture',payload:{action:'end',id,interrupted},depends:[this.key('capture-'+id),...(a.value.lastAudio?[this.key(a.value.lastAudio)]:[])]});s.delete(key);});await this.changed();});}
 async recover(){await this.serial(async()=>{await this.transact(async s=>{const key=this.key('active'),a=await requestValue<StoredItem<Active>|undefined>(s.get(key));if(!a||a.value.client===this.client||a.value.expires>Date.now())return;const active=a.value as Active;const all=await requestValue<LocalItem[]>(s.index('owner').getAll(this.owner));for(const j of all.filter(x=>x.type==='audioDraft'&&x.key.includes(`audio-${active.id}-`)))s.put({...j,type:'job'});s.put({key:this.key('end-'+active.id),owner:this.owner,type:'job',order:this.stamp(),url:'/api/capture',payload:{action:'end',id:active.id,interrupted:true},depends:[this.key('capture-'+active.id),...(active.lastAudio?[this.key(active.lastAudio)]:[])]});const id=crypto.randomUUID();s.put({key:this.key(id),owner:this.owner,type:'job',order:this.stamp(),url:'/api/notebook',payload:{action:'entry',id,sessionId:active.sessionId,captureId:active.id,kind:'recording_notice',data:{text:'화면을 다시 열어 아이폰에 보관된 음성을 복구했습니다. 화면이 닫힌 이후 음성은 녹음되지 않았으며, 대화 재개 시 새 녹음 구간을 시작합니다.'}},depends:[this.key('capture-'+active.id)]});s.delete(key);this.message='이전 녹음과 입력을 복구했습니다. 대화를 선택해 원음을 확인하거나 녹음을 재개하세요.';});await this.changed();});}
 async readAudio(key:string){if(!key.startsWith(this.owner+'/'))throw new Error('다른 계정의 음성입니다.');const database=await this.database;const row=await requestValue(database.transaction('audio').objectStore('audio').get(key));if(!row)throw new Error('기기에 보관된 음성 구간을 찾을 수 없습니다.');return row.bytes as Uint8Array;}
 async rebase(key:string,baseId:string){return this.serial(async()=>{await this.transact(async s=>{const j=await requestValue<LocalItem|undefined>(s.get(key));if(!j?.payload||j.code!==409)throw new Error('비교할 수정본을 찾을 수 없습니다.');s.put({...j,payload:{...j.payload,baseId},depends:jobDependencies({...j.payload,baseId},j.url!).map(x=>this.key(x)),error:undefined,code:undefined});});await this.changed();});}
 async flush(){if(this.flushing)return this.flushing;this.flushing=(async()=>{
  // Never upload one account's device buffer into another signed-in account.
  let identity:Response;try{identity=await this.transport('/api/identity',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!identity.ok||(await identity.json() as {ownerKey?:string}).ownerKey!==this.authenticatedOwner)throw new Error('identity');}catch{this.message=identityPendingMessage;this.emit();return;}
  if(this.message===identityPendingMessage){this.message='';this.emit();}
  // Do not promote a currently recording partial audio segment.
  await this.serial(async()=>{await this.transact(async s=>{const all=await requestValue<LocalItem[]>(s.index('owner').getAll(this.owner));for(const j of all.filter(x=>x.type==='draft')){s.delete(j.key);s.put({...j,key:this.key(j.payload!.id),type:'job'});}});await this.changed();});
  const blocked=new Set<string>();for(const job of [...this.items].filter(x=>x.type==='job')){if(job.code&&job.code>=400&&job.code<500){blocked.add(job.key);continue;}if(job.depends?.some(id=>this.items.some(x=>x.key===id&&x.type!=='receipt')||blocked.has(id))){blocked.add(job.key);continue;}
   try{const bytes=job.audioSize?await this.readAudio(job.key):undefined;const response=await this.transport(job.url!,{method:'POST',headers:{'Content-Type':bytes?'application/octet-stream':'application/json'},body:bytes?bytes as unknown as BodyInit:JSON.stringify(job.payload),signal:AbortSignal.timeout(15000)});if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};if(response.status===401||response.status===403){this.message='로그인을 다시 확인해 주세요. 아이폰의 기록은 유지됩니다.';break;}if(response.status>=500)throw new Error('network');await this.serial(async()=>{await this.transact(async s=>{const latest=await requestValue<LocalItem|undefined>(s.get(job.key));if(latest)s.put({...latest,error:data.error||'저장 내용을 확인해 주세요.',code:response.status});});await this.changed();});blocked.add(job.key);continue;}
    const confirmation=await response.json().catch(()=>null) as {saved?:unknown;id?:unknown;seq?:unknown}|null;
    const requiresId=job.url==='/api/classroom'||job.url==='/api/notebook';
    const audioSeq=job.audioSize?Number(new URL(job.url!,'https://local.invalid').searchParams.get('seq')):null;
    if(confirmation?.saved!==true||(requiresId&&confirmation.id!==job.payload?.id)||(job.payload&&confirmation.id!==undefined&&confirmation.id!==job.payload.id)||(audioSeq!==null&&(confirmation.seq!==audioSeq||confirmation.id!==new URL(job.url!,'https://local.invalid').searchParams.get('capture'))))throw new Error('ack');
    await this.serial(async()=>{await this.transact(async (s,audio)=>{if(job.payload)s.put({...job,type:'receipt',acknowledgedAt:Date.now()});else {s.delete(job.key);audio.delete(job.key);}});await this.changed();});this.message='';
   }catch(error){this.message=error instanceof Error&&error.message==='ack'?'서버의 저장 확인 응답이 달라 전송 대기 중입니다. 기기의 기록은 유지됩니다.':'연결되면 자동 전송합니다. 아이폰에 임시 보관 중입니다.';break;}
  }this.emit();
 })();try{await this.flushing;}finally{this.flushing=null;}}
}
