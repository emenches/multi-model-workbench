import type { AIProvider, BridgeMessage } from '../../shared/types';
import { onBridgeMessage } from '../bridge/bus';
import { lastSeenProviderBoot } from '../bridge/pull';
import { host } from '../host';

export interface NativeConversationSessionDependencies {
  startNewSession: (provider: AIProvider) => Promise<void>;
  lastObservedBoot: (provider: AIProvider) => string | undefined;
  subscribe: (listener: (message: BridgeMessage) => void) => () => void;
}

const nativeSessionDependencies: NativeConversationSessionDependencies = {
  startNewSession: host.provider.newSession,
  lastObservedBoot: lastSeenProviderBoot,
  subscribe: onBridgeMessage,
};

/**
 * Prepare a fresh conversation in the EXISTING authenticated provider WebView.
 *
 * The native command enforces the provider's known app URL, guarded login
 * policy and its own verified ready-boot check. This layer only observes the
 * resulting authenticated document's new boot; it cannot eval arbitrary JS,
 * reload a login tab, or manufacture a boot from a URL.
 *
 * The caller MUST hold an exclusive provider lease through this entire call.
 */
export async function prepareFreshNativeConversation(
  provider: AIProvider,
  signal: AbortSignal,
  deps: NativeConversationSessionDependencies = nativeSessionDependencies,
  observationTimeoutMs = 10_000,
): Promise<string> {
  if (signal.aborted) throw new Error('Conversation was cancelled before native preparation');

  const previousBoot = deps.lastObservedBoot(provider);
  let newBoot: string | undefined;
  let notify: (boot: string | undefined) => void = () => {};
  const observed = new Promise<string | undefined>((resolve) => { notify = resolve; });
  const unsubscribe = deps.subscribe((message) => {
    if (message.provider !== provider || message.action !== 'STATUS_REPORT') return;
    if (!message.bootId || message.bootId === previousBoot) return;
    newBoot = message.bootId;
    notify(newBoot);
  });
  const onAbort = () => notify(undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Do not trust a boot observation alone. Native must first confirm
    // it navigated to a fresh, fully initialized provider session.
    await deps.startNewSession(provider);
    if (signal.aborted) throw new Error('Conversation was cancelled during native preparation');
    const currentBoot = deps.lastObservedBoot(provider);
    if (currentBoot && currentBoot !== previousBoot) return currentBoot;
    if (newBoot && newBoot !== previousBoot) return newBoot;
    const timeout = new Promise<string | undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), observationTimeoutMs);
    });
    const detected = await Promise.race([observed, timeout]);
    if (signal.aborted) throw new Error('Conversation was cancelled during native preparation');
    if (!detected || detected === previousBoot) {
      throw new Error('New native conversation did not publish a fresh bridge boot');
    }
    return detected;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    unsubscribe();
  }
}
