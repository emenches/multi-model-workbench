import type { ProcessTraceStep } from './processTraceModel';

export type ActivePhase = 'waiting' | 'generating' | 'receiving' | 'no-update';

export interface ActiveStepActivity {
  phase: ActivePhase;
  elapsedSeconds: number;
  secondsWithoutNewText: number;
}

/** An honest, UI-only activity label: never infer a model is thinking from a
 * spinning indicator, and never interpret a quiet page as a provider error.
 * Completion and failures remain controlled by the workflow waiter/timeout.
 */
export function activeStepActivity(
  step: ProcessTraceStep,
  providerReportsGenerating: boolean,
  nowMs: number,
): ActiveStepActivity | undefined {
  if (step.status !== 'active') return undefined;
  const seconds = (start: number | undefined) => Math.max(0, Math.floor((nowMs - (start ?? nowMs)) / 1000));
  const elapsedSeconds = seconds(step.startedAt);
  const secondsWithoutNewText = seconds(step.lastOutputAt ?? step.startedAt);
  const phase: ActivePhase =
    secondsWithoutNewText >= 60
      ? 'no-update'
      : providerReportsGenerating
        ? 'generating'
        : step.content
          ? 'receiving'
          : 'waiting';
  return { phase, elapsedSeconds, secondsWithoutNewText };
}
