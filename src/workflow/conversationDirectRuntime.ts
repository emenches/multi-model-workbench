import type { AIProvider } from '../../shared/types';
import { onBridgeMessage } from '../bridge/bus';
import type { ConversationSession } from '../ui/conversationSessions';
import { ConversationCoordinator, type ConversationSessionStore, type PrepareProviderConversation } from './conversationCoordinator';
import { executeIsolatedNativeTurn, type IsolatedNativeTurnHost } from './conversationDirectTurn';
import type { ScheduledConversationJob } from './conversationScheduler';

export interface DirectConversationRequest {
  runId: string;
  sessionId: string;
  /** Each target provider must have its own native lease. */
  providers: readonly AIProvider[];
  prompt: string;
  /** Supplied only by deterministic tests or explicitly selected host modes. */
  prepareProvider?: PrepareProviderConversation;
  transport?: IsolatedNativeTurnHost;
}

/**
 * First genuinely parallel-capable runtime for Simple Chat and Free fanout.
 * It does NOT call the legacy global runWorkflow singleton. The coordinator
 * guarantees exclusive provider leases and preserves transcript ownership;
 * each provider turn has its own abort handler.
 *
 * Structured Consult/Debate/Coding workflows continue using the legacy graph
 * executor until its global checkpoints, snapshots and status are isolated.
 * Do NOT mix this runtime with legacy execution before a global provider
 * lease gate has been established for both paths.
 */
export class ConversationDirectRuntime {
  readonly coordinator: ConversationCoordinator;
  private readonly unsubscribeBridge: () => void;

  constructor(store: ConversationSessionStore) {
    this.coordinator = new ConversationCoordinator(store);
    this.unsubscribeBridge = onBridgeMessage((message) => {
      this.coordinator.acceptBridgeMessage(message);
    });
  }

  start(request: DirectConversationRequest): ScheduledConversationJob {
    return this.coordinator.schedule({
      runId: request.runId,
      sessionId: request.sessionId,
      providers: request.providers,
      ...(request.prepareProvider ? { prepareProvider: request.prepareProvider } : {}),
      execute: async (context) => {
        // Providers are disjoint within this run. Exclusive leases prevent
        // simultaneous sends to the same native WebView across other runs.
        await Promise.all(context.providers.map((provider) =>
          executeIsolatedNativeTurn(context, provider, request.prompt, request.transport),
        ));
      },
    });
  }

  cancel(runId: string): boolean {
    return this.coordinator.cancel(runId);
  }

  dispose(): void {
    this.unsubscribeBridge();
  }

  /** The view is independent: the store may select any saved session. */
  snapshotForSession(
    sessionId: string,
  ): ReturnType<ConversationCoordinator['status']>[] {
    return this.coordinator.scheduler.snapshots()
      .filter((job) => job.sessionId === sessionId);
  }
}

export type { ConversationSession };
