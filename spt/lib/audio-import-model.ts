export const AUDIO_IMPORT_PART_BYTES=1048576;
export const AUDIO_IMPORT_MAX_BYTES=67108864;
export const VOICE_MEMO_SHORTCUT_NAME='SPT 녹음';
// Apple's documented Shortcuts URL scheme. The user's own one-action shortcut
// must actually be installed/verified; this is not an invented Voice Memos URI.
export const voiceMemoShortcutURL=()=>`shortcuts://run-shortcut?name=${encodeURIComponent(VOICE_MEMO_SHORTCUT_NAME)}`;
export type AudioImportState='prepared'|'uploading'|'processing'|'stored'|'transcribed'|'invalid'|'unknown';
export type ImportTranscription={state:'available'|'not_found'|'needs_review';entryIds:string[]};
export type ImportOperation='finalize'|'transcribe'|'recover';
export type ImportProcessor={ready:boolean;transcribeAllowed:boolean;reason:'permitted'|'disabled'|'exhausted'|'stopped'|'unavailable'};
export type AudioImport={id:string;session_id:string;filename:string|null;mime:string|null;size:number|null;status:AudioImportState;created_at:string;updated_at:string;duration:number|null;attempt_id:string|null;transcript_id:string|null;error:string|null;transcription?:ImportTranscription;receivedParts?:number[];parts?:{seq:number;size:number;hash:string}[];student_id?:string;class_date?:string;session_title?:string;session_purpose?:string};
