import type { AIProvider, BridgeMessage } from '../../shared/types';
import type { ConversationSession } from '../ui/conversationSessions';
import {
  ConversationExecutionScheduler,
  type ConversationJobSnapshot,
  type ScheduledConversationJob,
} from './conversationScheduler';
import { ConversationRunRouter, type ConversationRunOwner } from './conversationRunRouter';
import { ConversationTranscriptInbox } from './conversationTranscriptInbox';

/**
 * Native provider preparation MUST establish a new, authenticated conversation
 * and return its actual bridge boot ID. Never manufacture a boot ID from a URL
 * or an earlier status. In particular, Claude login/SSO/challenge pages must
 * keep the existing no-script, no-reload security rules.
 */
export type PrepareProviderConversation = (
  provider: AIProvider,
  signal: AbortSignal,
) => Promise<string>;

export interface ConversationWorkContext {
  readonly owner: ConversationRunOwner;
  readonly signal: AbortSignal;
  readonly providers: readonly AIProvider[];
  /** Turn reservations only belong to this run while its provider is leased. */
  claimTurn(provider: AIProvider, turn: number): void;
}

export interface ConversationWork {
  readonly runId: string;
  readonly sessionId: string;
  readonly providers: readonly AIProvider[];
  readonly prepareProvider: PrepareProviderConversation;
  readonly execute: (context: ConversationWorkContext) => Promise<void>;
}

export interface ConversationSessionStore {
  /** Called atomically, not with a stale copy of the selected conversation. */
  update: (reducer: (sessions: readonly ConversationSession[]) => ConversationSession[]) => void;
}

/**
 * The integration boundary for session-owned work. It binds the provider
 * scheduler, native-document quarantine, transcript ownership, and UI-agnostic
 * job status without depending on the currently viewed conversation.
 *
 * Legacy runWorkflow() still owns global workflow runtime state; do not wire
 * that singleton to execute() until cancellation/checkpoint/snapshot/status
 * events have been moved to per-run contexts.
 */
export class ConversationCoordinator {
  readonly scheduler = new ConversationExecutionScheduler();
  private readonly router = new ConversationRunRouter();
  private readonly inbox = new ConversationTranscriptInbox();

  constructor(private readonly store: ConversationSessionStore) {}

  schedule(work: ConversationWork): ScheduledConversationJob {
    const owner = { runId: work.runId, sessionId: work.sessionId };
    this.router.registerRun(owner);
    let scheduled: ScheduledConversationJob;
    try {
      scheduled = this.scheduler.schedule({
        id: work.runId, sessionId: work.sessionId, providers: work.providers,
        execute: async (signal) => {
          // A job owns ALL its native provider leases until its executor has
          // returned, even after the user requests cancellation.
          for (const provider of [...new Set(work.providers)]) {
            if (signal.aborted) return;
            this.router.claimProvider(owner.runId, provider);
            const bootId = await work.prepareProvider(provider, signal);
            if (signal.aborted) return;
            if (!this.router.confirmFreshProviderSession(owner.runId, provider, bootId)) {
              throw new Error('The provider did not prove a fresh native conversation');
            }
          }
          if (signal.aborted) return;
          await work.execute({
            owner, signal, providers: [...new Set(work.providers)],
            claimTurn: (provider, turn) => {
              if (signal.aborted || !work.providers.includes(provider)) {
                throw new Error('Provider turn is not owned by the active conversation');
              }
              this.router.claimProvider(owner.runId, provider, turn);
            },
          });
        },
      });
    } catch (error) {
      this.router.finishRun(owner.runId);
      throw error;
    }
    // Also covers cancellation before a queued job reaches execute().
    void scheduled.finished.then(() => {
      this.router.finishRun(owner.runId);
      this.inbox.finishRun(owner.runId);
    });
    return scheduled;
  }

  /**
   * Ignore unowned, stale-turn and stale-native-boot responses. The store
   * callback must persist or expose the new state independently of navigation.
   */
  acceptBridgeMessage(message: BridgeMessage): boolean {
    const routed = this.router.route(message);
    if (!routed) return false;
    this.store.update((sessions) => this.inbox.apply(sessions, routed));
    return true;
  }

  cancel(runId: string): boolean {
    return this.scheduler.cancel(runId);
  }

  status(runId: string): ConversationJobSnapshot | undefined {
    return this.scheduler.snapshot(runId);
  }

  subscribe(listener: (job: ConversationJobSnapshot) => void): () => void {
    return this.scheduler.subscribe(listener);
  }
}
