import { describe, expect, it } from 'vitest';
import { freeTargetsForPreset } from '../ui/targets';
import type { AIProvider, ProviderState } from '../../shared/types';

const providers: AIProvider[] = ['chatgpt', 'claude', 'gemini', 'grok', 'meta'];
function states(ready: readonly AIProvider[]): Record<AIProvider, ProviderState> {
  return Object.fromEntries(providers.map((provider) => [provider, {
    provider,
    webview: 'loaded',
    dom: 'ready',
    login: ready.includes(provider) ? 'logged_in' : 'logged_out',
    thinking: false,
    lastStatusAt: 1,
  }])) as Record<AIProvider, ProviderState>;
}

describe('Single Agent dispatch isolation', () => {
  it('uses exactly the chosen provider, ignoring every selected fan-out target', () => {
    const ready = states(['chatgpt', 'claude', 'gemini']);
    expect(freeTargetsForPreset('single', ['chatgpt', 'gemini'], 'claude', ready)).toEqual(['claude']);
    expect(freeTargetsForPreset('single', ['claude', 'gemini'], 'chatgpt', ready)).toEqual(['chatgpt']);
  });

  it('never falls back to another provider when the selected one is unavailable', () => {
    const ready = states(['chatgpt', 'gemini']);
    expect(freeTargetsForPreset('single', ['chatgpt', 'gemini'], 'claude', ready)).toEqual([]);
  });

  it('preserves existing Free fan-out targeting unchanged', () => {
    const ready = states(['chatgpt', 'gemini']);
    expect(freeTargetsForPreset('free', ['chatgpt', 'claude', 'gemini'], 'claude', ready))
      .toEqual(['chatgpt', 'gemini']);
  });
});
