import { describe, expect, it } from 'vitest';
import type { AIProvider, BridgeMessage } from '../../shared/types';
import { t } from '../i18n/t';
import { createProcessTrace, reduceProcessTraceEvent, settleProcessTrace } from '../ui/processTraceModel';

const status = (value: string): BridgeMessage =>
  ({ v: 1, action: 'WORKFLOW_STATUS', payload: value, transport: 'local' });

const role = (provider: AIProvider, label: string, turn: number): BridgeMessage =>
  ({
    v: 1, action: 'ROLE_ASSIGNMENT', provider, transport: 'local',
    payload: { role: label.toLowerCase(), label, turn },
  });

const answer = (provider: AIProvider, action: 'RESPONSE_CHUNK' | 'RESPONSE_DONE', payload: string): BridgeMessage =>
  ({ v: 1, action, provider, payload, transport: 'pull' });

const confirmed = (provider: AIProvider, turn: number, text: string): BridgeMessage =>
  ({ v: 1, action: 'WORKFLOW_STEP_CONFIRMED', provider, payload: { turn, text }, transport: 'local' });

describe('Consult completion is signal-driven, not guessed from status', () => {
  it.each(['en', 'zh-TW', 'ja', 'de'] as const)('requires the in-flight waiter to confirm each role in %s', (locale) => {
    let trace = createProcessTrace('consult', [], locale);
    trace = reduceProcessTraceEvent(trace, status('First and Second answering'), locale);
    trace = reduceProcessTraceEvent(trace, role('gemini', 'Second', 1), locale);
    trace = reduceProcessTraceEvent(trace, answer('gemini', 'RESPONSE_CHUNK', 'A visible partial Gemini answer'), locale);
    expect(trace.steps[0]?.status).toBe('active');
    expect(trace.steps[0]?.content).toBe('A visible partial Gemini answer');
    expect(trace.steps[0]?.detail).toContain(t('processTrace.completionUnconfirmed', locale));

    // A change of workflow banner, or another connected provider becoming
    // Ready, must never forge a completion signal for Gemini.
    trace = reduceProcessTraceEvent(trace, status('Reviewer checking'), locale);
    expect(trace.steps[0]?.status).toBe('active');

    trace = reduceProcessTraceEvent(trace, answer('gemini', 'RESPONSE_DONE', 'Confirmed final Gemini answer'), locale);
    // The provider sent DONE but no matching waiter accepted it yet.
    expect(trace.steps[0]?.status).toBe('active');
    trace = reduceProcessTraceEvent(trace, confirmed('gemini', 2, 'Stale answer'), locale);
    expect(trace.steps[0]?.status).toBe('active');
    trace = reduceProcessTraceEvent(trace, confirmed('gemini', 1, 'Confirmed final Gemini answer'), locale);
    expect(trace.steps[0]?.status).toBe('done');
    expect(trace.steps[0]?.content).toBe('Confirmed final Gemini answer');
    expect(trace.steps[0]?.detail).not.toContain(t('processTrace.completionUnconfirmed', locale));
  });

  it('leaves an interrupted Consult visibly unconfirmed rather than claiming success', () => {
    let trace = createProcessTrace('consult', [], 'en');
    trace = reduceProcessTraceEvent(trace, role('chatgpt', 'First', 4), 'en');
    trace = reduceProcessTraceEvent(trace, answer('chatgpt', 'RESPONSE_CHUNK', 'Draft answer'), 'en');
    trace = reduceProcessTraceEvent(trace, status(''), 'en');
    expect(trace.currentStatus).toBe('');
    expect(trace.steps[0]?.status).toBe('pending');
    expect(trace.steps[0]?.detail).toContain('Completion not confirmed');
    expect(trace.steps[0]?.content).toBe('Draft answer');
  });

  it('keeps a fully confirmed response done after workflow settlement', () => {
    let trace = createProcessTrace('consult');
    trace = reduceProcessTraceEvent(trace, role('chatgpt', 'First', 5));
    trace = reduceProcessTraceEvent(trace, answer('chatgpt', 'RESPONSE_DONE', 'Complete answer'));
    trace = reduceProcessTraceEvent(trace, confirmed('chatgpt', 5, 'Complete answer'));
    trace = settleProcessTrace(trace);
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]?.status).toBe('done');
    expect(trace.steps[0]?.detail).toBe('Complete answer');
  });

  it('shows actual provider failure and never reclassifies it as Done after a late reply', () => {
    let trace = createProcessTrace('consult');
    trace = reduceProcessTraceEvent(trace, role('chatgpt', 'First', 7));
    trace = reduceProcessTraceEvent(trace, {
      v: 1, action: 'WORKFLOW_STEP_FAILED', provider: 'chatgpt',
      transport: 'local', payload: { turn: 7, reason: 'ChatGPT response timed out after 600s' },
    });
    expect(trace.steps[0]).toMatchObject({
      status: 'failed',
      detail: 'ChatGPT response timed out after 600s',
    });
    trace = reduceProcessTraceEvent(trace, confirmed('chatgpt', 7, 'Very late answer'));
    trace = reduceProcessTraceEvent(trace, answer('chatgpt', 'RESPONSE_DONE', 'Late raw answer'));
    trace = settleProcessTrace(trace);
    expect(trace.steps[0]?.status).toBe('failed');
    expect(trace.steps[0]?.content).toBeUndefined();
  });

  it('keeps aggregate fanout failed if one provider errors while another is done', () => {
    let trace = createProcessTrace('free', ['chatgpt', 'gemini']);
    trace = reduceProcessTraceEvent(trace, confirmed('gemini', 1, 'Gemini final'));
    trace = reduceProcessTraceEvent(trace, {
      v: 1, action: 'WORKFLOW_STEP_FAILED', provider: 'chatgpt',
      transport: 'local', payload: { turn: 2, reason: 'Adapter did not return an answer' },
    });
    expect(trace.steps.map((step) => step.status)).toEqual(['failed', 'failed', 'done']);
  });

  it('does not turn unconfirmed free fan-out messages into completed rows', () => {
    let trace = createProcessTrace('free', ['chatgpt', 'gemini']);
    trace = reduceProcessTraceEvent(trace, answer('gemini', 'RESPONSE_CHUNK', 'Still streaming'));
    trace = settleProcessTrace(trace);
    expect(trace.steps.map((step) => step.status)).toEqual(['pending', 'pending', 'pending']);
    expect(trace.steps.find((step) => step.provider === 'gemini')?.content).toBe('Still streaming');
  });
});
