import { describe, expect, it } from 'vitest';
import type { AIProvider, ProviderState } from '../../shared/types';
import { simpleChatTargets } from '../ui/targets';

const providers: AIProvider[] = ['chatgpt', 'gemini', 'claude', 'grok', 'meta'];
const states = Object.fromEntries(providers.map((provider) => [
  provider,
  { provider, webview: 'loaded', dom: 'ready', login: 'logged_in', thinking: false, lastStatusAt: 1 },
])) as Record<AIProvider, ProviderState>;

describe('Simple Chat isolation', () => {
  it('returns exactly the requested provider when every other model is connected', () => {
    expect(simpleChatTargets('gemini', states)).toEqual(['gemini']);
    expect(simpleChatTargets('chatgpt', states)).toEqual(['chatgpt']);
  });

  it('never falls back to another model if the chosen provider is not ready', () => {
    const disconnected = { ...states, gemini: { ...states.gemini, login: 'logged_out' as const } };
    expect(simpleChatTargets('gemini', disconnected)).toEqual([]);
    expect(simpleChatTargets(undefined, states)).toEqual([]);
  });

  it('never infers multiple free-mode targets from Simple Chat', () => {
    for (const provider of providers) {
      expect(simpleChatTargets(provider, states)).toHaveLength(1);
    }
  });
});
