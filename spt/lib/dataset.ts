import {isCardKind} from './observation-cards';

export type DatasetRow={id:string;kind?:string;body?:string;created_at:string;recorded_at_client?:string|null;base_revision_id?:string|null;schema_version?:number|null;current_revision?:number;current_deleted?:number;[key:string]:unknown};
export function datasetRecord(type:string,row:DatasetRow,view:'current'|'history'){
 const {body,current_revision,current_deleted,_row,...source}=row;
 const payload=body===undefined?undefined:JSON.parse(body);
 if(type==='audio_import')return {record_type:type,...source,record_stage:'original_audio_file_import',created_at_semantics:'app_preparation_time_not_recording_time',recorded_at:null,status_observed_at:row.updated_at};
 if(type==='audio_import_part')return {record_type:type,...source,created_at_semantics:'import_preparation_time_part_upload_time_not_collected'};
 if(type==='roster_revision'){if(view==='current'&&current_revision!==1)return null;return {record_type:type,...source,record_stage:'teacher_confirmed_student_catalog',revision_state:current_revision===1?'current':'superseded',created_at_semantics:'app_confirmation_received_at',catalog:payload};}
 if(type==='sheet_source_snapshot'){
  if(view==='current'&&current_revision!==1)return null;
  return {record_type:type,...source,record_stage:'raw_sheet_source_snapshot',source_projection:'SPT account actors pseudonymized for export; other source values preserved',revision_state:current_revision===1?'current':'superseded',created_at_semantics:'app_observed_at_not_source_edit_time',source_snapshot:payload};
 }
 const isRevision=type==='entry'||type==='class_event',isCurrent=current_revision===1;
 const card=type==='entry'&&isCardKind(row.kind||'');
 const deleted=card&&current_deleted===1;
 if(view==='current'&&isRevision&&(!isCurrent||deleted))return null;
 const recordStage=type==='entry'?card?(payload.category==='studentSaid'?'student_self_report':payload.category==='next'?'teacher_follow_up':'teacher_observation'):
  ({observation:'teacher_observation_and_self_report',transcript:'unverified_transcript',transcript_edit:'teacher_transcript_correction',transcript_draft:'transcript_correction_draft',ai_draft:'ai_draft',review_draft:'teacher_review_draft',review:'teacher_review',recording_notice:'recording_status'} as Record<string,string>)[row.kind||'']||'unclassified':
  type==='class_event'?({activity:'activity_status',plan:'activity_plan',closeout:'progress_homework_closeout',report:'teacher_report'} as Record<string,string>)[row.kind||'']||'unclassified':type;
 return {record_type:type,...source,...(isRevision?{server_received_at:row.created_at,client_input_at:row.recorded_at_client??null,client_input_time_verified:false,actual_observation_at:null,base_revision_id:row.base_revision_id??null,source_schema_version:row.schema_version??null,revision_state:isCurrent?'current':'superseded',entity_deleted:deleted,record_stage:recordStage,confirmation_validity:'not_evaluated',teacher_confirmation_recorded:row.kind==='review'?payload.teacherConfirmed===true:row.kind==='closeout'||row.kind==='report'?payload.confirmed===true:null,...(row.kind==='report'?{teacher_confirmation_scope:'student_lesson_review',parent_text_review_status:'not_separately_recorded'}:{}),parent_delivery_evidence:row.kind==='report'&&payload.transferredAt?'teacher_marked_only':'none',payload}:{created_at_semantics:['audio_chunk','sheet_sync_receipt'].includes(type)?'server_received_at':'legacy_creation_time_source_not_separated'})};
}
