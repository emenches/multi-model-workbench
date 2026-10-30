import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ConsultRoles } from '../../shared/types';
import type { Locale } from '../i18n/resolve';
import type { ResponseLanguagePolicy } from './responseLanguage';
import { appendResponseLanguageReminder, prependResponseLanguagePolicy } from './responseLanguage';
import { consultGraph } from './graph/consultGraph';
import { renderRegisteredPrompt, renderRegisteredTemplate } from './graph/registries';
import { SKIP_RESPONSE } from './state';
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
  responseLanguagePolicy?: ResponseLanguagePolicy;
  /** Supplied only by deterministic tests or explicitly selected host modes. */
  prepareProvider?: PrepareProviderConversation;
  transport?: IsolatedNativeTurnHost;
}

export interface ConsultConversationRequest {
  runId: string;
  sessionId: string;
  question: string;
  roles: ConsultRoles;
  locale?: Locale;
  responseLanguagePolicy?: ResponseLanguagePolicy;
  prepareProvider?: PrepareProviderConversation;
  transport?: IsolatedNativeTurnHost;
}

/** Uses exactly the current Consult graph's prompt and label definitions. */
function consultPrompt(
  nodeId: 'first' | 'second' | 'reviewer' | 'summary',
  provider: AIProvider,
  args: string[],
  locale?: Locale,
  policy?: ResponseLanguagePolicy,
): string {
  const node = consultGraph.nodes[nodeId];
  if (node.kind !== 'step') throw new Error('Consult graph step definition is unavailable');
  const rendered = renderRegisteredPrompt(node.prompt, args, {
    graph: consultGraph, nodeId, provider, locale,
  });
  return appendResponseLanguageReminder(prependResponseLanguagePolicy(rendered, policy), policy);
}

function consultLabel(
  nodeId: 'first' | 'second' | 'reviewer' | 'summary',
  provider: AIProvider,
  locale?: Locale,
): string {
  const node = consultGraph.nodes[nodeId];
  if (node.kind !== 'step' || !node.label) return nodeId;
  return renderRegisteredTemplate(node.label, [], { graph: consultGraph, nodeId, provider, locale });
}

/**
 * Parallel-capable native runtime for Simple Chat, Free fanout and Consult.
 * It does NOT call the legacy global runWorkflow singleton. The coordinator
 * guarantees exclusive provider leases and preserves transcript ownership;
 * each provider turn has its own abort handler.
 *
 * Debate/Coding/Roundtable/Brainstorm continue using the legacy graph
 * executor until their global checkpoints, snapshots and status are isolated.
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
        const outcomes = await Promise.allSettled(context.providers.map((provider) =>
          executeIsolatedNativeTurn(
            context, provider,
            appendResponseLanguageReminder(
              prependResponseLanguagePolicy(request.prompt, request.responseLanguagePolicy),
              request.responseLanguagePolicy,
            ),
            request.transport,
          ),
        ));
        // Keep *every* native provider lease until all its active turns have
        // settled. Promise.all would reject early and release other providers
        // while their old requests were still writing into shared WebViews.
        if (outcomes.some((result) => result.status === 'rejected')) {
          throw new Error('One or more provider requests did not complete');
        }
      },
    });
  }

  /**
   * Four-stage Consult, including the two independent initial providers,
   * reviewer, and final summary. All steps are isolated to this run: the
   * legacy global graph executor is never invoked or reset.
   */
  startConsult(request: ConsultConversationRequest): ScheduledConversationJob {
    const { roles } = request;
    if (roles.first === roles.second) throw new Error('Consult requires two independent initial providers');
    const providers = [...new Set(Object.values(roles))];
    return this.coordinator.schedule({
      runId: request.runId,
      sessionId: request.sessionId,
      providers,
      ...(request.prepareProvider ? { prepareProvider: request.prepareProvider } : {}),
      execute: async (context) => {
        const run = async (
          nodeId: 'first' | 'second' | 'reviewer' | 'summary',
          args: string[],
        ): Promise<string> => {
          if (context.signal.aborted) throw new Error('Consult cancelled');
          const provider = roles[nodeId];
          const label = consultLabel(nodeId, provider, request.locale);
          // A local role annotation is applied only after the native session
          // has been authenticated and claimed by the executing run.
          this.coordinator.acceptBridgeMessage({
            v: 1, action: 'ROLE_ASSIGNMENT', provider, transport: 'local',
            payload: { role: nodeId, label },
          });
          const result = await executeIsolatedNativeTurn(
            context, provider,
            consultPrompt(nodeId, provider, args, request.locale, request.responseLanguagePolicy),
            request.transport,
          );
          return result.response;
        };
        const question = request.question;
        const [firstResult, secondResult] = await Promise.allSettled([
          run('first', [question]), run('second', [question]),
        ]);
        if (context.signal.aborted) throw new Error('Consult cancelled');
        // The legacy graph may review one valid initial answer even when the
        // other agent failed; never forward raw exception/error messages.
        const first = firstResult.status === 'fulfilled' ? firstResult.value : SKIP_RESPONSE;
        const second = secondResult.status === 'fulfilled' ? secondResult.value : SKIP_RESPONSE;
        const unusable = (answer: string) => answer === SKIP_RESPONSE || answer.trim().startsWith('[Error:');
        if (unusable(first) && unusable(second)) {
          throw new Error('Both initial Consult responses were unavailable');
        }
        const reviewer = await run('reviewer', [
          question, first, AI_PROVIDERS[roles.first].name, second, AI_PROVIDERS[roles.second].name,
        ]);
        if (context.signal.aborted) throw new Error('Consult cancelled');
        await run('summary', [
          question, first, AI_PROVIDERS[roles.first].name, second, AI_PROVIDERS[roles.second].name,
          reviewer, AI_PROVIDERS[roles.reviewer].name,
        ]);
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
