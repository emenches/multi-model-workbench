import type { AIProvider } from '../../shared/types';
import type { ConversationSession, ConversationSessionMessage } from '../ui/conversationSessions';
import { upsertConversationSession } from '../ui/conversationSessions';
import { createConversationMessageId } from '../ui/conversationContinuity';
import type { RoutedConversationMessage } from './conversationRunRouter';

interface ActiveAnswer {
  messageId: string;
  label?: string;
}

/**
 * Merges validated, run-owned native reply events into the owning saved
 * conversation rather than the currently viewed transcript.
 *
 * Receives only events already authorized by ConversationRunRouter. App may
 * project the selected conversation from this durable data model at any time.
 */
export class ConversationTranscriptInbox {
  private readonly active = new Map<string, Map<AIProvider, ActiveAnswer>>();

  apply(
    sessions: readonly ConversationSession[],
    { owner, message }: RoutedConversationMessage,
    now = Date.now(),
  ): ConversationSession[] {
    const session = sessions.find((item) => item.id === owner.sessionId);
    if (!session || !message.provider) return [...sessions];
    if (message.action !== 'ROLE_ASSIGNMENT' &&
        message.action !== 'RESPONSE_CHUNK' &&
        message.action !== 'RESPONSE_DONE') {
      return [...sessions];
    }

    let providers = this.active.get(owner.runId);
    if (!providers) {
      providers = new Map();
      this.active.set(owner.runId, providers);
    }
    const provider = message.provider;
    if (message.action === 'ROLE_ASSIGNMENT') {
      const label = (message.payload as { label?: unknown } | undefined)?.label;
      providers.set(provider, {
        messageId: providers.get(provider)?.messageId ?? createConversationMessageId('ai'),
        ...(typeof label === 'string' && label ? { label } : {}),
      });
      return [...sessions];
    }

    let answer = providers.get(provider);
    if (!answer) {
      answer = { messageId: createConversationMessageId('ai') };
      providers.set(provider, answer);
    }
    const content = typeof message.payload === 'string' ? message.payload
      : message.payload && typeof message.payload === 'object'
        ? (message.payload as { text?: unknown }).text
        : '';
    if (typeof content !== 'string') return [...sessions];
    const truncated = Boolean(message.payload && typeof message.payload === 'object' &&
      (message.payload as { truncated?: unknown }).truncated === true);
    const existing = session.messages.find((item) => item.id === answer!.messageId);
    const updated: ConversationSessionMessage = {
      ...(existing ?? {}),
      id: answer.messageId,
      role: 'ai',
      provider,
      ...(answer.label ? { modeRole: answer.label } : {}),
      content,
      timestamp: existing?.timestamp ?? now,
      truncated,
      final: message.action === 'RESPONSE_DONE',
    };
    const nextMessages = existing
      ? session.messages.map((item) => item.id === answer!.messageId ? updated : item)
      : [...session.messages, updated];
    if (message.action === 'RESPONSE_DONE') providers.delete(provider);

    return upsertConversationSession(sessions, {
      ...session,
      messages: nextMessages,
      updatedAt: Math.max(now, session.updatedAt),
    });
  }

  finishRun(runId: string): void {
    this.active.delete(runId);
  }
}
