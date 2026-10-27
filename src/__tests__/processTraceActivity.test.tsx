import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderState } from '../../shared/types';
import { ProcessTrace } from '../ui/ProcessTrace';
import { createProcessTrace, reduceProcessTraceEvent } from '../ui/processTraceModel';

const chatgpt = (thinking: boolean): ProviderState => ({
  provider: 'chatgpt',
  webview: 'loaded',
  dom: 'ready',
  login: 'logged_in',
  thinking,
  lastStatusAt: 1,
});
const role = { v: 1 as const, action: 'ROLE_ASSIGNMENT' as const, provider: 'chatgpt' as const,
  transport: 'local' as const, payload: { role: 'first', label: 'Initial answer', turn: 1 } };
const confirmed = { v: 1 as const, action: 'WORKFLOW_STEP_CONFIRMED' as const,
  provider: 'chatgpt' as const, transport: 'local' as const,
  payload: { turn: 1, text: 'Answer received' } };

describe('live workflow progress', () => {
  it('animates the active provider, shows its real activity phase and gives a live-page escape', () => {
    const trace = reduceProcessTraceEvent(createProcessTrace('consult'), role);
    const onViewProvider = vi.fn();
    const html = renderToStaticMarkup(createElement(ProcessTrace, {
      trace, compact: true, locale: 'en', onViewProvider,
      states: { chatgpt: chatgpt(true) },
    }));
    expect(html).toContain('motion-safe:animate-spin');
    expect(html).toContain('Provider reports generating');
    expect(html).toContain('View live page');
    expect(html).toContain('Initial answer · ChatGPT');
    expect(html).toContain('0 of 1 steps confirmed');
    expect(html).toContain('Elapsed');
    expect(html).toContain('Awaiting first text');
    expect(html).toContain('workbench-activity-sweep');
  });

  it('keeps an active waiting state honest and stops animating a confirmed answer', () => {
    const active = reduceProcessTraceEvent(createProcessTrace('consult'), role);
    const waiting = renderToStaticMarkup(createElement(ProcessTrace, {
      trace: active, compact: true, locale: 'en', states: { chatgpt: chatgpt(false) },
    }));
    expect(waiting).toContain('Waiting for reply');

    const done = reduceProcessTraceEvent(active, confirmed);
    const html = renderToStaticMarkup(createElement(ProcessTrace, {
      trace: done, compact: true, locale: 'en', states: { chatgpt: chatgpt(false) },
      onViewProvider: vi.fn(),
    }));
    expect(html).toContain('Done');
    expect(html).not.toContain('motion-safe:animate-spin');
    expect(html).not.toContain('View live page');
    expect(html).toContain('1 of 1 steps confirmed');
    expect(html).not.toContain('workbench-activity-sweep');
  });
});
