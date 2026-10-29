import type { AIProvider, BridgeMessage } from '../../shared/types';

/**
 * Routes native provider responses to the *executing* conversation, never to
 * whichever conversation the user happens to be viewing. Provider leases must
 * be acquired before claiming a provider here. Legacy workflow events without
 * run IDs may be assigned only while that provider has exactly one owner.
 */
export interface ConversationRunOwner {
  runId: string;
  sessionId: string;
}

export interface RoutedConversationMessage {
  owner: ConversationRunOwner;
  message: BridgeMessage;
}

interface ProviderClaim {
  owner: ConversationRunOwner;
  turn?: number;
}

export class ConversationRunRouter {
  private readonly claims = new Map<AIProvider, ProviderClaim>();
  private readonly owners = new Map<string, string>();

  registerRun(owner: ConversationRunOwner): void {
    if (!owner.runId || !owner.sessionId) throw new Error('Missing conversation or run identifier');
    const existing = this.owners.get(owner.runId);
    if (existing !== undefined && existing !== owner.sessionId) {
      throw new Error('Run ID already belongs to a different conversation');
    }
    this.owners.set(owner.runId, owner.sessionId);
  }

  claimProvider(runId: string, provider: AIProvider, turn?: number): void {
    const sessionId = this.owners.get(runId);
    if (!sessionId) throw new Error('Unknown conversation run');
    const existing = this.claims.get(provider);
    if (existing && existing.owner.runId !== runId) {
      throw new Error('Provider is already claimed by another conversation');
    }
    this.claims.set(provider, { owner: { runId, sessionId }, turn });
  }

  route(message: BridgeMessage): RoutedConversationMessage | undefined {
    if (!message.provider) return undefined;
    const claim = this.claims.get(message.provider);
    if (!claim) return undefined;
    // Status reports are provider health events, not conversation content.
    if (!['RESPONSE_CHUNK', 'RESPONSE_DONE', 'WORKFLOW_STEP_CONFIRMED', 'WORKFLOW_STEP_FAILED', 'ROLE_ASSIGNMENT'].includes(message.action)) {
      return undefined;
    }
    const tagged = message.payload && typeof message.payload === 'object'
      ? message.payload as { turn?: unknown }
      : undefined;
    if (claim.turn !== undefined && typeof tagged?.turn === 'number' && tagged.turn !== claim.turn) {
      return undefined;
    }
    return { owner: { ...claim.owner }, message };
  }

  releaseProvider(runId: string, provider: AIProvider): void {
    if (this.claims.get(provider)?.owner.runId === runId) this.claims.delete(provider);
  }

  finishRun(runId: string): void {
    for (const [provider, claim] of this.claims) {
      if (claim.owner.runId === runId) this.claims.delete(provider);
    }
    this.owners.delete(runId);
  }

  ownerForProvider(provider: AIProvider): ConversationRunOwner | undefined {
    const claim = this.claims.get(provider);
    return claim ? { ...claim.owner } : undefined;
  }
}
