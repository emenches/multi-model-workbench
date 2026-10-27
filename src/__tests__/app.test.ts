import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ProviderState } from '../../shared/types';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import { bubbleAuthorLabel } from '../bubbleAuthorLabel';
import App, { agentHeaderStatus, canRestoreWithoutInspectorPane, ChatArea, presentationHiddenProvidersForCenterSurface } from '../App';
import { I18nProvider } from '../i18n/context';
import { applyCenterHiddenCommands } from '../ui/presentationCommands';
import { defaultPresentation, setProviderPresentation } from '../ui/presentation';
import { defaultSettings, mergeSettings, normalizeSettings } from '../ui/settingsModel';

function state(provider: AIProvider, thinking = false): ProviderState {
  return {
    provider,
    webview: 'loaded',
    dom: 'ready',
    login: 'logged_in',
    thinking,
    lastStatusAt: 1,
  };
}

function states(overrides: Partial<Record<AIProvider, ProviderState>> = {}): Record<AIProvider, ProviderState> {
  return Object.fromEntries(
    (Object.keys(AI_PROVIDERS) as AIProvider[]).map((provider) => [provider, overrides[provider] ?? state(provider)]),
  ) as Record<AIProvider, ProviderState>;
}

describe('App bubble author labels', () => {
  it('is total for users, catalog providers, system, unknown, and missing providers', () => {
    expect(bubbleAuthorLabel({ role: 'user' })).toBe('You');

    for (const provider of Object.keys(AI_PROVIDERS) as AIProvider[]) {
      expect(bubbleAuthorLabel({ role: 'ai', provider })).toBe(AI_PROVIDERS[provider].name);
    }

    expect(() => bubbleAuthorLabel({ role: 'ai', provider: 'system' })).not.toThrow();
    expect(() => bubbleAuthorLabel({ role: 'ai', provider: 'unknown-provider' })).not.toThrow();
    expect(() => bubbleAuthorLabel({ role: 'ai' })).not.toThrow();
    expect(bubbleAuthorLabel({ role: 'ai', provider: 'system' })).toBe('System');
    expect(bubbleAuthorLabel({ role: 'ai', provider: 'unknown-provider' })).toBe('System');
    expect(bubbleAuthorLabel({ role: 'ai' })).toBe('System');
    expect(bubbleAuthorLabel({ role: 'ai', provider: 'chatgpt', authorLabel: ' Reviewer ' })).toBe('Reviewer');
  });
});


describe('Hidden provider restoration', () => {
  it('reopens chip/side/center-text agents with no mounted inspector and waits only for a visible native center', () => {
    expect(canRestoreWithoutInspectorPane('chip', 'text', false)).toBe(true);
    expect(canRestoreWithoutInspectorPane('side', 'text', false)).toBe(true);
    expect(canRestoreWithoutInspectorPane('center', 'text', false)).toBe(true);
    expect(canRestoreWithoutInspectorPane('center', 'native', false)).toBe(false);
    expect(canRestoreWithoutInspectorPane('center', 'native', true)).toBe(true);
  });
});

describe('Start screen agent status', () => {
  it('shows genuine ready, interim verification, and remembered session states separately', () => {
    expect(agentHeaderStatus(state('chatgpt'), true, false)).toBe('ready');
    const unknown = { ...state('claude'), webview: 'none' as const, dom: 'unknown' as const, login: 'unknown' as const };
    expect(agentHeaderStatus(unknown, false, false)).toBeNull();
    expect(agentHeaderStatus(unknown, true, true)).toBe('checking');
    expect(agentHeaderStatus(unknown, true, false)).toBe('open');
    expect(agentHeaderStatus({ ...unknown, webview: 'creating' }, false, false)).toBe('checking');
    expect(agentHeaderStatus({ ...unknown, webview: 'loaded' }, false, false)).toBe('checking');
    expect(agentHeaderStatus({ ...unknown, login: 'logged_out' }, true, true)).toBeNull();
    expect(agentHeaderStatus({ ...unknown, login: 'blocked' }, true, true)).toBeNull();
  });
});

describe('App workflow controls', () => {
  it('does not expose the legacy ask-before-each-step toggle', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { language: 'en', children: createElement(App) }));

    expect(html).not.toContain('Ask me before each step');
    expect(html).not.toContain('每步先問我再送出');
  });

  it('uses a clean conversation-first landing without the old left dashboard', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { language: 'en', children: createElement(App) }));

    expect(html).toContain('workbench-connected-agent-strip');
    expect(html).toContain('var(--wb-sidebar-width, 252px)');
    expect(html).toContain('Checking agent connections');
    expect(html).toContain('workbench-new-chat-screen');
    expect(html).toContain('What would you like to chat about?');
    expect(html).not.toContain('What would you like to work on?');
    expect(html).toContain('workbench-new-chat-mode');
    expect(html).toContain('workbench-experience-switch');
    expect(html).toContain('aria-pressed="true">Chat');
    expect(html).toContain('Multi-agent');
    expect(html).toContain('workbench-composer-plus');
    expect(html).toContain('More options');
    expect(html).not.toContain('workbench-new-chat-project');
    expect(html).not.toContain('workbench-new-chat-workflow');

    expect(html).toContain('workbench-simple-agent-select');
    expect(html).toContain('workbench-new-chat-composer');
    expect(html).toContain('workbench-session-sidebar');
    expect(html).not.toContain('id="workflow-control-shelf"');
    expect(html).not.toContain('workbench-provider-dock');
  });

  it('renders only Workbench branding, without the former alternate theme', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { language: 'en', children: createElement(App) }));
    expect(html).toContain('app-shell');
    expect(html).not.toContain('ai-sister-brand-mark');
    expect(html).not.toContain('AI-Sister Edition');
    expect(html).not.toContain('ai-sister-avatar');
  });
});

describe('Dark-only settings migration', () => {
  it('defaults to dark and migrates legacy saved themes without disturbing other settings', () => {
    expect(defaultSettings().theme).toBe('dark');
    for (const legacyTheme of ['light', 'dark', 'ai-sister', 'unexpected', null]) {
      const normalized = normalizeSettings({
        ...defaultSettings(),
        theme: legacyTheme,
        language: 'ja',
        fontSize: 19,
      });
      expect(normalized.theme).toBe('dark');
      expect(normalized.language).toBe('ja');
      expect(normalized.fontSize).toBe(19);
      expect(mergeSettings(normalized, { theme: 'dark' }).theme).toBe('dark');
    }
  });
});

describe('Workbench reading surfaces', () => {
  it('keeps user prompts distinct from provider replies without changing answer text', () => {
    const html = renderToStaticMarkup(createElement(ChatArea, {
      locale: 'en', states: states(),
      messages: [
        { id: 'user-1', role: 'user', content: 'Can you compare these?', final: true },
        { id: 'chatgpt-1', role: 'ai', provider: 'chatgpt', content: 'Comparison complete.', final: true },
      ],
    }));
    expect(html).toContain('workbench-message-user');
    expect(html).toContain('workbench-message-other');
    expect(html).toContain('Comparison complete.');
    expect(html).toContain('Can you compare these?');
  });

  it('renders the native-style conversation hierarchy and activity overview', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { language: 'en', children: createElement(App) }));
    expect(html).toContain('workbench-conversation-header');
    expect(html).toContain('workbench-conversation-workspace');
    expect(html).toContain('workbench-connected-agent-strip');
    expect(html).toContain('workbench-primary-activity');
    expect(html).toContain('More actions');
    expect(html).toContain('workbench-experience-switch');
    expect(html).toContain('workbench-new-chat-composer');
    expect(html).toContain('workbench-composer-plus');
  });
});

describe('Ambient workflow visualization', () => {
  it('replaces duplicate unfinished provider bubbles while retaining complete answers', () => {
    const trace = {
      mode: 'consult' as const,
      currentStatus: 'Review',
      steps: [{
        id: 'review-chatgpt',
        kind: 'role' as const,
        label: 'Review · ChatGPT',
        provider: 'chatgpt' as const,
        status: 'active' as const,
        startedAt: Date.now() - 20_000,
      }],
    };
    const html = renderToStaticMarkup(createElement(ChatArea, {
      locale: 'en', states: states({ chatgpt: state('chatgpt', true) }),
      trace,
      messages: [
        { id: 'done-gemini', role: 'ai', provider: 'gemini', content: 'Verified result.', final: true },
        { id: 'thinking-chatgpt', role: 'ai', provider: 'chatgpt', content: 'unstable partial', final: false },
      ],
    }));
    expect(html).toContain('workbench-thinking-visual');
    expect(html).toContain('Working across models');
    expect(html).toContain('Verified result.');
    expect(html).not.toContain('unstable partial');
    expect(html).not.toContain('Response in progress');
  });
});

describe('ChatArea checking connection copy', () => {
  it('does not tell an authenticated user to sign in during temporary hydration', () => {
    const reconnecting = Object.fromEntries(
      (Object.keys(AI_PROVIDERS) as AIProvider[]).map((provider) => [
        provider,
        { ...state(provider), dom: 'unknown' as const, login: 'unknown' as const },
      ]),
    ) as Record<AIProvider, ProviderState>;
    const html = renderToStaticMarkup(createElement(ChatArea, {
      locale: 'en', states: reconnecting, messages: [],
    }));
    expect(html).toContain('Checking provider connections');
    expect(html).not.toContain('sign in to start chatting');
  });
});

describe('ChatArea thinking indicator', () => {
  it('hides streamed partial content while a non-final provider bubble is thinking', () => {
    const html = renderToStaticMarkup(
      createElement(ChatArea, {
        locale: 'en',
        states: states({ chatgpt: state('chatgpt', true) }),
        messages: [{ id: 'ai-chatgpt-1', role: 'ai', provider: 'chatgpt', content: 'provider reasoning scrape', final: false }],
      }),
    );

    expect(html).toContain('Thinking…');
    expect(html).toContain('data-provider="chatgpt"');
    expect(html).toContain('data-active="true"');
    expect(html).not.toContain('provider reasoning scrape');
    expect(html).not.toContain('streaming');
  });

  it('renders content for non-thinking and finalized bubbles', () => {
    const html = renderToStaticMarkup(
      createElement(ChatArea, {
        locale: 'en',
        states: states({ chatgpt: state('chatgpt', true), claude: state('claude', false) }),
        messages: [
          { id: 'ai-chatgpt-1', role: 'ai', provider: 'chatgpt', content: 'final answer', final: true },
          { id: 'ai-claude-1', role: 'ai', provider: 'claude', content: 'streaming answer', final: false },
          { id: 'ai-system-1', role: 'ai', provider: 'system', content: 'system content', final: false },
        ],
      }),
    );

    expect(html).toContain('final answer');
    expect(html).toContain('streaming answer');
    expect(html).toContain('system content');
    expect(html).toContain('streaming');
    expect(html).not.toContain('Thinking…');
  });
});

describe('text center presentation hidden set', () => {
  it('keeps a provider hidden after demoting it from text center to side', async () => {
    const providers = Object.keys(AI_PROVIDERS) as AIProvider[];
    const snapshot = states();
    const userHidden = new Set<AIProvider>();
    const host = {
      hide: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      setBounds: vi.fn().mockResolvedValue(undefined),
    };
    const previousPresentation = setProviderPresentation(defaultPresentation(), 'chatgpt', 'center');
    const nextPresentation = setProviderPresentation(previousPresentation, 'claude', 'center');

    const previousHidden = presentationHiddenProvidersForCenterSurface({
      centerSurface: 'text',
      presentation: previousPresentation,
      states: snapshot,
      userHidden,
      providers,
    });
    const nextHidden = presentationHiddenProvidersForCenterSurface({
      centerSurface: 'text',
      presentation: nextPresentation,
      states: snapshot,
      userHidden,
      providers,
    });

    expect(previousHidden.has('chatgpt')).toBe(true);
    expect(nextHidden.has('chatgpt')).toBe(false);
    expect(nextHidden.has('claude')).toBe(true);

    await applyCenterHiddenCommands({
      host,
      previousHidden,
      nextHidden,
      snapshot: () => ({
        states: snapshot,
        presentation: nextPresentation,
        userHidden,
        overlayGuardOpen: false,
      }),
    });

    expect(host.show).not.toHaveBeenCalled();
    expect(host.hide).toHaveBeenCalledWith('claude');
  });
});
