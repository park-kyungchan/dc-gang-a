import {z} from 'zod';
import {assertScopeCurrent,scopeDraftSchema,scopeDraftFeedback,scopeSchema,scopeText,type CurriculumCatalog} from './curriculum';
import type {ClassEvent,Task} from './classroom';

export const activityScopeDraftSchema=z.object({activityId:z.string().uuid(),baseRevisionId:z.string().uuid(),scope:scopeDraftSchema.nullable()}).strict();
export const activityScopeDraftsSchema=z.array(activityScopeDraftSchema).max(30).refine(items=>new Set(items.map(i=>i.activityId)).size===items.length,'활동마다 하나의 수정안을 보관하세요.');
export type ActivityScopeDraft=z.infer<typeof activityScopeDraftSchema>;

export function mergeActivityScopeDraft<T extends object>(plan:T,activityId:string,draft:ActivityScopeDraft|null){
 z.string().uuid().parse(activityId);
 if(draft&&draft.activityId!==activityId)throw new Error('수정 중인 원래 활동을 유지하세요.');
 const items=activityScopeDraftsSchema.parse((plan as {activityScopeDrafts?:unknown}).activityScopeDrafts||[]);
 const next=items.filter(d=>d.activityId!==activityId);
 if(draft)next.push(activityScopeDraftSchema.parse(draft));
 return {...plan,activityScopeDrafts:activityScopeDraftsSchema.parse(next)};
}

/** Scope-only correction: no new activity, completion, timing or performed fact. */
export function applyActivityScope(event:ClassEvent|undefined,draft:ActivityScopeDraft,studentId:string,workDate:string,catalog:CurriculumCatalog|null):Task{
 if(!event||event.kind!=='activity'||event.student_id!==studentId||event.entity_id!==draft.activityId)throw new Error('원래 학생과 활동을 확인하세요.');
 const prior=JSON.parse(event.body) as Task;
 if(prior.workDate!==workDate||prior.cancelled)throw new Error('이동하거나 취소된 활동입니다. 선택은 보존하고 현재 활동을 확인하세요.');
 if(event.id!==draft.baseRevisionId)throw new Error('다른 수정이 있습니다. 선택은 보존하고 최신 활동과 대조하세요.');
 const feedback=scopeDraftFeedback(draft.scope);if(feedback.kind!=='ready')throw new Error(feedback.message);
 const scope=scopeSchema.parse(draft.scope);
 assertScopeCurrent(scope,catalog,studentId);
 return {...prior,scope,range:scopeText(scope)};
}
