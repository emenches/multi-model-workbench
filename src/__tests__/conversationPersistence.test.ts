import { describe, expect, it } from 'vitest';
import { createConversationSession } from '../ui/conversationSessions';
import { bubblesFromSession, conversationMessages, type Bubble } from '../ui/conversationPersistence';

describe('conversation persistence boundary', () => {
  it('round-trips provider attribution, role, timestamp and capture metadata without mutation', () => {
    const bubbles: Bubble[] = [
      { id: 'u1', role: 'user', content: 'Original question', timestamp: 10 },
      { id: 'a1', role: 'ai', provider: 'claude', authorLabel: 'Claude',
        modeRole: 'reviewer', content: 'Partial response', timestamp: 20,
        final: false, truncated: true },
      { id: 'a2', role: 'ai', provider: 'system', content: 'Completed', final: true },
    ];
    const before = JSON.stringify(bubbles);
    const stored = conversationMessages(bubbles);
    expect(stored).toEqual(bubbles);
    expect(JSON.stringify(bubbles)).toBe(before);

    const session = createConversationSession({ id: 'conversation-1', now: 100, messages: stored });
    expect(bubblesFromSession(session)).toEqual(bubbles);
    expect(session.messages).toEqual(stored);
  });

  it('does not invent optional capture fields when serializing legacy messages', () => {
    const stored = conversationMessages([{ id: 'legacy', role: 'ai', content: 'Older reply' }]);
    expect(stored).toEqual([{ id: 'legacy', role: 'ai', content: 'Older reply' }]);
    expect(bubblesFromSession(createConversationSession({ messages: stored, now: 100 }))).toEqual(stored);
  });
});
