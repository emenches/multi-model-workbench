import { describe, expect, it } from 'vitest';
import type { AIProvider, BridgeMessage } from '../../shared/types';
import { createConversationSession, type ConversationSession } from '../ui/conversationSessions';
import { ConversationCoordinator } from '../workflow/conversationCoordinator';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function tick(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
const native = (provider: AIProvider, bootId: string, action: 'RESPONSE_CHUNK' | 'RESPONSE_DONE', text: string): BridgeMessage =>
  ({ v: 1, action, provider, transport: 'pull', bootId, payload: { text } });

function fixture() {
  let sessions = [
    createConversationSession({ id: 'conversation-a', now: 1 }),
    createConversationSession({ id: 'conversation-b', now: 2 }),
  ];
  let viewed = 'conversation-a';
  const coordinator = new ConversationCoordinator({
    update(reducer) { sessions = reducer(sessions); },
  });
  return {
    coordinator,
    setViewed(value: string) { viewed = value; },
    getViewed() { return viewed; },
    sessions(): ConversationSession[] { return sessions; },
    messages(id: string) { return sessions.find((session) => session.id === id)?.messages ?? []; },
  };
}

describe('conversation execution coordinator', () => {
  it('runs different providers concurrently and persists interleaved replies to owning chats while navigating', async () => {
    const app = fixture();
    const pauseA = deferred(), pauseB = deferred();
    const starts: string[] = [];
    const a = app.coordinator.schedule({
      runId: 'run-a', sessionId: 'conversation-a', providers: ['claude'],
      async prepareProvider() { return 'claude-new-boot'; },
      async execute({ claimTurn }) {
        starts.push('a');
        claimTurn('claude', 11);
        expect(app.coordinator.acceptBridgeMessage(native('claude', 'claude-new-boot', 'RESPONSE_CHUNK', 'part A'))).toBe(true);
        await pauseA.promise;
        app.coordinator.acceptBridgeMessage(native('claude', 'claude-new-boot', 'RESPONSE_DONE', 'final A'));
      },
    });
    const b = app.coordinator.schedule({
      runId: 'run-b', sessionId: 'conversation-b', providers: ['gemini'],
      async prepareProvider() { return 'gemini-new-boot'; },
      async execute({ claimTurn }) {
        starts.push('b');
        claimTurn('gemini', 12);
        await pauseB.promise;
        app.coordinator.acceptBridgeMessage(native('gemini', 'gemini-new-boot', 'RESPONSE_DONE', 'final B'));
      },
    });
    await tick();
    expect(starts).toEqual(['a', 'b']);
    expect(app.coordinator.status('run-a')?.status).toBe('running');
    expect(app.coordinator.status('run-b')?.status).toBe('running');
    app.setViewed('conversation-b');
    expect(app.getViewed()).toBe('conversation-b');
    expect(app.messages('conversation-a')[0]).toMatchObject({ content: 'part A', final: false });
    pauseB.resolve();
    expect((await b.finished).status).toBe('completed');
    expect(app.coordinator.status('run-a')?.status).toBe('running');
    pauseA.resolve();
    expect((await a.finished).status).toBe('completed');
    expect(app.messages('conversation-a')).toMatchObject([{ content: 'final A', final: true }]);
    expect(app.messages('conversation-b')).toMatchObject([{ content: 'final B', final: true }]);
  });

  it('requires new native boot before handing a shared provider to another conversation', async () => {
    const app = fixture();
    const holdA = deferred();
    const newNativeBoot = deferred<string>();
    const starts: string[] = [];
    const a = app.coordinator.schedule({
      runId: 'a', sessionId: 'conversation-a', providers: ['claude'],
      async prepareProvider() { return 'boot-a'; },
      async execute() { starts.push('a'); await holdA.promise; },
    });
    const b = app.coordinator.schedule({
      runId: 'b', sessionId: 'conversation-b', providers: ['claude'],
      async prepareProvider() { return newNativeBoot.promise; },
      async execute() {
        starts.push('b');
        expect(app.coordinator.acceptBridgeMessage(native('claude', 'boot-b', 'RESPONSE_DONE', 'safe B'))).toBe(true);
      },
    });
    await tick();
    expect(starts).toEqual(['a']);
    expect(app.coordinator.status('b')?.status).toBe('queued');
    holdA.resolve();
    await a.finished;
    await tick();
    expect(app.coordinator.status('b')?.status).toBe('running');
    expect(starts).toEqual(['a']);
    expect(app.coordinator.acceptBridgeMessage(native('claude', 'boot-a', 'RESPONSE_DONE', 'stale A'))).toBe(false);
    newNativeBoot.resolve('boot-b');
    expect((await b.finished).status).toBe('completed');
    expect(app.messages('conversation-a')).toHaveLength(0);
    expect(app.messages('conversation-b')).toMatchObject([{ content: 'safe B' }]);
  });

  it('does not let cancelling one running conversation terminate another', async () => {
    const app = fixture();
    const pausedA = deferred(), pausedB = deferred();
    const a = app.coordinator.schedule({
      runId: 'cancel-a', sessionId: 'conversation-a', providers: ['claude'],
      async prepareProvider() { return 'a-boot'; },
      async execute({ signal }) { await pausedA.promise; expect(signal.aborted).toBe(true); },
    });
    const b = app.coordinator.schedule({
      runId: 'keep-b', sessionId: 'conversation-b', providers: ['gemini'],
      async prepareProvider() { return 'b-boot'; },
      async execute({ signal }) { await pausedB.promise; expect(signal.aborted).toBe(false); },
    });
    await tick();
    expect(app.coordinator.cancel('cancel-a')).toBe(true);
    expect(app.coordinator.status('keep-b')?.status).toBe('running');
    pausedA.resolve();
    expect((await a.finished).status).toBe('cancelled');
    pausedB.resolve();
    expect((await b.finished).status).toBe('completed');
  });

  it('rejects an empty or previously used native boot without executing the request', async () => {
    const app = fixture();
    let sends = 0;
    const a = app.coordinator.schedule({
      runId: 'run-a', sessionId: 'conversation-a', providers: ['claude'],
      async prepareProvider() { return ''; },
      async execute() { sends += 1; },
    });
    const result = await a.finished;
    expect(result.status).toBe('failed');
    expect(sends).toBe(0);
    expect(app.messages('conversation-a')).toHaveLength(0);
  });
});
