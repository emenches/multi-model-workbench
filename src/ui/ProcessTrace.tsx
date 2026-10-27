import { useEffect, useState } from 'react';
import type { Locale } from '../i18n/resolve';
import type { AIProvider, ProviderState } from '../../shared/types';
import { activeStepActivity } from './activeStepActivity';
import { t } from '../i18n/t';
import { AiSisterAvatar } from './AiSisterTheme';
import { ModalDialog } from './ModalDialog';
import { MarkdownText } from './MarkdownText';
import type { ProcessTraceState, ProcessTraceStep, ProcessTraceStepStatus } from './processTraceModel';

export function ProcessTrace({
  trace,
  locale = 'en',
  onDetailOpenChange,
  compact = false,
  states,
  onViewProvider,
}: {
  trace: ProcessTraceState;
  locale?: Locale;
  onDetailOpenChange?: (open: boolean) => void;
  compact?: boolean;
  states?: Partial<Record<AIProvider, ProviderState>>;
  onViewProvider?: (provider: AIProvider) => void;
}) {
  const [detailStep, setDetailStep] = useState<ProcessTraceStep | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasActive = trace.steps.some((step) => step.status === 'active');

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
      <section aria-label={t('processTrace.title', locale)} className={`ai-sister-process-trace mt-2 shrink-0 overflow-hidden rounded-lg border ${compact ? 'border-transparent bg-transparent dark:bg-transparent' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900'}`}>
        {!compact ? (
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
            <h2 className="text-[0.6875rem] font-semibold uppercase text-zinc-700 dark:text-zinc-300">{t('processTrace.title', locale)}</h2>
            <div className="min-w-0 truncate text-right text-[0.6875rem] text-sky-700 dark:text-sky-200">{trace.currentStatus || t('processTrace.settled', locale)}</div>
          </div>
        ) : null}
        {trace.steps.length > 0 ? (
          <ol className="max-h-56 divide-y divide-zinc-200 overflow-auto dark:divide-zinc-800">
            {trace.steps.map((step) => {
              const activity = activeStepActivity(step, Boolean(step.provider && states?.[step.provider]?.thinking), nowMs);
              const phaseText = activity
                ? activity.phase === 'no-update'
                  ? `${t('processTrace.noRecentOutput', locale)} · ${activity.secondsWithoutNewText}s`
                  : `${t(activity.phase === 'generating' ? 'processTrace.generating' : activity.phase === 'receiving' ? 'processTrace.receiving' : 'processTrace.awaiting', locale)} · ${activity.elapsedSeconds}s`
                : '';
              return (
              <li key={step.id}>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 grid-cols-[auto_6.5rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-white disabled:cursor-default dark:hover:bg-zinc-950"
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
                    <span className={`flex items-center gap-1 truncate text-[0.6875rem] font-medium uppercase ${statusClass(step.status)}`}>
                      {step.status === 'active' ? (
                        <span role="img" aria-label={t('processTrace.active', locale)}
                          className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-sky-500 border-t-transparent motion-safe:animate-spin"
                        />
                      ) : null}
                      {statusLabel(step.status, locale)}
                    </span>
                    <span className="min-w-0 overflow-hidden text-zinc-800 dark:text-zinc-200">
                      <span className="block truncate font-medium">{step.label}</span>
                      {activity ? (
                        <span className="block truncate text-[0.6875rem] text-sky-700 dark:text-sky-300">
                          {phaseText}
                        </span>
                      ) : step.detail ? (
                        <span className="block truncate text-[0.6875rem] text-zinc-500 dark:text-zinc-400">{step.detail}</span>
                      ) : null}
                    </span>
                  </button>
                  {activity && step.provider && onViewProvider ? (
                    <button type="button"
                      className="mr-1 shrink-0 rounded-md border border-zinc-200 px-2 py-1.5 text-[0.6875rem] text-sky-700 hover:bg-sky-50 dark:border-zinc-800 dark:text-sky-300 dark:hover:bg-zinc-900"
                      onClick={() => onViewProvider(step.provider!)}
                    >{t('processTrace.viewLive', locale)}</button>
                  ) : null}
                </div>
              </li>
              );
            })}
          </ol>
        ) : (
          <div className="px-2.5 py-2 text-xs text-zinc-500 dark:text-zinc-500">{t('processTrace.waitingEvents', locale)}</div>
        )}
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
