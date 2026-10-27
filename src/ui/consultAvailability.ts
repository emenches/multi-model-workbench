import type { AIProvider, ConsultRoles, ProviderState } from '../../shared/types';
import { isSendable } from '../workflow/sendability';

/** The initial Consult answers run in parallel; they require separate services.
 * The later review and synthesis roles are sequential and can safely reuse them.
 */
export const MIN_CONSULT_PROVIDERS = 2;

export function availableConsultProviders(
  states: Partial<Record<AIProvider, ProviderState>>,
  activeProviders: readonly AIProvider[],
): AIProvider[] {
  return [...new Set(activeProviders)].filter((provider) => isSendable(states[provider]));
}

/**
 * Keep configured roles when the providers are ready. Otherwise select from
 * connected, currently sendable providers, without changing saved Settings.
 *
 * First and second MUST be distinct (parallel send). Reviewer and summary are
 * sequential, so they may reuse either provider when only two are connected.
 */
export function chooseConsultRoles(
  configured: ConsultRoles,
  available: readonly AIProvider[],
): ConsultRoles | undefined {
  const ready = [...new Set(available)];
  if (ready.length < MIN_CONSULT_PROVIDERS) return undefined;

  const first = ready.includes(configured.first)
    ? configured.first
    : ready.find((provider) => provider !== configured.second) ?? ready[0];
  const second = configured.second !== first && ready.includes(configured.second)
    ? configured.second
    : ready.find((provider) => provider !== first);
  if (!second) return undefined;

  return {
    first,
    second,
    reviewer: ready.includes(configured.reviewer) ? configured.reviewer : first,
    summary: ready.includes(configured.summary) ? configured.summary : second,
  };
}
