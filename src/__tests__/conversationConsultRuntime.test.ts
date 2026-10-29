import { describe, expect, it } from 'vitest';
import type { AIProvider, BridgeMessage, ConsultRoles } from '../../shared/types';
import { publishBridgeMessage } from '../bridge/bus';
import { createConversationSession, type ConversationSession } from '../ui/conversationSessions';
import { ConversationDirectRuntime } from '../workflow/conversationDirectRuntime';
import type { IsolatedNativeTurnHost } from '../workflow/conversationDirectTurn';

function fixture() {
  let sessions: ConversationSession[] = [
    createConversationSession({ id: 'consult-a', mode: 'consult', presetId: 'consult', now: 1 }),
    createConversationSession({ id: 'consult-b', mode: 'consult', presetId: 'consult', now: 2 }),
  ];
  const pending = new Map<AIProvider, { turn: number; resolve: (response: string) => void }>();
  const sends: { provider: AIProvider; prompt: string }[] = [];
  let turn = 0;
  const transport: IsolatedNativeTurnHost = {
    reserveTurn() { return ++turn; },
    releaseTurn() {},
    waitForResponse(provider, reserved) {
      return new Promise((resolve) => pending.set(provider, { turn: reserved, resolve }));
    },
    rejectWaiter() {},
    setAwaiting() {},
    markInFlight() {},
    clearInFlight() {},
    async send(provider, prompt) { sends.push({ provider, prompt }); },
    async stop() {},
  };
  const runtime = new ConversationDirectRuntime({
    update(reducer) { sessions = reducer(sessions); },
  });
  const complete = (provider: AIProvider, response: string) => {
    const waiter = pending.get(provider);
    expect(waiter).toBeDefined();
    pending.delete(provider);
    const msg: BridgeMessage = {
      v: 1, action: 'RESPONSE_DONE', provider, transport: 'pull',
      bootId: `boot-${provider}`, payload: { text: response, turn: waiter!.turn },
    };
    publishBridgeMessage(msg);
    waiter!.resolve(response);
  };
  return {
    runtime, transport, sends, complete,
    messages(id: string) { return sessions.find((s) => s.id === id)?.messages ?? []; },
  };
}
const roles: ConsultRoles = {
  first: 'claude', second: 'gemini', reviewer: 'claude', summary: 'gemini',
};
async function tick() {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
}

describe('independently running Consult workflows', () => {
  it('runs the real four-step Consult graph prompts without a singleton workflow', async () => {
    const app = fixture();
    try {
      const job = app.runtime.startConsult({
        runId: 'consult-run', sessionId: 'consult-a',
        question: 'Explain four wheel drive', roles, locale: 'en',
        transport: app.transport, prepareProvider: async (provider) => `boot-${provider}`,
      });
      await tick();
      expect(app.sends.map((s) => s.provider)).toEqual(['claude', 'gemini']);
      app.complete('gemini', 'Initial Gemini');
      app.complete('claude', 'Initial Claude');
      await tick();
      expect(app.sends[2].provider).toBe('claude');
      expect(app.sends[2].prompt).toContain('Initial Gemini');
      expect(app.sends[2].prompt).toContain('Initial Claude');
      app.complete('claude', 'Review response');
      await tick();
      expect(app.sends[3].provider).toBe('gemini');
      expect(app.sends[3].prompt).toContain('Review response');
      app.complete('gemini', 'Final synthesis');
      expect((await job.finished).status).toBe('completed');
      const messages = app.messages('consult-a');
      expect(messages).toHaveLength(4);
      expect(messages.map((m) => m.content)).toEqual([
        'Initial Gemini', 'Initial Claude', 'Review response', 'Final synthesis',
      ]);
      expect(messages.map((m) => m.modeRole)).toEqual([
        expect.any(String), expect.any(String), expect.any(String), expect.any(String),
      ]);
      expect(app.messages('consult-b')).toHaveLength(0);
    } finally {
      app.runtime.dispose();
    }
  });

  it('queues overlapping Consult jobs until the first releases its provider leases', async () => {
    const app = fixture();
    try {
      const initial = app.runtime.startConsult({
        runId: 'first-run', sessionId: 'consult-a', roles,
        question: 'First topic', transport: app.transport,
        prepareProvider: async (provider) => `boot-${provider}`,
      });
      const subsequent = app.runtime.startConsult({
        runId: 'second-run', sessionId: 'consult-b', roles,
        question: 'Second topic', transport: app.transport,
        prepareProvider: async (provider) => `boot-${provider}-second`,
      });
      await tick();
      expect(app.runtime.snapshotForSession('consult-b')[0]?.status).toBe('queued');
      expect(app.sends.every((x) => x.prompt.includes('First topic'))).toBe(true);
      // Cancellation of the queued Consult must never stop the first.
      expect(app.runtime.cancel('second-run')).toBe(true);
      expect((await subsequent.finished).status).toBe('cancelled');
      app.complete('claude', 'First answer');
      app.complete('gemini', 'Second answer');
      await tick();
      app.complete('claude', 'Review');
      await tick();
      app.complete('gemini', 'Summary');
      expect((await initial.finished).status).toBe('completed');
      expect(app.messages('consult-b')).toHaveLength(0);
    } finally {
      app.runtime.dispose();
    }
  });

  it('rejects an invalid Consult configuration before touching any provider', () => {
    const app = fixture();
    try {
      expect(() => app.runtime.startConsult({
        runId: 'bad', sessionId: 'consult-a', question: 'Q',
        roles: { ...roles, second: 'claude' },
      })).toThrow('two independent initial providers');
      expect(app.sends).toHaveLength(0);
    } finally {
      app.runtime.dispose();
    }
  });
});
