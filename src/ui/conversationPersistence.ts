/** Cogitor conversation-to-transcript mapping and resilient local persistence. */
import type { AIProvider } from '../../shared/types';
import {
  createConversationSession,
  loadConversationSessions,
  saveConversationSessionsWithQuotaRecovery,
  upsertConversationSession,
  type ConversationSession,
  type ConversationSessionMessage,
} from './conversationSessions';
import { recordEventLog } from '../diagnostics/eventLogStore';

export interface Bubble {
  id: string;
  provider?: AIProvider | 'system' | (string & {});
  authorLabel?: string;
  role: 'user' | 'ai';
  content: string;
  final?: boolean;
  truncated?: boolean;
  modeRole?: string;
  timestamp?: number;
}


export function initialConversationState(): { sessions: ConversationSession[]; active: ConversationSession } {
  const loaded = loadConversationSessions();
  const active = loaded[0] ?? createConversationSession();
  return { sessions: upsertConversationSession(loaded, active), active };
}

export function conversationMessages(messages: readonly Bubble[]): ConversationSessionMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.authorLabel ? { authorLabel: message.authorLabel } : {}),
    ...(message.modeRole ? { modeRole: message.modeRole } : {}),
    ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}),
    ...(typeof message.final === 'boolean' ? { final: message.final } : {}),
    ...(typeof message.truncated === 'boolean' ? { truncated: message.truncated } : {}),
  }));
}

export function persistConversationSessions(sessions: readonly ConversationSession[]): ConversationSession[] {
  const result = saveConversationSessionsWithQuotaRecovery(sessions);
  if (!result.saved) {
    recordEventLog({
      kind: 'workflow-error',
      summary: 'Conversation history save failed; recent messages may be lost on restart',
      detail: { sessions: sessions.length, reason: result.reason ?? 'unknown' },
    });
    return [...sessions];
  }
  if (result.evictedSessionIds.length > 0) {
    recordEventLog({
      kind: 'workflow-error',
      summary: 'Oldest conversation history was removed to stay within local storage quota',
      detail: { evictedSessionIds: result.evictedSessionIds.join(',') },
    });
  }
  return result.sessions;
}

export function bubblesFromSession(session: ConversationSession): Bubble[] {
  return session.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.authorLabel ? { authorLabel: message.authorLabel } : {}),
    ...(message.modeRole ? { modeRole: message.modeRole } : {}),
    ...(typeof message.timestamp === 'number' ? { timestamp: message.timestamp } : {}),
    ...(typeof message.final === 'boolean' ? { final: message.final } : {}),
    ...(typeof message.truncated === 'boolean' ? { truncated: message.truncated } : {}),
  }));
}

