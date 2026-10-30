import { describe, expect, it } from 'vitest';
import type { BridgeMessage } from '../../shared/types';
import { ConversationRunRouter } from '../workflow/conversationRunRouter';

function message(action: BridgeMessage['action'], provider: 'claude' | 'gemini', turn?: number, bootId = provider === 'claude' ? 'claude-boot-one' : 'gemini-boot-one'): BridgeMessage {
  return {
    v: 1, action, provider, bootId, transport: 'pull',
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
    // Even the first run needs a fresh, confirmed native conversation.
    expect(router.route(message('RESPONSE_DONE', 'claude', 4))).toBeUndefined();
    expect(router.confirmFreshProviderSession('run-one', 'claude', 'claude-boot-one')).toBe(true);
    expect(router.confirmFreshProviderSession('run-two', 'gemini', 'gemini-boot-one')).toBe(true);
    expect(router.route(message('RESPONSE_CHUNK', 'claude', 4))?.owner.sessionId).toBe('conversation-one');
    expect(router.route(message('RESPONSE_DONE', 'gemini', 8))?.owner.sessionId).toBe('conversation-two');
    expect(router.route(message('RESPONSE_DONE', 'claude', 5))).toBeUndefined();
    expect(router.route(message('RESPONSE_DONE', 'claude', 4, 'stale-document'))).toBeUndefined();
    expect(router.route({ ...message('RESPONSE_DONE', 'claude', 4), bootId: undefined })).toBeUndefined();
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
    // The same native provider tab may still emit a late, untagged reply.
    // Do not deliver it to a new conversation until the host proves a new
    // document/conversation has been established.
    expect(router.route(message('RESPONSE_DONE', 'claude'))).toBeUndefined();
    expect(router.confirmFreshProviderSession('two', 'claude', '')).toBe(false);
    expect(router.confirmFreshProviderSession('two', 'claude', 'fresh-native-boot')).toBe(true);
    expect(router.route(message('RESPONSE_DONE', 'claude', 2, 'fresh-native-boot'))?.owner.sessionId).toBe('b');
  });



  it('requires a new provider boot when a known session changes ownership', () => {
    const router = new ConversationRunRouter();
    router.registerRun({ runId: 'one', sessionId: 'a' });
    router.registerRun({ runId: 'two', sessionId: 'b' });
    router.registerRun({ runId: 'three', sessionId: 'c' });
    router.claimProvider('one', 'claude');
    expect(router.confirmFreshProviderSession('one', 'claude', 'boot-one')).toBe(true);
    router.finishRun('one');
    router.claimProvider('two', 'claude');
    expect(router.confirmFreshProviderSession('two', 'claude', 'boot-two')).toBe(true);
    router.finishRun('two');
    router.claimProvider('three', 'claude');
    expect(router.confirmFreshProviderSession('three', 'claude', 'boot-two')).toBe(false);
    expect(router.route(message('RESPONSE_DONE', 'claude'))).toBeUndefined();
    expect(router.confirmFreshProviderSession('three', 'claude', 'boot-three')).toBe(true);
    expect(router.route(message('RESPONSE_DONE', 'claude', undefined, 'boot-three'))?.owner.sessionId).toBe('c');
  });

  it('does not allow a run ID to be rebound to a different session', () => {
    const router = new ConversationRunRouter();
    router.registerRun({ runId: 'job', sessionId: 'first' });
    expect(() => router.registerRun({ runId: 'job', sessionId: 'second' })).toThrow();
    expect(() => router.claimProvider('unknown', 'claude')).toThrow();
  });
});
