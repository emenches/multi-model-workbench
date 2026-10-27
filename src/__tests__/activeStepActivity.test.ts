import { describe, expect, it } from 'vitest';
import { activeStepActivity } from '../ui/activeStepActivity';
import type { ProcessTraceStep } from '../ui/processTraceModel';

const active: ProcessTraceStep = {
  id: 'role-chatgpt-1',
  kind: 'role',
  label: 'Initial answer · ChatGPT',
  provider: 'chatgpt',
  turn: 1,
  status: 'active',
  startedAt: 1_000,
};

describe('workflow activity state', () => {
  it('shows waiting for a first reply, not a fabricated thinking status', () => {
    expect(activeStepActivity(active, false, 11_000)).toEqual({
      phase: 'waiting', elapsedSeconds: 10, secondsWithoutNewText: 10,
    });
  });
  it('uses provider-reported generating state, not arbitrary guesses', () => {
    expect(activeStepActivity(active, true, 11_000)?.phase).toBe('generating');
  });
  it('shows received content and tracks idle time from last actual text', () => {
    const step = { ...active, content: 'Partial output', lastOutputAt: 25_000 };
    expect(activeStepActivity(step, false, 40_000)).toEqual({
      phase: 'receiving', elapsedSeconds: 39, secondsWithoutNewText: 15,
    });
    expect(activeStepActivity(step, true, 40_000)?.phase).toBe('receiving');
    expect(activeStepActivity(step, false, 86_000)).toEqual({
      phase: 'no-update', elapsedSeconds: 85, secondsWithoutNewText: 61,
    });
  });
  it('warns after long silence, but never labels the step as failed', () => {
    expect(activeStepActivity(active, false, 62_000)?.phase).toBe('no-update');
    expect(activeStepActivity({ ...active, status: 'done' }, false, 90_000)).toBeUndefined();
    expect(activeStepActivity({ ...active, status: 'pending' }, false, 90_000)).toBeUndefined();
  });
});
