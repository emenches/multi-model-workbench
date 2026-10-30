import { describe, expect, it } from 'vitest';
import type { BridgeMessage } from '../../shared/types';
import { createConversationSession } from '../ui/conversationSessions';
import { ConversationRunRouter } from '../workflow/conversationRunRouter';
import { ConversationTranscriptInbox } from '../workflow/conversationTranscriptInbox';

function bridge(action: BridgeMessage['action'], provider: 'claude' | 'gemini', text: string): BridgeMessage {
  return { v: 1, action, provider, transport: 'pull', bootId: provider === 'claude' ? 'boot-a' : 'boot-b', payload: { text } } as BridgeMessage;
}

describe('background conversation transcript ownership', () => {
  it('stores interleaved chunks and final answers with the right conversation while viewing another', () => {
    const sessionA = createConversationSession({ id: 'a', now: 100 });
    const sessionB = createConversationSession({ id: 'b', now: 101 });
    const router = new ConversationRunRouter();
    const inbox = new ConversationTranscriptInbox();
    router.registerRun({ runId: 'ra', sessionId: 'a' });
    router.registerRun({ runId: 'rb', sessionId: 'b' });
    router.claimProvider('ra', 'claude');
    router.claimProvider('rb', 'gemini');
    router.confirmFreshProviderSession('ra', 'claude', 'boot-a');
    router.confirmFreshProviderSession('rb', 'gemini', 'boot-b');
    let sessions = [sessionA, sessionB];

    const a1 = router.route(bridge('RESPONSE_CHUNK', 'claude', 'partial A'))!;
    sessions = inbox.apply(sessions, a1, 200);
    const b1 = router.route(bridge('RESPONSE_CHUNK', 'gemini', 'partial B'))!;
    sessions = inbox.apply(sessions, b1, 201);
    sessions = inbox.apply(sessions, router.route(bridge('RESPONSE_DONE', 'gemini', 'final B'))!, 202);
    sessions = inbox.apply(sessions, router.route(bridge('RESPONSE_DONE', 'claude', 'final A'))!, 203);

    expect(sessions.find((item) => item.id === 'a')?.messages).toMatchObject([{
      provider: 'claude', content: 'final A', final: true, timestamp: 200,
    }]);
    expect(sessions.find((item) => item.id === 'b')?.messages).toMatchObject([{
      provider: 'gemini', content: 'final B', final: true, timestamp: 201,
    }]);
    expect(sessions.find((item) => item.id === 'a')?.messages).toHaveLength(1);
    expect(sessions.find((item) => item.id === 'b')?.messages).toHaveLength(1);

    inbox.finishRun('ra');
    router.finishRun('ra');
    expect(router.route(bridge('RESPONSE_DONE', 'claude', 'stale'))).toBeUndefined();
    expect(sessions.find((item) => item.id === 'a')?.messages[0].content).toBe('final A');
  });

  it('drops events for removed sessions instead of attaching them to currently viewed chat', () => {
    const router = new ConversationRunRouter();
    const inbox = new ConversationTranscriptInbox();
    router.registerRun({ runId: 'removed-run', sessionId: 'removed' });
    router.claimProvider('removed-run', 'claude');
    router.confirmFreshProviderSession('removed-run', 'claude', 'boot-a');
    const existing = createConversationSession({ id: 'still-open', now: 1 });
    const events = router.route(bridge('RESPONSE_CHUNK', 'claude', 'do not misroute'))!;
    expect(inbox.apply([existing], events)).toEqual([existing]);
  });
});
