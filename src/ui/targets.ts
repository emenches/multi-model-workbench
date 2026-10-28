import type { AIProvider, ProviderState } from '../../shared/types';
import { isSendable } from '../workflow';

export interface FreeTargetSelection {
  targets: AIProvider[];
  defaultsInitialized: boolean;
  userTouched: boolean;
}

export function defaultTargets(states: Record<AIProvider, ProviderState>, providers: AIProvider[]): AIProvider[] {
  return providers.filter((provider) => isSendable(states[provider]));
}

export function applyFreeTargetDefaults(selection: FreeTargetSelection, defaults: AIProvider[]): FreeTargetSelection {
  if (selection.userTouched || selection.defaultsInitialized || defaults.length === 0) return selection;
  return { ...selection, targets: defaults, defaultsInitialized: true };
}

export function markFreeTargetsTouched(selection: FreeTargetSelection, targets: AIProvider[]): FreeTargetSelection {
  return { ...selection, targets, userTouched: true };
}

export function toggleTarget(selected: AIProvider[], provider: AIProvider): AIProvider[] {
  return selected.includes(provider) ? selected.filter((item) => item !== provider) : [...selected, provider];
}

export function freeModeTargets(selected: AIProvider[], states: Record<AIProvider, ProviderState>): AIProvider[] {
  return defaultTargets(states, selected);
}

// A session reset navigates provider pages. The first STATUS_REPORT can
// temporarily say logged_out/blocked before the login detector has rendered;
// the next report (often around 10 seconds later) may restore readiness.
// Wait for the transient state to settle before filtering fan-out targets.
export async function waitForProvidersSendable(
  providers: readonly AIProvider[],
  getStates: () => Record<AIProvider, ProviderState>,
  timeoutMs = 20_000,
  pollMs = 250,
  shouldAbort?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shouldAbort?.()) return;
    const states = getStates();
    if (providers.every((provider) => isSendable(states[provider]))) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  // On timeout, preserve the existing sendable-only fallback.
}

export function hasEffectiveFreeModeTargets(selected: AIProvider[], states: Record<AIProvider, ProviderState>): boolean {
  return freeModeTargets(selected, states).length > 0;
}

// Simple Chat is deliberately a separate choice from Free fan-out: never
// implicitly substitute another signed-in model when the selected model is
// unavailable, and never return more than one target.
export function simpleChatTargets(
  provider: AIProvider | undefined,
  states: Record<AIProvider, ProviderState>,
): AIProvider[] {
  return provider && isSendable(states[provider]) ? [provider] : [];
}
