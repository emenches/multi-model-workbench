import { describe, expect, it } from 'vitest';
import type { AIProvider, BridgeMessage } from '../../shared/types';
import { publishBridgeMessage } from '../bridge/bus';
import { createConversationSession, type ConversationSession } from '../ui/conversationSessions';
import { ConversationDirectRuntime } from '../workflow/conversationDirectRuntime';
import type { IsolatedNativeTurnHost } from '../workflow/conversationDirectTurn';

function fakeNative() {
  const pending = new Map<AIProvider, { resolve: (answer: string) => void; reject: (error: Error) => void }>();
  const started: AIProvider[] = [];
  const stopped: AIProvider[] = [];
  let turn = 0;
  const transport: IsolatedNativeTurnHost = {
    reserveTurn() { return ++turn; },
    waitForResponse(provider) {
      return new Promise((resolve, reject) => { pending.set(provider, { resolve, reject }); });
    },
    rejectWaiter(provider, _turn, error) { pending.get(provider)?.reject(error); },
    setAwaiting() {},
    markInFlight() {},
    clearInFlight() {},
    async send(provider) { started.push(provider); },
    async stop(provider) { stopped.push(provider); },
  };
  return { transport, started, stopped, complete(provider: AIProvider, response: string) {
    pending.get(provider)?.resolve(response);
  } };
}
const pulled = (provider: AIProvider, bootId: string, action: 'RESPONSE_CHUNK' | 'RESPONSE_DONE', text: string): BridgeMessage =>
  ({ v: 1, action, provider, bootId, transport: 'pull', payload: { text } });

async function flush(): Promise<void> {
  for (let n = 0; n < 12; n += 1) await Promise.resolve();
}

describe('direct concurrent conversation runtime', () => {
  it('completes two independent background chats with real session-owned event persistence', async () => {
    let sessions: ConversationSession[] = [
      createConversationSession({ id: 'chat-a', now: 1 }),
      createConversationSession({ id: 'chat-b', now: 2 }),
    ];
    const store = { update(reducer: (saved: readonly ConversationSession[]) => ConversationSession[]) {
      sessions = reducer(sessions);
    } };
    const native = fakeNative();
    const runtime = new ConversationDirectRuntime(store);
    try {
      const first = runtime.start({
        runId: 'run-a', sessionId: 'chat-a', providers: ['claude'],
        prompt: 'A', prepareProvider: async () => 'boot-claude', transport: native.transport,
      });
      const second = runtime.start({
        runId: 'run-b', sessionId: 'chat-b', providers: ['gemini'],
        prompt: 'B', prepareProvider: async () => 'boot-gemini', transport: native.transport,
      });
      await flush();
      expect(native.started).toEqual(['claude', 'gemini']);
      expect(runtime.snapshotForSession('chat-a')[0]?.status).toBe('running');
      expect(runtime.snapshotForSession('chat-b')[0]?.status).toBe('running');

      publishBridgeMessage(pulled('claude', 'boot-claude', 'RESPONSE_CHUNK', 'A partial'));
      publishBridgeMessage(pulled('gemini', 'boot-gemini', 'RESPONSE_DONE', 'B answer'));
      native.complete('gemini', 'B answer');
      expect((await second.finished).status).toBe('completed');
      publishBridgeMessage(pulled('claude', 'boot-claude', 'RESPONSE_DONE', 'A answer'));
      native.complete('claude', 'A answer');
      expect((await first.finished).status).toBe('completed');

      expect(sessions.find((s) => s.id === 'chat-a')?.messages).toMatchObject([
        { content: 'A answer', provider: 'claude', final: true },
      ]);
      expect(sessions.find((s) => s.id === 'chat-b')?.messages).toMatchObject([
        { content: 'B answer', provider: 'gemini', final: true },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it('stops only the cancelled provider while unrelated conversation finishes', async () => {
    let sessions: ConversationSession[] = [
      createConversationSession({ id: 'a', now: 1 }),
      createConversationSession({ id: 'b', now: 2 }),
    ];
    const native = fakeNative();
    const runtime = new ConversationDirectRuntime({
      update(reducer) { sessions = reducer(sessions); },
    });
    try {
      const first = runtime.start({
        runId: 'a', sessionId: 'a', providers: ['claude'],
        prompt: 'A', prepareProvider: async () => 'a-boot', transport: native.transport,
      });
      const second = runtime.start({
        runId: 'b', sessionId: 'b', providers: ['gemini'],
        prompt: 'B', prepareProvider: async () => 'b-boot', transport: native.transport,
      });
      await flush();
      expect(runtime.cancel('a')).toBe(true);
      expect((await first.finished).status).toBe('cancelled');
      expect(native.stopped).toEqual(['claude']);
      publishBridgeMessage(pulled('gemini', 'b-boot', 'RESPONSE_DONE', 'B still completes'));
      native.complete('gemini', 'B still completes');
      expect((await second.finished).status).toBe('completed');
      expect(sessions.find((item) => item.id === 'b')?.messages[0]?.content).toBe('B still completes');
    } finally {
      runtime.dispose();
    }
  });
});
