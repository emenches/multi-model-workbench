import { describe, expect, it } from 'vitest';
import type { AIProvider } from '../../shared/types';
import { ConversationExecutionScheduler } from '../workflow/conversationScheduler';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('conversation execution provider leases', () => {
  it('runs different conversations on disjoint providers simultaneously', async () => {
    const scheduler = new ConversationExecutionScheduler();
    const a = deferred(), b = deferred();
    const starts: string[] = [];
    const events: string[] = [];
    scheduler.subscribe((job) => events.push(`${job.sessionId}:${job.status}`));
    const first = scheduler.schedule({
      id: 'run-a', sessionId: 'chat-a', providers: ['claude'],
      async execute() { starts.push('a'); await a.promise; },
    });
    const second = scheduler.schedule({
      id: 'run-b', sessionId: 'chat-b', providers: ['gemini'],
      async execute() { starts.push('b'); await b.promise; },
    });
    await tick();
    expect(starts).toEqual(['a', 'b']);
    expect(scheduler.snapshot('run-a')?.status).toBe('running');
    expect(scheduler.snapshot('run-b')?.status).toBe('running');
    b.resolve();
    expect((await second.finished).status).toBe('completed');
    expect(scheduler.snapshot('run-a')?.status).toBe('running');
    a.resolve();
    expect((await first.finished).status).toBe('completed');
    expect(events).toContain('chat-a:completed');
    expect(events).toContain('chat-b:completed');
  });

  it('queues any overlapping provider and runs a non-conflicting later conversation', async () => {
    const scheduler = new ConversationExecutionScheduler();
    const a = deferred(), b = deferred();
    const starts: string[] = [];
    const schedule = (id: string, sessionId: string, providers: AIProvider[], promise: Promise<void>) =>
      scheduler.schedule({ id, sessionId, providers, async execute() { starts.push(id); await promise; } });
    const first = schedule('a', 'session-a', ['chatgpt', 'claude'], a.promise);
    const second = schedule('b', 'session-b', ['claude', 'gemini'], b.promise);
    const third = schedule('c', 'session-c', ['grok'], Promise.resolve());
    await tick();
    expect(starts).toEqual(['a', 'c']);
    expect(scheduler.snapshot('b')?.status).toBe('queued');
    expect((await third.finished).status).toBe('completed');
    a.resolve();
    expect((await first.finished).status).toBe('completed');
    await tick();
    expect(starts).toEqual(['a', 'c', 'b']);
    b.resolve();
    expect((await second.finished).status).toBe('completed');
  });

  it('keeps a cancelled running provider lease until its cleanup settles', async () => {
    const scheduler = new ConversationExecutionScheduler();
    const release = deferred();
    let signal: AbortSignal | undefined;
    let secondStarts = 0;
    const first = scheduler.schedule({
      id: 'first', sessionId: 'session-one', providers: ['claude'],
      async execute(abort) { signal = abort; await release.promise; },
    });
    const second = scheduler.schedule({
      id: 'second', sessionId: 'session-two', providers: ['claude'],
      async execute() { secondStarts += 1; },
    });
    await tick();
    expect(scheduler.cancel('first')).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(secondStarts).toBe(0);
    release.resolve();
    expect((await first.finished).status).toBe('cancelled');
    await tick();
    expect(secondStarts).toBe(1);
    expect((await second.finished).status).toBe('completed');
    expect(scheduler.cancel('first')).toBe(false);
  });

  it('cancels queued work without invoking the provider and leaves other conversations alone', async () => {
    const scheduler = new ConversationExecutionScheduler();
    const hold = deferred();
    let queuedStarted = false;
    const running = scheduler.schedule({
      id: 'run', sessionId: 'session-one', providers: ['gemini'],
      execute: async () => hold.promise,
    });
    const queued = scheduler.schedule({
      id: 'wait', sessionId: 'session-two', providers: ['gemini'],
      async execute() { queuedStarted = true; },
    });
    expect(scheduler.cancel('wait')).toBe(true);
    expect((await queued.finished).status).toBe('cancelled');
    hold.resolve();
    expect((await running.finished).status).toBe('completed');
    await tick();
    expect(queuedStarted).toBe(false);
  });

  it('rejects duplicate jobs and reports failures without leaking error messages', async () => {
    const scheduler = new ConversationExecutionScheduler();
    const first = scheduler.schedule({
      id: 'same', sessionId: 'a', providers: ['claude', 'claude'],
      async execute() { throw new Error('secret prompt text must not be logged'); },
    });
    expect(() => scheduler.schedule({
      id: 'same', sessionId: 'b', providers: ['gemini'], async execute() {},
    })).toThrow('Duplicate conversation job ID');
    expect(await first.finished).toMatchObject({
      id: 'same', sessionId: 'a', providers: ['claude'], status: 'failed', error: 'Error',
    });
    expect(JSON.stringify(scheduler.snapshots())).not.toContain('secret prompt');
  });

  it('prevents later jobs from cutting ahead of a blocked earlier job on the same provider', async () => {
    const scheduler = new ConversationExecutionScheduler();
    const a = deferred(), b = deferred();
    const calls: string[] = [];
    const first = scheduler.schedule({
      id: 'a', sessionId: 'a', providers: ['claude'],
      async execute() { calls.push('a'); await a.promise; },
    });
    const second = scheduler.schedule({
      id: 'b', sessionId: 'b', providers: ['claude', 'gemini'],
      async execute() { calls.push('b'); await b.promise; },
    });
    const third = scheduler.schedule({
      id: 'c', sessionId: 'c', providers: ['gemini'],
      async execute() { calls.push('c'); },
    });
    await tick();
    expect(calls).toEqual(['a']);
    a.resolve();
    await first.finished;
    await tick();
    expect(calls).toEqual(['a', 'b']);
    b.resolve();
    await second.finished;
    await tick();
    expect(calls).toEqual(['a', 'b', 'c']);
    expect((await third.finished).status).toBe('completed');
  });
});
