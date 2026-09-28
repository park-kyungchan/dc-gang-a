// Pure proposal parsing: no network, storage or classroom mutation.
import {z} from 'zod';
import {uuid, type Entry} from './notebook';

const evidenceId = z.string().refine(uuid);
const uniqueIds = z.array(evidenceId).min(1).max(1000).refine(ids => new Set(ids).size === ids.length);
const candidate = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
  kind: z.enum(['activity', 'progress', 'homework', 'followup']),
  text: z.string().min(1).max(6000).refine(text => text.trim().length > 0),
  attribution: z.enum(['teacher_statement', 'student_report', 'inference', 'uncertain']),
  evidenceIds: uniqueIds,
  uncertainty: z.string().max(2000),
}).strict();

export const conversationDraftSchema = z.object({
  protocol: z.literal('spt.conversation-draft.v1'),
  basisEntryIds: uniqueIds,
  candidates: z.array(candidate).min(1).max(20).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict();
export type ConversationDraft = z.infer<typeof conversationDraftSchema>;
export type ConversationDraftView =
  | {state: 'ready' | 'stale'; draft: ConversationDraft; sources: Map<string, Entry>}
  | {state: 'invalid'; reason: 'format' | 'evidence'}
  | null;

export function transcriptText(entry: Entry): string {
  try {
    const value = JSON.parse(entry.body) as {text?: unknown};
    return typeof value.text === 'string' ? value.text : '';
  } catch {return '';}
}

/** Entry/session/evidence identities are authoritative, never model-supplied names.
 * Legacy free-form ai_draft text remains in the existing raw/history surface.
 * A structurally eligible draft is still an unconfirmed proposal, not an action.
 */
export function readConversationDraft(entry: Entry | undefined, events: Entry[], sessionId: string): ConversationDraftView {
  if (!entry) return null;
  if (entry.kind !== 'ai_draft' || entry.session_id !== sessionId) return {state: 'invalid', reason: 'evidence'};
  const text = transcriptText(entry);
  if (text.length > 100000) return {state: 'invalid', reason: 'format'};
  let value: unknown;
  try {value = JSON.parse(text);} catch {return null;}
  if (!value || typeof value !== 'object' || !('protocol' in value) || typeof value.protocol !== 'string' || !value.protocol.startsWith('spt.conversation-draft.')) return null;
  const parsed = conversationDraftSchema.safeParse(value);
  if (!parsed.success) return {state: 'invalid', reason: 'format'};
  const sources = new Map(events.filter(e => e.session_id === sessionId && ['transcript', 'transcript_edit'].includes(e.kind) && transcriptText(e).trim()).map(e => [e.id, e]));
  const basis = new Set(parsed.data.basisEntryIds);
  if ([...basis].some(id => !sources.has(id)) || parsed.data.candidates.some(c => c.evidenceIds.some(id => !basis.has(id)))) return {state: 'invalid', reason: 'evidence'};
  // A delayed transcript or later correction never silently keeps an old draft current.
  const stale = sources.size !== basis.size;
  return {state: stale ? 'stale' : 'ready', draft: parsed.data, sources};
}
