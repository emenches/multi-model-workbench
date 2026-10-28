import { describe, expect, it } from 'vitest';
import { ALL_AI_PROVIDERS, DOCK_SLOT_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ProviderState } from '../../shared/types';
import { chipProviders, defaultPresentation, setProviderPresentation, sideProviders } from '../ui/presentation';
import { assignSlotProvider, DEFAULT_SLOT_ASSIGNMENT, isProviderPermutation, normalizeSlotAssignment } from '../ui/slotAssignment';
import { defaultTargets, freeModeTargets } from '../ui/targets';

describe('behavior-preserving helper consolidation', () => {
  it('accepts exactly the four dock providers and preserves swap/fallback ordering', () => {
    expect(isProviderPermutation([...DOCK_SLOT_PROVIDERS])).toBe(true);
    expect(isProviderPermutation(['chatgpt', 'claude', 'gemini', 'meta'])).toBe(false);
    expect(isProviderPermutation(['chatgpt', 'claude', 'claude', 'grok'])).toBe(false);
    expect(assignSlotProvider(DEFAULT_SLOT_ASSIGNMENT, 'leftTop', 'claude')).toEqual({
      ...DEFAULT_SLOT_ASSIGNMENT,
      leftTop: 'claude',
      leftBottom: 'chatgpt',
    });
    expect(normalizeSlotAssignment({ leftTop: 'grok', leftBottom: 'grok', rightTop: 'invalid' })).toEqual({
      leftTop: 'grok',
      leftBottom: 'claude',
      rightTop: 'gemini',
      rightBottom: 'chatgpt',
    });
  });

  it('keeps chip/side filtering and selected target order unchanged', () => {
    const presentation = setProviderPresentation(defaultPresentation(), 'claude', 'center');
    expect(chipProviders(presentation)).toEqual(['meta']);
    expect(sideProviders(presentation)).toEqual(['chatgpt', 'gemini', 'grok']);

    const states = Object.fromEntries(ALL_AI_PROVIDERS.map((provider) => [provider, {
      provider, webview: 'loaded', dom: 'ready', login: 'logged_in', thinking: false, lastStatusAt: 1,
    }])) as Record<AIProvider, ProviderState>;
    states.claude = { ...states.claude, login: 'logged_out' };
    const selected: AIProvider[] = ['grok', 'claude', 'chatgpt'];
    expect(defaultTargets(states, selected)).toEqual(['grok', 'chatgpt']);
    expect(freeModeTargets(selected, states)).toEqual(['grok', 'chatgpt']);
  });
});
