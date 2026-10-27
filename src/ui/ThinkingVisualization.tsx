import { useEffect, useState, type CSSProperties } from 'react';
import type { AIProvider, ProviderState } from '../../shared/types';
import type { Locale } from '../i18n/resolve';
import { t } from '../i18n/t';
import { activeStepActivity } from './activeStepActivity';
import type { ProcessTraceStep } from './processTraceModel';

const dots = Array.from({ length: 26 }, (_, index) => {
  const a = index * Math.PI * (3 - Math.sqrt(5));
  const r = 15 + Math.sqrt(index / 26) * 61;
  return {
    x: 360 + Math.cos(a) * r * 2.5,
    y: 98 + Math.sin(a) * r * 0.83,
    delay: (index % 8) * -.28,
    size: index % 6 === 0 ? 2.8 : 1.6,
  };
});

/** Original procedural waiting art. It is not a representation of reasoning,
 * token flow, predicted completion, or hidden model activity. */
export function ThinkingVisualization({
  activeSteps,
  states,
  locale = 'en',
}: {
  activeSteps: readonly ProcessTraceStep[];
  states: Partial<Record<AIProvider, ProviderState>>;
  locale?: Locale;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const step = activeSteps[0];
  if (!step) return null;
  const phase = activeStepActivity(step, Boolean(step.provider && states[step.provider]?.thinking), now)?.phase ?? 'waiting';
  const key = phase === 'receiving' ? 'processTrace.receiving'
    : phase === 'generating' ? 'processTrace.generating'
    : phase === 'no-update' ? 'processTrace.noRecentOutput'
    : 'processTrace.awaiting';

  return (
    <section className="workbench-thinking-visual mx-auto w-full max-w-3xl" role="status" aria-label={t('thinkingViz.heading', locale)}>
      <svg className="workbench-thinking-svg" viewBox="0 0 720 196" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <radialGradient id="workbench-thinking-aura"><stop stopColor="#75a0e0" stopOpacity=".17"/><stop offset="1" stopColor="#75a0e0" stopOpacity="0"/></radialGradient>
          <linearGradient id="workbench-thinking-line"><stop stopColor="#66a8d5"/><stop offset=".55" stopColor="#ab9bd9"/><stop offset="1" stopColor="#73b7b2"/></linearGradient>
        </defs>
        <ellipse cx="360" cy="98" rx="211" ry="95" fill="url(#workbench-thinking-aura)"/>
        <g className="workbench-thinking-orbit-a" transform="translate(360 98)">
          <ellipse rx="144" ry="52" fill="none" stroke="url(#workbench-thinking-line)" strokeWidth="1.1" strokeDasharray="8 10" opacity=".60"/>
          <circle cx="144" cy="0" r="4" fill="#7bc0e9"/>
        </g>
        <g className="workbench-thinking-orbit-b" transform="translate(360 98)">
          <ellipse rx="108" ry="65" fill="none" stroke="url(#workbench-thinking-line)" strokeWidth="1.2" opacity=".44"/>
          <circle cx="-108" cy="0" r="3" fill="#a394e3"/>
        </g>
        <g className="workbench-thinking-center" transform="translate(360 98)">
          <circle r="37" fill="none" stroke="#82a8e2" opacity=".3"/>
          <circle r="23" fill="none" stroke="#83c3d9" opacity=".77"/>
          <circle r="9" fill="#82b5ea" opacity=".14"/>
          <circle r="4" fill="#83c3e8"/>
        </g>
        {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={dot.size}
          className="workbench-thinking-dot" style={{ '--thinking-delay': `${dot.delay}s` } as CSSProperties}
          fill={index % 3 === 0 ? '#a999e4' : index % 4 === 0 ? '#7bc4b8' : '#83b7e5'}/>)}
      </svg>
      <div className="workbench-thinking-caption flex flex-wrap items-center justify-center gap-2 text-xs">
        <span className="workbench-thinking-caption-mark" aria-hidden="true"/>
        <span className="font-medium">{t('thinkingViz.heading', locale)}</span>
        <span aria-hidden="true">·</span>
        <span>{t(key, locale)}</span>
        {activeSteps.length > 1 ? <span>· {activeSteps.length} {t('thinkingViz.models', locale)}</span> : null}
      </div>
    </section>
  );
}
