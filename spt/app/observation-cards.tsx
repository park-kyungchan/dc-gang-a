'use client';
import {useEffect,useRef,useState} from 'react';
import {SwipeDeleteCard} from './swipe-delete-card';
import type {Entry} from '@/lib/notebook';
import type {DeviceOutbox,Mutation} from '@/lib/outbox';
import {cardKind,cardRevisions,sameObservation,type CardRevision,type ObservationCard,type ObservationScene} from '@/lib/observation-cards';

type Draft={text:string;category:ObservationCard['category'];scene:ObservationScene;revision:string};
const labels={observed:'직접 본 모습',studentSaid:'학생이 말한 내용',next:'다시 확인할 일'};
export function ObservationCards({studentId,name,date,events,scenes,box,ensureSession,position,fail}:{studentId:string;name:string;date:string;events:Entry[];scenes:ObservationScene[];box:DeviceOutbox;ensureSession:()=>Promise<string>;position:()=>{sessionId:string;captureId:string;seconds:number}|null;fail:(e:unknown)=>void}){
 const [lastQuick,setLastQuick]=useState<{category:string;text:string;scene:string;cardId:string;revision:string}|null>(null);
 const scope=date+':'+studentId,emptyScene={id:'free:'+scope,activity:'활동 외 관찰',range:''};
 const [sceneId,setSceneId]=useState(scenes.at(-1)?.id||emptyScene.id),[draft,setDraft]=useState<Draft>(()=>box.noteDraft<Draft>(scope)||{text:'',category:'observed',scene:scenes.at(-1)||emptyScene,revision:''}),[feedback,setFeedback]=useState(''),[repeat,setRepeat]=useState<{category:ObservationCard['category'];text:string;scene:ObservationScene;existing:string;manual:boolean}|null>(null),[highlight,setHighlight]=useState(''),[saving,setSaving]=useState(false);
 const scene=scenes.find(x=>x.id===sceneId)||emptyScene,gate=useRef(false),writes=useRef(Promise.resolve()),draftRef=useRef(draft),draftError=useRef<unknown>(null),localCards=useRef<CardRevision[]>([]),listRef=useRef<HTMLDivElement|null>(null),firstQuick=useRef<HTMLButtonElement|null>(null);
 const [optimisticCards,setOptimisticCards]=useState<CardRevision[]>([]);
 const cards=cardRevisions([...events,...optimisticCards.filter(x=>!events.some(e=>e.id===x.entry.id)).map(x=>x.entry)]);
 useEffect(()=>{localCards.current=localCards.current.filter(x=>!events.some(e=>e.id===x.entry.id));},[events]);
 function change(p:Partial<Draft>){const next={...draftRef.current,...p,...(!draftRef.current.text?{scene}:{} )};draftRef.current=next;box.rememberNoteDraft(scope,next);setDraft(next);draftError.current=null;
  writes.current=writes.current.then(async()=>{const revision=await box.saveNoteDraft(scope,next,draftRef.current.revision);draftRef.current={...draftRef.current,revision};box.rememberNoteDraft(scope,draftRef.current);setDraft(v=>({...v,revision}));}).catch(e=>{draftError.current=e;fail(e);});
 }
 async function add(category:ObservationCard['category'],text:string,chosenScene=scene,separateFrom='',manual=false){
  if(gate.current||!text.trim())return;
  if(!manual&&!separateFrom&&lastQuick?.category===category&&lastQuick.text===text&&lastQuick.scene===JSON.stringify(chosenScene)){const previous=cards.find(x=>x.card.cardId===lastQuick.cardId&&x.entry.id===lastQuick.revision);if(previous){await setDeleted(previous,!previous.card.deleted);return;}}
  gate.current=true;setSaving(true);const point=position(),requested={text,category,scene:{...chosenScene}};
  try{
   if(manual){await writes.current;if(draftError.current)throw draftError.current;}
   const all=cardRevisions([...events,...localCards.current.map(x=>x.entry)]),existing=all.find(x=>sameObservation(x.card,category,text,chosenScene));
   if(existing&&!separateFrom){setRepeat({category,text,scene:{...chosenScene},existing:existing.card.cardId,manual});setHighlight(existing.card.cardId);setFeedback('이 장면에 같은 기록이 있어 기존 카드를 표시했습니다.');return;}
   const sid=point?.sessionId||await ensureSession(),cardId=crypto.randomUUID();
   const card:ObservationCard={cardId,category,text:text.trim(),scene:{...chosenScene},deleted:false,occurrenceOf:separateFrom,positionSeconds:point?.seconds??null};
   const p:Mutation={action:'entry',id:crypto.randomUUID(),sessionId:sid,studentId,date,kind:cardKind(cardId),baseId:'',captureId:point?.captureId||'',createdAt:new Date().toISOString(),data:card};
   await box.appendCard(p);
   localCards.current.push({entry:{id:p.id,session_id:sid,kind:p.kind!,body:JSON.stringify(card),created_at:p.createdAt!,capture_id:p.captureId!},card});
   setOptimisticCards([...localCards.current]);
   if(manual&&draftRef.current.text===requested.text&&draftRef.current.category===requested.category&&JSON.stringify(draftRef.current.scene)===JSON.stringify(requested.scene))change({text:''});
   setLastQuick(!manual&&!separateFrom?{category,text,scene:JSON.stringify(chosenScene),cardId,revision:p.id}:null);setRepeat(null);setHighlight(cardId);setFeedback('이 기기에 관찰을 보관했습니다. 연결되면 전송합니다.');
  }catch(e){fail(e);}finally{gate.current=false;setSaving(false);}
 }
 async function setDeleted(row:CardRevision,deleted:boolean){
  if(gate.current)return;gate.current=true;setSaving(true);
  try{const card:ObservationCard={...row.card,deleted,...(!deleted?{restoredFrom:row.entry.id}:{})};const p:Mutation={action:'entry',id:crypto.randomUUID(),sessionId:row.entry.session_id,studentId,date,kind:row.entry.kind,baseId:row.entry.id,captureId:row.entry.capture_id,createdAt:new Date().toISOString(),data:card};await box.appendCard(p);localCards.current.push({entry:{...row.entry,id:p.id,body:JSON.stringify(card),created_at:p.createdAt!,base_revision_id:row.entry.id},card});setOptimisticCards([...localCards.current]);setLastQuick(v=>v?.cardId===row.card.cardId?{...v,revision:p.id}:v);setRepeat(null);setFeedback(deleted?'카드를 삭제했습니다. 같은 자리에서 눌러 복원할 수 있습니다.':'관찰 카드를 복원했습니다. 원래 장면과 원음 연결을 유지합니다.');}catch(e){fail(e);}finally{gate.current=false;setSaving(false);}
 }
 const recentCard=lastQuick?cards.find(x=>x.card.cardId===lastQuick.cardId&&!x.card.deleted)?.card:undefined;
 const repeatTarget=repeat||(recentCard?{category:recentCard.category,text:recentCard.text,scene:recentCard.scene,existing:recentCard.cardId,manual:false}:null);
 return <section className="panel observation-cards"><h3>직접 관찰</h3><label>관찰할 장면<select value={scene.id} onChange={e=>{setSceneId(e.target.value);setRepeat(null);}}><option value={emptyScene.id}>활동 외 관찰</option>{scenes.map(s=><option key={s.id} value={s.id}>{s.activity}{s.range?' · '+s.range:''}</option>)}</select></label>
  <div className="quick-observations">{['힌트 뒤 스스로 수정함','풀이 이유를 설명함'].map((text,index)=><button ref={index===0?firstQuick:undefined} key={text} disabled={saving} onClick={()=>void add('observed',text)}>{text}{lastQuick?.text===text&&lastQuick.scene===JSON.stringify(scene)&&cards.some(c=>c.card.cardId===lastQuick.cardId&&c.entry.id===lastQuick.revision&&!c.card.deleted)?<span> · 다시 눌러 취소</span>:cards.some(x=>sameObservation(x.card,'observed',text,scene))?<span> · 남김</span>:null}</button>)}<button disabled={saving} onClick={()=>void add('next','풀이 이유 다시 확인')}>풀이 이유 다시 확인{lastQuick?.category==='next'&&lastQuick.text==='풀이 이유 다시 확인'&&lastQuick.scene===JSON.stringify(scene)&&cards.some(c=>c.card.cardId===lastQuick.cardId&&c.entry.id===lastQuick.revision&&!c.card.deleted)?<span> · 다시 눌러 취소</span>:cards.some(x=>sameObservation(x.card,'next','풀이 이유 다시 확인',scene))?<span> · 남김</span>:null}</button></div>
  <details open={!!draft.text}><summary>글로 관찰 남기기</summary><label>기록 종류<select value={draft.category} onChange={e=>change({category:e.target.value as Draft['category']})}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>관찰 내용<textarea value={draft.text} onChange={e=>change({text:e.target.value})} maxLength={12000} placeholder="관찰한 모습"/></label>{draft.text&&<p className="hint">작성 중인 장면 · {draft.scene.activity} {draft.scene.range}</p>}<button className="primary" disabled={!draft.text.trim()||saving} onClick={()=>void add(draft.category,draft.text,draft.scene,'',true)}>관찰 저장</button></details>
  {box.recoveredNotes(scope).length>0&&<details className="draft-recovery"><summary>따로 보관한 초안 {box.recoveredNotes(scope).length}개</summary><label>다른 화면의 최신 초안<textarea readOnly value={box.storedNoteDraft<Draft>(scope)?.text||''}/></label><button onClick={()=>void (async()=>{await writes.current;await box.read();const latest=box.storedNoteDraft<Draft>(scope);if(latest){draftRef.current=latest;box.rememberNoteDraft(scope,latest);setDraft(latest);draftError.current=null;}})().catch(fail)}>최신 초안으로 이어 쓰기</button>{box.recoveredNotes<Draft>(scope).map(item=><article key={item.key}><p className="hint">{item.error} · {item.value.scene.activity} {item.value.scene.range}</p><textarea readOnly aria-label="따로 보관한 관찰 글" value={item.value.text}/></article>)}</details>}
  <p className="hint" role="status">{feedback}</p>
  {repeatTarget&&<button disabled={saving} className="repeat-observation" onClick={()=>void add(repeatTarget.category,repeatTarget.text,repeatTarget.scene,repeatTarget.existing,repeatTarget.manual)}>실제로 다시 관찰함 · 별도 카드 추가</button>}
  <div ref={listRef} className="observation-card-list">{cards.slice().reverse().map(row=><SwipeObservation key={row.card.cardId} row={row} highlighted={highlight===row.card.cardId} disabled={saving} remove={()=>setDeleted(row,true)} restore={()=>setDeleted(row,false)}/>)}</div>
 </section>;
}
export function SwipeObservation({row,highlighted,disabled,remove,restore}:{row:CardRevision;highlighted:boolean;disabled:boolean;remove:()=>void|Promise<void>;restore?:()=>void|Promise<void>}){
 const c=row.card;
 return <SwipeDeleteCard label={c.text} revision={row.entry.id} className={'observation-swipe '+(highlighted?'highlighted':'')} deleted={c.deleted} disabled={disabled} onDelete={remove} onRestore={restore} heading={<><span className="observation-meta">{labels[c.category]} · {c.scene.activity}{c.scene.range?' · '+c.scene.range:''}</span><span className="observation-text">{c.text}</span>{c.occurrenceOf&&<span className="observation-meta">다시 관찰한 별도 기록</span>}</>}/>;
}
