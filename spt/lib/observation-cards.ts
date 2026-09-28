import {parse,uuid,type Entry} from './notebook';

export const CARD_PREFIX='observation_card:';
export type ObservationScene={id:string;activity:string;range:string};
export type ObservationCard={cardId:string;category:'observed'|'studentSaid'|'next';text:string;scene:ObservationScene;deleted:boolean;occurrenceOf:string;positionSeconds:number|null;restoredFrom?:string};
export type CardRevision={entry:Entry;card:ObservationCard};
export const cardKind=(id:string)=>CARD_PREFIX+id;
export const isCardKind=(kind:string)=>kind.startsWith(CARD_PREFIX)&&uuid(kind.slice(CARD_PREFIX.length));
export function validateCard(kind:string,value:unknown):ObservationCard{
 const p=value as ObservationCard;
 if(!isCardKind(kind)||!p||p.cardId!==kind.slice(CARD_PREFIX.length)||!['observed','studentSaid','next'].includes(p.category)||typeof p.text!=='string'||!p.text.trim()||p.text.length>12000||!p.scene||typeof p.scene.id!=='string'||!p.scene.id||p.scene.id.length>150||typeof p.scene.activity!=='string'||p.scene.activity.length>150||typeof p.scene.range!=='string'||p.scene.range.length>2000||typeof p.deleted!=='boolean'||typeof p.occurrenceOf!=='string'||p.occurrenceOf!==''&&!uuid(p.occurrenceOf)||p.positionSeconds!==null&&(!Number.isFinite(p.positionSeconds)||p.positionSeconds<0))throw new Error('관찰 카드의 대상과 내용을 확인해 주세요.');
 if(p.restoredFrom!==undefined&&!uuid(p.restoredFrom))throw new Error('복원할 삭제 이력을 확인해 주세요.');
 return {cardId:p.cardId,category:p.category,text:p.text.trim(),scene:{id:p.scene.id,activity:p.scene.activity,range:p.scene.range},deleted:p.deleted,occurrenceOf:p.occurrenceOf,positionSeconds:p.positionSeconds,...(p.restoredFrom?{restoredFrom:p.restoredFrom}:{})};
}
export function cardRevisions(events:Entry[]):CardRevision[]{
 const map=new Map<string,CardRevision>();
 for(const entry of events){if(!isCardKind(entry.kind))continue;let card:ObservationCard;try{card=validateCard(entry.kind,parse(entry));}catch{continue;}
  const old=map.get(card.cardId);if(old?.card.deleted&&!card.deleted&&!canRestoreCard(old.card,card,old.entry.id,entry.base_revision_id||''))continue;map.set(card.cardId,{entry,card});
 }return [...map.values()];
}
export function sameObservation(card:ObservationCard,category:string,text:string,scene:ObservationScene){return !card.deleted&&card.category===category&&card.text===text.trim()&&card.scene.id===scene.id&&card.scene.activity===scene.activity&&card.scene.range===scene.range;}

/** A restore explicitly names the latest tombstone and preserves its evidence. */
export function canRestoreCard(previous:ObservationCard,next:ObservationCard,previousId:string,baseId:string){
 const {deleted:wasDeleted,restoredFrom:oldRestore,...before}=previous;
 const {deleted:isDeleted,restoredFrom,...after}=next;
 return wasDeleted&&!isDeleted&&previousId===baseId&&restoredFrom===previousId&&JSON.stringify(before)===JSON.stringify(after);
}
