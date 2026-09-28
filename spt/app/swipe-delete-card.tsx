'use client';
import {useEffect,useLayoutEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Trash2,Undo2} from 'lucide-react';
import {moveCardSwipe,endCardSwipe,type CardSwipe} from '@/lib/card-swipe';

// One gesture for removable records. Content stays mounted while deleted so
// text selection, expanded details and local form state survive restoration.
export function SwipeDeleteCard({label,revision,heading,children,deleted=false,disabled=false,className='',onDelete,onRestore,onError,onActivate,activationLabel}:{label:string;revision:string;heading:ReactNode;children?:ReactNode;deleted?:boolean;disabled?:boolean;className?:string;onDelete:()=>void|Promise<void>;onRestore?:()=>void|Promise<void>;onError?:(e:unknown)=>void;onActivate?:()=>void;activationLabel?:string}){
 const id=useId(),[open,setOpen]=useState(false),[offset,setOffset]=useState(0),[armed,setArmed]=useState(false),[dragging,setDragging]=useState(false),[busy,setBusy]=useState(false);
 const root=useRef<HTMLElement|null>(null),handle=useRef<HTMLButtonElement|null>(null),action=useRef<HTMLButtonElement|null>(null),restore=useRef<HTMLButtonElement|null>(null),drag=useRef<CardSwipe|null>(null),suppress=useRef(false),gate=useRef(false),returnFocus=useRef(false),latest=useRef({revision,disabled,deleted});
 const resetKey=JSON.stringify([revision,disabled,deleted]),[previousKey,setPreviousKey]=useState(resetKey);
 if(previousKey!==resetKey){setPreviousKey(resetKey);setDragging(false);setOpen(false);setOffset(0);setArmed(false);}
 useLayoutEffect(()=>{latest.current={revision,disabled,deleted};drag.current=null;},[revision,disabled,deleted]);
 const settle=(value:boolean)=>{setOpen(value);setOffset(value?76:0);setArmed(false);};
 useEffect(()=>()=>{drag.current=null;},[]);

 useEffect(()=>{if(returnFocus.current&&!busy){returnFocus.current=false;(deleted?restore.current:handle.current)?.focus({preventScroll:true});}},[deleted,busy]);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))settle(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);
 async function mutate(restoring=false){
  if(gate.current||latest.current.disabled||latest.current.deleted!==restoring)return;
  gate.current=true;setBusy(true);returnFocus.current=!!root.current?.contains(document.activeElement);settle(false);
  try{await (restoring?onRestore?.():onDelete());}catch(e){returnFocus.current=false;onError?.(e);}finally{gate.current=false;setBusy(false);}
 }
 return <article ref={root} className={'swipe-card '+className+(armed?' delete-armed':'')+(deleted?' is-deleted':'')} aria-busy={busy} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();settle(false);handle.current?.focus({preventScroll:true});}}}>
  <button ref={restore} type="button" className="swipe-restore" hidden={!deleted} disabled={busy||disabled} onClick={()=>void mutate(true)} aria-label={label+' 삭제 취소'}><span>{label}<small>삭제됨 · 눌러 복원</small></span><Undo2 size={18} aria-hidden="true"/></button>
  <div className="swipe-face" hidden={deleted} data-dragging={dragging} style={{transform:`translateX(-${offset}px)`}}
   onClickCapture={e=>{if(suppress.current&&e.detail>0){suppress.current=false;e.preventDefault();e.stopPropagation();return;}if(open&&!(e.target as HTMLElement).closest('[data-swipe-handle]')){settle(false);e.preventDefault();e.stopPropagation();}}}
   onPointerDown={e=>{if(disabled||deleted||gate.current||e.button!==0||!e.isPrimary||drag.current)return;suppress.current=false;const target=e.target as HTMLElement;if(target.closest('input,textarea,select,summary,a,[contenteditable=true],[role=slider]')||target.closest('button,[role=button]')&&!target.closest('[data-swipe-handle]'))return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,base:open?76:0,width:e.currentTarget.clientWidth,revision,axis:'pending',dx:0,dy:0};}}
   onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const moved=moveCardSwipe(d,e.clientX,e.clientY);if(d.axis==='horizontal'){if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);}setOffset(moved.offset);setArmed(moved.armed&&!disabled);}}
   onPointerUp={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;drag.current=null;setDragging(false);const current=latest.current,result=endCardSwipe(d,e.clientX,e.clientY,current.revision,current.disabled||current.deleted||gate.current);suppress.current=result.suppress;settle(result.remove?false:result.open);if(result.remove)void mutate();}}
   onPointerCancel={e=>{if(drag.current?.id!==e.pointerId)return;drag.current=null;setDragging(false);suppress.current=true;settle(open);}}
   onPointerLeave={e=>{if(drag.current?.id===e.pointerId&&!e.currentTarget.hasPointerCapture(e.pointerId)){drag.current=null;setDragging(false);settle(open);}}}
   onLostPointerCapture={e=>{if(e.target!==e.currentTarget)return;if(drag.current){drag.current=null;setDragging(false);suppress.current=true;settle(open);}}}>
   <button ref={handle} type="button" data-swipe-handle className="swipe-handle" disabled={disabled||busy} aria-label={activationLabel} aria-expanded={onActivate?undefined:open} aria-controls={onActivate?undefined:id}
    onClick={e=>{if(suppress.current&&e.detail>0){suppress.current=false;return;}if(onActivate&&!open){onActivate();return;}settle(!open);if(e.detail===0&&!open)setTimeout(()=>action.current?.focus(),0);}}
    onKeyDown={e=>{if(e.key==='Delete'||e.key==='ArrowLeft'){e.preventDefault();settle(true);setTimeout(()=>action.current?.focus(),0);}}}>{heading}{!onActivate&&<span className="sr-only"> · 삭제 버튼 열기</span>}</button>
   {children&&<fieldset className="swipe-content" disabled={busy}>{children}</fieldset>}
  </div>
  <button ref={action} id={id} type="button" className="swipe-delete" hidden={deleted||!open&&offset===0} disabled={disabled||busy} tabIndex={open?0:-1} onClick={()=>void mutate()} aria-label={label+' 카드 삭제'}><Trash2 size={22} aria-hidden="true"/><span>{armed?'놓으면 삭제':'삭제'}</span></button>
 </article>;
}
