import { describe, expect, it } from 'vitest';
import type { BridgeMessage } from '../../shared/types';
import {
  prepareFreshNativeConversation,
  type NativeConversationSessionDependencies,
} from '../workflow/conversationNativeSession';

const status = (provider: 'claude' | 'gemini', bootId: string): BridgeMessage =>
  ({ v: 1, action: 'STATUS_REPORT', provider, bootId, transport: 'title',
    payload: { dom: 'ready', login: 'logged_in' } });

describe('fresh native provider conversations', () => {
  it('requires the native command to succeed and observes a genuinely new bridge boot', async () => {
    let observed = 'old-boot';
    let listener: (message: BridgeMessage) => void = () => {};
    let unsubscribed = false;
    const dependencies: NativeConversationSessionDependencies = {
      lastObservedBoot: () => observed,
      subscribe(callback) { listener = callback; return () => { unsubscribed = true; }; },
      async startNewSession(provider) {
        expect(provider).toBe('claude');
        listener(status('gemini', 'unrelated-boot'));
        listener(status('claude', 'old-boot'));
        observed = 'new-boot';
        listener(status('claude', observed));
      },
    };
    const result = await prepareFreshNativeConversation('claude', new AbortController().signal, dependencies);
    expect(result).toBe('new-boot');
    expect(unsubscribed).toBe(true);
  });

  it('rejects an unchanged bridge boot and never treats a URL alone as authentication', async () => {
    const dependencies: NativeConversationSessionDependencies = {
      lastObservedBoot: () => 'same-boot',
      subscribe() { return () => {}; },
      async startNewSession() {},
    };
    await expect(prepareFreshNativeConversation('claude', new AbortController().signal, dependencies, 1))
      .rejects.toThrow('did not publish a fresh bridge boot');
  });

  it('does not accept a fresh boot if native did not complete its safety checks', async () => {
    let listener: (message: BridgeMessage) => void = () => {};
    let unsubscribed = false;
    const dependencies: NativeConversationSessionDependencies = {
      lastObservedBoot: () => 'old',
      subscribe(callback) { listener = callback; return () => { unsubscribed = true; }; },
      async startNewSession() {
        listener(status('claude', 'new'));
        throw new Error('native new session rejected');
      },
    };
    await expect(prepareFreshNativeConversation('claude', new AbortController().signal, dependencies))
      .rejects.toThrow('native new session rejected');
    expect(unsubscribed).toBe(true);
  });

  it('aborts before native navigation when the user cancels a queued request', async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    const dependencies: NativeConversationSessionDependencies = {
      lastObservedBoot: () => 'old',
      subscribe() { return () => {}; },
      async startNewSession() { started = true; },
    };
    await expect(prepareFreshNativeConversation('claude', controller.signal, dependencies))
      .rejects.toThrow('cancelled');
    expect(started).toBe(false);
  });
});
