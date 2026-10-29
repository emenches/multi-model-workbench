import type { AIProvider } from '../../shared/types';
import { host } from '../host';
import { setProviderAwaiting } from '../bridge/pull';
import { clearInFlight, markInFlight } from './cancel';
import { reserveTurn } from './state';
import { rejectWaiter, waitForResponse } from './waitForResponse';
import type { ConversationWorkContext } from './conversationCoordinator';

export interface IsolatedNativeTurnHost {
  reserveTurn(provider: AIProvider): number;
  waitForResponse(provider: AIProvider, turn: number): Promise<string>;
  rejectWaiter(provider: AIProvider, turn: number, reason: Error): void;
  setAwaiting(provider: AIProvider, awaiting: boolean): void;
  markInFlight(provider: AIProvider): void;
  clearInFlight(provider: AIProvider): void;
  send(provider: AIProvider, text: string): Promise<void>;
  stop(provider: AIProvider): Promise<void>;
}

const nativeTurnHost: IsolatedNativeTurnHost = {
  reserveTurn,
  waitForResponse,
  rejectWaiter,
  setAwaiting: setProviderAwaiting,
  markInFlight,
  clearInFlight,
  send: host.provider.send,
  stop: host.provider.stop,
};

/**
 * Execute one provider turn within a conversation's already verified native
 * session. This can be used by Simple Chat / a fanout branch when that
 * provider is exclusively leased by the session's coordinator.
 *
 * Cancellation is scoped to the leased provider+turn, never the global
 * CANCEL_WORKFLOW bus, and the coordinator owns the waiter's output routing.
 */
export async function executeIsolatedNativeTurn(
  context: ConversationWorkContext,
  provider: AIProvider,
  prompt: string,
  transport: IsolatedNativeTurnHost = nativeTurnHost,
): Promise<{ turn: number; response: string }> {
  if (context.signal.aborted) throw new Error('Conversation cancelled before provider send');
  const turn = transport.reserveTurn(provider);
  // Fails closed if the provider lease was not acquired or the owner changed.
  context.claimTurn(provider, turn);

  const responsePromise = transport.waitForResponse(provider, turn);
  transport.setAwaiting(provider, true);
  transport.markInFlight(provider);

  const onAbort = () => {
    transport.rejectWaiter(provider, turn, new Error('Conversation cancelled'));
    void transport.stop(provider).catch(() => undefined);
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (context.signal.aborted) {
      onAbort();
      throw new Error('Conversation cancelled before provider send');
    }
    try {
      await transport.send(provider, prompt);
    } catch (error) {
      transport.rejectWaiter(provider, turn, error instanceof Error ? error : new Error('Provider send failed'));
      throw error;
    }
    const response = await responsePromise;
    if (context.signal.aborted) throw new Error('Conversation cancelled');
    return { turn, response };
  } finally {
    context.signal.removeEventListener('abort', onAbort);
    // The bus waiter clears the native awaiting state when it settles, but
    // also clean up if native send itself failed before a DONE arrived.
    transport.setAwaiting(provider, false);
    transport.clearInFlight(provider);
    // The promise may have rejected after a failed send or abort before the
    // await was reached. Observe it to avoid an unhandled rejection.
    void responsePromise.catch(() => undefined);
  }
}
