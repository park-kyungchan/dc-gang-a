/**
 * Agent-agnostic lifecycle hook types.
 * Translates Antigravity-specific PreToolUse/PostToolUse/Stop into semantic event names.
 */

/** Semantic event name — never use runtime-specific keys (PreToolUse, PostToolUse, Stop) */
export type HookEventType = 'pre-mutate' | 'post-execute' | 'session-stop';

export interface AgentHook {
  readonly id: string;
  readonly eventType: HookEventType;
  readonly triggerPattern: string; // tool name glob, e.g. "write_to_file|replace_file_content|run_command"
  readonly handlerCommand: string; // opaque command string (runtime-specific)
  readonly timeoutMs: number;
  readonly enabled: boolean;
  readonly description: string;
}
