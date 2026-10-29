import { describe, expect, it } from 'vitest';
import type { BridgeMessage } from '../../shared/types';
import { ConversationRunRouter } from '../workflow/conversationRunRouter';

function message(action: BridgeMessage['action'], provider: 'claude' | 'gemini', turn?: number): BridgeMessage {
  return {
    v: 1, action, provider, transport: 'pull',
    payload: typeof turn === 'number' ? { text: 'reply', turn } : { text: 'reply' },
  } as BridgeMessage;
}

describe('per-conversation event ownership', () => {
  it('routes replies by run owner independently of which history is being viewed', () => {
    const router = new ConversationRunRouter();
    router.registerRun({ runId: 'run-one', sessionId: 'conversation-one' });
    router.registerRun({ runId: 'run-two', sessionId: 'conversation-two' });
    router.claimProvider('run-one', 'claude', 4);
    router.claimProvider('run-two', 'gemini', 8);
    expect(router.route(message('RESPONSE_CHUNK', 'claude', 4))?.owner.sessionId).toBe('conversation-one');
    expect(router.route(message('RESPONSE_DONE', 'gemini', 8))?.owner.sessionId).toBe('conversation-two');
    expect(router.route(message('RESPONSE_DONE', 'claude', 5))).toBeUndefined();
    expect(router.route(message('STATUS_REPORT', 'claude'))).toBeUndefined();
  });

  it('rejects another run claiming a busy provider, even if a previous turn finished', () => {
    const router = new ConversationRunRouter();
    router.registerRun({ runId: 'one', sessionId: 'a' });
    router.registerRun({ runId: 'two', sessionId: 'b' });
    router.claimProvider('one', 'claude', 1);
    expect(() => router.claimProvider('two', 'claude', 2)).toThrow('Provider is already claimed');
    router.releaseProvider('two', 'claude');
    expect(router.ownerForProvider('claude')?.runId).toBe('one');
    router.finishRun('one');
    expect(router.route(message('RESPONSE_DONE', 'claude', 1))).toBeUndefined();
    router.claimProvider('two', 'claude', 2);
    expect(router.route(message('RESPONSE_DONE', 'claude', 2))?.owner.sessionId).toBe('b');
  });

  it('does not allow a run ID to be rebound to a different session', () => {
    const router = new ConversationRunRouter();
    router.registerRun({ runId: 'job', sessionId: 'first' });
    expect(() => router.registerRun({ runId: 'job', sessionId: 'second' })).toThrow();
    expect(() => router.claimProvider('unknown', 'claude')).toThrow();
  });
});
