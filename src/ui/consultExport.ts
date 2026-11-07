import { AI_PROVIDERS } from '../../shared/constants';
import type { ConversationSessionMessage } from './conversationSessions';

/** Copy a finished Consult's synthesis, not a partially streaming reply. */
export function consultFinalAnswer(messages: readonly ConversationSessionMessage[]): string | undefined {
  const answer = [...messages].reverse().find((message) => message.role === 'ai' && message.final === true && message.content.trim());
  return answer?.content;
}

/** Keep all provider roles and the original question in a portable plain-text copy. */
export function consultPlainText(messages: readonly ConversationSessionMessage[]): string {
  return messages.filter((message) => message.content.trim()).map((message) => {
    if (message.role === 'user') return `You\n\n${message.content}`;
    const provider = message.provider && message.provider in AI_PROVIDERS
      ? AI_PROVIDERS[message.provider as keyof typeof AI_PROVIDERS].name
      : message.provider ?? 'AI';
    return `${provider}${message.modeRole ? ` — ${message.modeRole}` : ''}\n\n${message.content}`;
  }).join('\n\n---\n\n');
}
