import { describe, expect, it } from 'vitest';
import type { AIProvider } from '../../shared/types';
import type { ConversationWorkContext } from '../workflow/conversationCoordinator';
import { executeIsolatedNativeTurn, type IsolatedNativeTurnHost } from '../workflow/conversationDirectTurn';

function transport() {
  const pending = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>();
  const sends: string[] = [];
  const stops: string[] = [];
  const awaiting: string[] = [];
  let nextTurn = 0;
  const host: IsolatedNativeTurnHost = {
    reserveTurn() { nextTurn += 1; return nextTurn; },
    releaseTurn() {},
    waitForResponse(provider, turn) {
      return new Promise((resolve, reject) => pending.set(`${provider}:${turn}`, { resolve, reject }));
    },
    rejectWaiter(provider, turn, reason) { pending.get(`${provider}:${turn}`)?.reject(reason); },
    setAwaiting(provider, active) { awaiting.push(`${provider}:${active}`); },
    markInFlight() {},
    clearInFlight() {},
    async send(provider, text) { sends.push(`${provider}:${text}`); },
    async stop(provider) { stops.push(provider); },
  };
  return { host, sends, stops, awaiting, complete(provider: AIProvider, turn: number, response: string) {
    pending.get(`${provider}:${turn}`)?.resolve(response);
  } };
}

function context(id: string, provider: AIProvider, controller = new AbortController()) {
  const claims: number[] = [];
  const scope: ConversationWorkContext = {
    owner: { runId: id, sessionId: `session-${id}` },
    signal: controller.signal, providers: [provider],
    claimTurn(requestedProvider, turn) {
      if (requestedProvider !== provider) throw new Error('Provider is not leased');
      claims.push(turn);
    },
  };
  return { scope, controller, claims };
}

describe('isolated native conversation turns', () => {
  it('runs two independent native sends without mixing provider response promises', async () => {
    const fake = transport();
    const a = context('one', 'claude');
    const b = context('two', 'gemini');
    const first = executeIsolatedNativeTurn(a.scope, 'claude', 'Question A', fake.host);
    const second = executeIsolatedNativeTurn(b.scope, 'gemini', 'Question B', fake.host);
    expect(fake.sends).toEqual(['claude:Question A', 'gemini:Question B']);
    expect(a.claims).toEqual([1]);
    expect(b.claims).toEqual([2]);
    fake.complete('gemini', 2, 'Answer B');
    expect(await second).toEqual({ turn: 2, response: 'Answer B' });
    fake.complete('claude', 1, 'Answer A');
    expect(await first).toEqual({ turn: 1, response: 'Answer A' });
    expect(fake.stops).toEqual([]);
  });

  it('cancels only the running conversation and preserves an unrelated send', async () => {
    const fake = transport();
    const a = context('one', 'claude');
    const b = context('two', 'gemini');
    const first = executeIsolatedNativeTurn(a.scope, 'claude', 'A', fake.host);
    const second = executeIsolatedNativeTurn(b.scope, 'gemini', 'B', fake.host);
    // Attach rejection observer before abort so the test never treats an
    // expected cancellation as an unhandled promise rejection.
    const cancelled = expect(first).rejects.toThrow('Conversation cancelled');
    a.controller.abort();
    await cancelled;
    fake.complete('gemini', 2, 'B done');
    expect((await second).response).toBe('B done');
    expect(fake.stops).toEqual(['claude']);
    expect(fake.awaiting).toContain('gemini:false');
  });

  it('fails closed on an unleased provider without sending a prompt', async () => {
    const fake = transport();
    const a = context('one', 'claude');
    await expect(executeIsolatedNativeTurn(a.scope, 'gemini', 'Do not send', fake.host))
      .rejects.toThrow('Provider is not leased');
    expect(fake.sends).toEqual([]);
  });
});
