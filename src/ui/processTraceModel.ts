import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, BridgeMessage, ChatMode, WorkflowPresetId } from '../../shared/types';
import type { Locale } from '../i18n/resolve';
import { t } from '../i18n/t';

export type ProcessTraceStepStatus = 'pending' | 'active' | 'done' | 'failed';

export interface ProcessTraceStep {
  id: string;
  kind: 'fanout' | 'response' | 'role';
  label: string;
  detail?: string;
  content?: string;
  provider?: AIProvider;
  role?: string;
  turn?: number;
  status: ProcessTraceStepStatus;
  /** Wall-clock start of a live step, for truthful elapsed time in the UI. */
  startedAt?: number;
  /** Last time the response text actually changed (not merely a repeat poll). */
  lastOutputAt?: number;
}

export interface ProcessTraceState {
  mode: ChatMode;
  currentStatus: string;
  steps: ProcessTraceStep[];
}

export function createProcessTrace(
  mode: ChatMode,
  targets: AIProvider[] = [],
  locale: Locale = 'en',
  presetId?: WorkflowPresetId,
): ProcessTraceState {
  if (mode !== 'free' || presetId === 'brainstorm') return { mode, currentStatus: '', steps: [] };

  return {
    mode,
    currentStatus: '',
    steps: [
      {
        id: 'free-fanout',
        kind: 'fanout',
        label: t('processTrace.fanout', locale),
        detail: targets.length > 0 ? `${t('processTrace.sendingTo', locale)} ${providerNames(targets)}` : t('processTrace.noSelectedAI', locale),
        status: targets.length > 0 ? 'active' : 'done',
      },
      ...targets.map((provider) => responseStep(provider, 'pending', locale)),
    ],
  };
}

export function reduceProcessTraceEvent(trace: ProcessTraceState, message: BridgeMessage, locale: Locale = 'en'): ProcessTraceState {
  if (message.action === 'WORKFLOW_STATUS') {
    const status = typeof message.payload === 'string' ? message.payload : '';
    return applyWorkflowStatus(trace, status, locale);
  }

  if (message.action === 'ROLE_ASSIGNMENT' && isKnownProvider(message.provider)) {
    const payload = rolePayload(message.payload);
    return addRoleStep(trace, message.provider, payload.role, payload.label, payload.turn, locale);
  }

  if (message.action === 'WORKFLOW_STEP_FAILED' && isKnownProvider(message.provider) && message.transport === 'local') {
    const payload = message.payload as { turn?: unknown; reason?: unknown } | undefined;
    if (typeof payload?.turn !== 'number') return trace;
    return failWorkflowStep(trace, message.provider, payload.turn, typeof payload.reason === 'string' ? payload.reason : '', locale);
  }

  if (message.action === 'WORKFLOW_STEP_CONFIRMED' && isKnownProvider(message.provider) && message.transport === 'local') {
    const payload = message.payload as { turn?: unknown; text?: unknown } | undefined;
    if (typeof payload?.turn !== 'number') return trace;
    return confirmWorkflowStep(trace, message.provider, payload.turn, typeof payload.text === 'string' ? payload.text : '', locale);
  }

  if (isTraceResponse(message) && isKnownProvider(message.provider)) {
    // Receiving text (even a provider RESPONSE_DONE message) is not the same
    // as the workflow waiter accepting it for the current step.
    return applyProviderResponse(trace, message.provider, responsePayloadText(message.payload), locale);
  }

  return trace;
}

export function settleProcessTrace(trace: ProcessTraceState, locale: Locale = 'en'): ProcessTraceState {
  return {
    ...trace,
    currentStatus: '',
    // Clearing the workflow banner does NOT prove an individual provider
    // completed its answer. A workflow can stop, fail or be cancelled.
    // Preserve confirmed completions and mark everything else unconfirmed.
    steps: refreshFreeAggregate(
      trace.steps.map((step) =>
        step.status === 'done' || step.status === 'failed'
          ? step
          : {
              ...step,
              status: 'pending' as const,
              detail: step.detail?.includes(t('processTrace.completionUnconfirmed', locale))
                ? step.detail
                : [step.detail, t('processTrace.completionUnconfirmed', locale)].filter(Boolean).join(' · '),
            },
      ),
    ),
  };
}

function applyWorkflowStatus(trace: ProcessTraceState, status: string, locale: Locale): ProcessTraceState {
  if (!status) return settleProcessTrace(trace, locale);
  // Workflow status text is informational, not evidence of RESPONSE_DONE.
  // This matters when one provider is Ready or has visible text but its
  // completion signal is delayed or missing.
  return { ...trace, currentStatus: status };
}

function addRoleStep(
  trace: ProcessTraceState,
  provider: AIProvider,
  role: string | undefined,
  label: string | undefined,
  turn: number | undefined,
  locale: Locale,
): ProcessTraceState {
  const providerName = AI_PROVIDERS[provider].name;
  const displayRole = label || role || t('processTrace.step', locale);
  const step: ProcessTraceStep = {
    id: turn === undefined ? `role-${trace.steps.length}-${provider}` : `role-${provider}-${turn}`,
    kind: 'role',
    provider,
    role,
    turn,
    label: `${displayRole} · ${providerName}`,
    detail: role && label && role !== label ? role : undefined,
    status: 'active',
    startedAt: Date.now(),
  };
  return { ...trace, steps: [...trace.steps, step] };
}

function applyProviderResponse(
  trace: ProcessTraceState,
  provider: AIProvider,
  content: string,
  locale: Locale,
): ProcessTraceState {
  const nextStatus: ProcessTraceStepStatus = 'active';
  let matchIndex = -1;
  for (let index = trace.steps.length - 1; index >= 0; index -= 1) {
    const step = trace.steps[index];
    if (step.provider === provider && (step.kind === 'role' || step.kind === 'response') && step.status !== 'done' && step.status !== 'failed') {
      matchIndex = index;
      break;
    }
  }
  const steps = trace.steps.map((step, index) =>
    index === matchIndex
      ? {
          ...step,
          status: nextStatus,
          startedAt: step.startedAt ?? Date.now(),
          lastOutputAt: content && content !== step.content ? Date.now() : step.lastOutputAt,
          content: content || step.content,
          detail: content
            ? `${oneLinePreview(content)} · ${t('processTrace.completionUnconfirmed', locale)}`
            : step.detail,
        }
      : step,
  );

  // The waiter may publish confirmation from inside RESPONSE_DONE dispatch,
  // before this reducer receives the original DONE event. Never create a
  // duplicate free-response row (or demote a confirmed step) in that case.
  const alreadyConfirmed = trace.steps.some(
    (step) => step.provider === provider && (step.kind === 'role' || step.kind === 'response') && (step.status === 'done' || step.status === 'failed'),
  );
  const nextSteps = matchIndex >= 0 || trace.mode !== 'free' || alreadyConfirmed
    ? steps
    : [...steps, responseStep(provider, nextStatus, locale, content)];
  return { ...trace, steps: refreshFreeAggregate(nextSteps) };
}

/** Only the waiter that actually resolved a reserved turn can confirm it.
 * This prevents an old/stale response from falsely marking a Consult role
 * completed while the workflow is still waiting for that provider.
 */
function confirmWorkflowStep(
  trace: ProcessTraceState,
  provider: AIProvider,
  turn: number,
  content: string,
  locale: Locale,
): ProcessTraceState {
  const matchIndex = trace.steps.findIndex(
    (step) => step.kind === 'role' && step.provider === provider && step.turn === turn && step.status !== 'done' && step.status !== 'failed',
  );
  const freeIndex = trace.mode === 'free'
    ? trace.steps.findIndex((step) => step.kind === 'response' && step.provider === provider && step.status !== 'done' && step.status !== 'failed')
    : -1;
  const index = matchIndex >= 0 ? matchIndex : freeIndex;
  if (index < 0) return trace;
  const steps = trace.steps.map((step, i) => i === index
    ? {
        ...step,
        status: 'done' as const,
        content: content || step.content,
        detail: content ? oneLinePreview(content) : step.detail?.replace(
          ` · ${t('processTrace.completionUnconfirmed', locale)}`, ''
        ),
      }
    : step);
  return { ...trace, steps: refreshFreeAggregate(steps) };
}

function failWorkflowStep(
  trace: ProcessTraceState,
  provider: AIProvider,
  turn: number,
  reason: string,
  locale: Locale,
): ProcessTraceState {
  const eligible = (step: ProcessTraceStep) =>
    step.provider === provider && step.status !== 'done' && step.status !== 'failed';
  const roleIndex = trace.steps.findIndex(
    (step) => eligible(step) && step.kind === 'role' && step.turn === turn,
  );
  const freeIndex = trace.mode === 'free'
    ? trace.steps.findIndex((step) => eligible(step) && step.kind === 'response')
    : -1;
  const index = roleIndex >= 0 ? roleIndex : freeIndex;
  if (index < 0) return trace;
  const detail = reason || t('processTrace.failed', locale);
  const steps = trace.steps.map((step, i) =>
    i === index ? { ...step, status: 'failed' as const, detail } : step,
  );
  return { ...trace, steps: refreshFreeAggregate(steps) };
}

function refreshFreeAggregate(steps: ProcessTraceStep[]): ProcessTraceStep[] {
  const responseRows = steps.filter((step) => step.kind === 'response');
  if (responseRows.length === 0) return steps;
  const aggregateStatus: ProcessTraceStepStatus = responseRows.some((step) => step.status === 'failed')
    ? 'failed'
    : responseRows.every((step) => step.status === 'done')
      ? 'done'
    : responseRows.some((step) => step.status === 'active')
      ? 'active'
      : 'pending';
  return steps.map((step) => (step.kind === 'fanout' ? { ...step, status: aggregateStatus } : step));
}

function responseStep(provider: AIProvider, status: ProcessTraceStepStatus, locale: Locale, content = ''): ProcessTraceStep {
  return {
    id: `free-response-${provider}`,
    kind: 'response',
    provider,
    label: `${AI_PROVIDERS[provider].name} ${t('processTrace.response', locale)}`,
    detail: content ? oneLinePreview(content) : t('processTrace.waitingForResponse', locale),
    content: content || undefined,
    status,
    startedAt: status === 'active' ? Date.now() : undefined,
    lastOutputAt: content ? Date.now() : undefined,
  };
}

function responsePayloadText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const text = (payload as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

function oneLinePreview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function rolePayload(payload: unknown): { role?: string; label?: string; turn?: number } {
  if (!payload || typeof payload !== 'object') return {};
  const typed = payload as { role?: unknown; label?: unknown; turn?: unknown };
  return {
    role: typeof typed.role === 'string' ? typed.role : undefined,
    label: typeof typed.label === 'string' ? typed.label : undefined,
    turn: typeof typed.turn === 'number' ? typed.turn : undefined,
  };
}

function isTraceResponse(message: BridgeMessage): boolean {
  return (
    (message.action === 'RESPONSE_CHUNK' || message.action === 'RESPONSE_DONE') &&
    Boolean(message.provider) &&
    (message.transport === 'pull' || message.transport === 'local')
  );
}

function isKnownProvider(provider: unknown): provider is AIProvider {
  return typeof provider === 'string' && provider in AI_PROVIDERS;
}

function providerNames(providers: AIProvider[]): string {
  return providers.map((provider) => AI_PROVIDERS[provider].name).join(', ');
}
