import { useEffect, useState } from 'react';
import type { Locale } from '../i18n/resolve';
import type { AIProvider, ProviderState } from '../../shared/types';
import { activeStepActivity } from './activeStepActivity';
import { formatI18n, t } from '../i18n/t';
import { AiSisterAvatar } from './AiSisterTheme';
import { ModalDialog } from './ModalDialog';
import { MarkdownText } from './MarkdownText';
import type { ProcessTraceState, ProcessTraceStep, ProcessTraceStepStatus } from './processTraceModel';

export function ProcessTrace({
  trace,
  locale = 'en',
  onDetailOpenChange,
  compact = false,
  expanded = true,
  states,
  onViewProvider,
}: {
  trace: ProcessTraceState;
  locale?: Locale;
  onDetailOpenChange?: (open: boolean) => void;
  compact?: boolean;
  expanded?: boolean;
  states?: Partial<Record<AIProvider, ProviderState>>;
  onViewProvider?: (provider: AIProvider) => void;
}) {
  const [detailStep, setDetailStep] = useState<ProcessTraceStep | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const liveSteps = trace.steps.filter((step) => step.status === 'active' && step.kind !== 'fanout');
  const confirmedSteps = trace.steps.filter((step) => step.status === 'done' && step.kind !== 'fanout').length;
  const totalSteps = trace.steps.filter((step) => step.kind !== 'fanout').length;
  const hasActive = trace.steps.some((step) => step.status === 'active');
  const highlightedSteps = liveSteps.length > 0
    ? liveSteps.slice(0, 2)
    : trace.steps.filter((step) => step.kind !== 'fanout' && step.status === 'failed').slice(-2);
  const additionalActiveCount = Math.max(0, liveSteps.length - highlightedSteps.length);

  useEffect(() => {
    if (!hasActive) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  useEffect(() => () => onDetailOpenChange?.(false), [onDetailOpenChange]);

  if (trace.steps.length === 0 && !trace.currentStatus) return null;

  const closeDetail = () => {
    setDetailStep(undefined);
    onDetailOpenChange?.(false);
  };

  return (
    <>
      <section aria-label={t('processTrace.title', locale)} className={`ai-sister-process-trace workbench-process-trace mt-2 min-h-0 overflow-hidden rounded-xl border ${compact ? 'border-transparent bg-transparent dark:bg-transparent' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'}`}>
        {!compact ? (
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
            <h2 className="text-[0.6875rem] font-semibold uppercase text-zinc-700 dark:text-zinc-300">{t('processTrace.title', locale)}</h2>
            <div className="min-w-0 truncate text-right text-[0.6875rem] text-sky-700 dark:text-sky-200">{trace.currentStatus || t('processTrace.settled', locale)}</div>
          </div>
        ) : null}
        {!expanded ? (
          <div className="workbench-trace-compact flex flex-wrap items-center gap-2 px-1.5 py-2">
            {highlightedSteps.length > 0 ? highlightedSteps.map((step) => {
              const activity = activeStepActivity(step, Boolean(step.provider && states?.[step.provider]?.thinking), nowMs);
              const phase = activity
                ? t(activity.phase === 'no-update'
                  ? 'processTrace.noRecentOutput'
                  : activity.phase === 'generating'
                    ? 'processTrace.generating'
                    : activity.phase === 'receiving'
                      ? 'processTrace.receiving'
                      : 'processTrace.awaiting', locale)
                : t('processTrace.failed', locale);
              return (
                <div key={step.id} className="workbench-trace-compact-item flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  {activity ? <span className="workbench-live-indicator" aria-hidden="true" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{step.label}</span>
                    <span className="block truncate text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{phase}</span>
                  </span>
                  {activity ? <span className="workbench-trace-compact-time shrink-0 text-[0.6875rem] tabular-nums text-zinc-500 dark:text-zinc-400">{formatElapsed(activity.elapsedSeconds)}</span> : null}
                </div>
              );
            }) : (
              <span className="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                {trace.currentStatus || formatI18n(t('processTrace.stepsConfirmed', locale), { done: confirmedSteps, total: totalSteps })}
              </span>
            )}
            {additionalActiveCount > 0 ? (
              <span className="workbench-trace-compact-overflow shrink-0 px-2 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
                +{formatI18n(t('processTrace.activeCount', locale), { count: additionalActiveCount })}
              </span>
            ) : null}
          </div>
        ) : null}
        {expanded && totalSteps > 0 ? (
          <div className="workbench-trace-overview flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 text-xs">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {formatI18n(t('processTrace.stepsConfirmed', locale), { done: confirmedSteps, total: totalSteps })}
            </span>
            {liveSteps.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-300">
                <span className="workbench-live-indicator" aria-hidden="true" />
                {formatI18n(t('processTrace.activeCount', locale), { count: liveSteps.length })}
              </span>
            ) : null}
          </div>
        ) : null}
        {expanded && trace.steps.length > 0 ? (
          <ol className="workbench-trace-steps max-h-[min(44vh,32rem)] space-y-1 overflow-y-auto px-1 pb-1">
            {trace.steps.map((step) => {
              const activity = activeStepActivity(step, Boolean(step.provider && states?.[step.provider]?.thinking), nowMs);
              const phaseText = activity
                ? t(activity.phase === 'no-update'
                  ? 'processTrace.noRecentOutput'
                  : activity.phase === 'generating'
                    ? 'processTrace.generating'
                    : activity.phase === 'receiving'
                      ? 'processTrace.receiving'
                      : 'processTrace.awaiting', locale)
                : '';
              return (
              <li key={step.id} className={`workbench-trace-step rounded-lg border transition-colors ${activity
                ? 'workbench-trace-step-active border-sky-200 bg-sky-50/70 dark:border-sky-900/80 dark:bg-sky-950/25'
                : 'border-transparent hover:border-zinc-200 dark:hover:border-zinc-800'}`}>
                <div className={`flex items-center gap-1 ${activity ? 'min-h-20' : ''}`}>
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-2.5 py-2.5 text-left text-xs hover:bg-white/50 disabled:cursor-default dark:hover:bg-zinc-950/30 sm:grid-cols-[auto_5.5rem_minmax(0,1fr)] sm:items-center"
                    disabled={!step.content}
                    onClick={() => {
                      if (!step.content) return;
                      setDetailStep(step);
                      onDetailOpenChange?.(true);
                    }}
                    title={step.content || step.detail || step.label}
                  >
                    <span className="flex items-center gap-1" aria-hidden="true">
                      <span className={`h-2 w-2 rounded-full ${statusDotClass(step.status)}`} />
                      {step.provider ? <AiSisterAvatar provider={step.provider} size="xs" active={step.status === 'active'} /> : null}
                    </span>
                    <span className={`flex items-center gap-1 truncate text-[0.6875rem] font-semibold uppercase tracking-wide ${statusClass(step.status)}`}>
                      {step.status === 'active' ? (
                        <span role="img" aria-label={t('processTrace.active', locale)}
                          className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-sky-500 border-t-transparent motion-safe:animate-spin"
                        />
                      ) : null}
                      {statusLabel(step.status, locale)}
                    </span>
                    <span className="col-start-2 min-w-0 overflow-hidden text-zinc-800 dark:text-zinc-200 sm:col-start-3">
                      <span className="block truncate font-medium">{step.label}</span>
                      {activity ? (
                        <span className="mt-1 block text-[0.75rem] leading-relaxed text-sky-700 dark:text-sky-300">
                          {phaseText}
                          {activity.phase === 'no-update' ? (
                            <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                              ({activity.secondsWithoutNewText}s)
                            </span>
                          ) : null}
                          <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                            {formatI18n(t('processTrace.elapsed', locale), { time: formatElapsed(activity.elapsedSeconds) })}
                          </span>
                          <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                            {step.content
                              ? formatI18n(t('processTrace.characters', locale), { count: step.content.length.toLocaleString() })
                              : t('processTrace.noOutputYet', locale)}
                          </span>
                        </span>
                      ) : step.detail ? (
                        <span className="block truncate text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{step.detail}</span>
                      ) : null}
                    </span>
                  </button>
                  {activity && step.provider && onViewProvider ? (
                    <button type="button"
                      className="mr-2 shrink-0 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-[0.6875rem] font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-zinc-900 dark:text-sky-300 dark:hover:bg-zinc-800"
                      onClick={() => onViewProvider(step.provider!)}
                    >{t('processTrace.viewLive', locale)}</button>
                  ) : null}
                </div>
                {activity ? (
                  <div className="workbench-activity-track mx-2.5 mb-2.5 h-1 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-950/70" aria-hidden="true">
                    <div className="workbench-activity-sweep h-full w-1/3 rounded-full bg-sky-500/70" />
                  </div>
                ) : null}
              </li>
              );
            })}
          </ol>
        ) : expanded ? (
          <div className="px-2.5 py-2 text-xs text-zinc-500 dark:text-zinc-500">{t('processTrace.waitingEvents', locale)}</div>
        ) : null}
      </section>
      {detailStep?.content ? (
        <ModalDialog
          titleId="process-trace-detail-title"
          onEscape={closeDetail}
          onBackdrop={closeDetail}
          panelClassName="max-h-[82vh] w-full max-w-3xl overflow-auto rounded-lg border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
        >
          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <div>
              <h2 id="process-trace-detail-title" className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {detailStep.provider ? <AiSisterAvatar provider={detailStep.provider} size="md" active={detailStep.status === 'active'} /> : null}
                <span>{detailStep.label}</span>
              </h2>
              <div className={`mt-1 text-xs uppercase ${statusClass(detailStep.status)}`}>{statusLabel(detailStep.status, locale)}</div>
            </div>
            <button type="button" className="border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={closeDetail}>
              {t('settings.close', locale)}
            </button>
          </div>
          <div className="mt-4 text-sm text-zinc-800 dark:text-zinc-200">
            <MarkdownText text={detailStep.content} />
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function statusLabel(status: ProcessTraceStepStatus, locale: Locale): string {
  if (status === 'pending') return t('processTrace.pending', locale);
  if (status === 'active') return t('processTrace.active', locale);
  if (status === 'failed') return t('processTrace.failed', locale);
  return t('processTrace.done', locale);
}

function statusClass(status: ProcessTraceStepStatus): string {
  if (status === 'pending') return 'text-zinc-500 dark:text-zinc-500';
  if (status === 'active') return 'text-sky-700 dark:text-sky-300';
  if (status === 'failed') return 'text-red-700 dark:text-red-300';
  return 'text-emerald-700 dark:text-emerald-300';
}

function statusDotClass(status: ProcessTraceStepStatus): string {
  if (status === 'pending') return 'bg-zinc-400';
  if (status === 'active') return 'bg-sky-500';
  if (status === 'failed') return 'bg-red-500';
  return 'bg-emerald-500';
}
