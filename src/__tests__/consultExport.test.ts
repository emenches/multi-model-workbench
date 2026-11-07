import { describe, expect, it } from 'vitest';
import { consultFinalAnswer, consultPlainText } from '../ui/consultExport';
import type { ConversationSessionMessage } from '../ui/conversationSessions';

const messages: ConversationSessionMessage[] = [
  { id: 'q', role: 'user', content: 'What should I build?', final: true },
  { id: 'a', role: 'ai', provider: 'claude', modeRole: 'First', content: 'First draft', final: true },
  { id: 'b', role: 'ai', provider: 'gemini', modeRole: 'Second', content: 'Second draft', final: true },
  { id: 'r', role: 'ai', provider: 'claude', modeRole: 'Reviewer', content: 'Reviewed', final: true },
  { id: 's', role: 'ai', provider: 'gemini', modeRole: 'Summary', content: 'Final synthesis', final: true },
];

describe('Consult copy helpers', () => {
  it('copies the last completed synthesis, not the preceding review', () => {
    expect(consultFinalAnswer(messages)).toBe('Final synthesis');
    expect(consultFinalAnswer([...messages, { id: 'pending', role: 'ai', content: 'Partial', final: false }])).toBe('Final synthesis');
    expect(consultFinalAnswer(messages.slice(0, 1))).toBeUndefined();
  });

  it('copies all agents, roles and the original question as plain text', () => {
    const output = consultPlainText(messages);
    expect(output).toContain('You\n\nWhat should I build?');
    expect(output).toContain('Claude — Reviewer\n\nReviewed');
    expect(output).toContain('Gemini — Summary\n\nFinal synthesis');
  });
});
