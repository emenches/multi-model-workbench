import { describe, expect, it } from 'vitest';
import type { AIProvider, ConsultRoles, ProviderState } from '../../shared/types';
import { availableConsultProviders, chooseConsultRoles, MIN_CONSULT_PROVIDERS } from '../ui/consultAvailability';
import { DEFAULT_CONSULT_ROLES } from '../../shared/constants';

const state = (provider: AIProvider, ready = true): ProviderState => ({
  provider, webview: ready ? 'loaded' : 'none',
  dom: ready ? 'ready' : 'unknown',
  login: ready ? 'logged_in' : 'unknown',
  thinking: false, lastStatusAt: 1,
});

describe('two-provider Consult', () => {
  it('requires two separate ready providers, not one', () => {
    expect(MIN_CONSULT_PROVIDERS).toBe(2);
    expect(chooseConsultRoles(DEFAULT_CONSULT_ROLES, [])).toBeUndefined();
    expect(chooseConsultRoles(DEFAULT_CONSULT_ROLES, ['chatgpt'])).toBeUndefined();
  });
  it('uses the two ready providers for four sequentially reusable roles', () => {
    const ready: AIProvider[] = ['chatgpt', 'gemini'];
    const roles = chooseConsultRoles(DEFAULT_CONSULT_ROLES, ready);
    expect(roles).toEqual({ first: 'chatgpt', second: 'gemini', reviewer: 'chatgpt', summary: 'gemini' });
    expect(roles?.first).not.toBe(roles?.second);
    expect(new Set(Object.values(roles!))).toEqual(new Set(ready));
  });
  it('preserves fully ready saved roles for the four-provider workflow', () => {
    expect(chooseConsultRoles(DEFAULT_CONSULT_ROLES, ['chatgpt', 'claude', 'gemini', 'grok']))
      .toEqual(DEFAULT_CONSULT_ROLES);
  });
  it('uses three available providers when a configured fourth is offline', () => {
    expect(chooseConsultRoles(DEFAULT_CONSULT_ROLES, ['chatgpt', 'claude', 'gemini']))
      .toEqual({ first: 'chatgpt', second: 'claude', reviewer: 'claude', summary: 'gemini' });
  });
  it('repairs an aliased first and second without writing new saved settings', () => {
    const configured: ConsultRoles = { first: 'chatgpt', second: 'chatgpt', reviewer: 'claude', summary: 'claude' };
    const original = { ...configured };
    const roles = chooseConsultRoles(configured, ['chatgpt', 'claude']);
    expect(roles).toEqual({ first: 'chatgpt', second: 'claude', reviewer: 'claude', summary: 'claude' });
    expect(configured).toEqual(original);
  });
  it('ignores logged-out, blocked, and inactive standby providers', () => {
    const states = {
      chatgpt: state('chatgpt'),
      claude: state('claude', false),
      gemini: state('gemini'),
      grok: state('grok'),
    } as Partial<Record<AIProvider, ProviderState>>;
    expect(availableConsultProviders(states, ['chatgpt', 'claude', 'gemini']))
      .toEqual(['chatgpt', 'gemini']);
    expect(availableConsultProviders({ ...states, gemini: state('gemini', false) }, ['chatgpt', 'claude', 'gemini']))
      .toEqual(['chatgpt']);
    expect(availableConsultProviders(states, ['chatgpt', 'chatgpt', 'gemini']))
      .toEqual(['chatgpt', 'gemini']);
  });
});
