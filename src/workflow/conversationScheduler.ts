import type { AIProvider } from '../../shared/types';

/**
 * Owns cross-conversation job scheduling without ever sharing one native provider
 * WebView between simultaneously executing jobs. This is the safe foundation
 * for multi-conversation execution; callers must still provide isolated
 * workflow state, event routing and cancellation before using real graphs
 * concurrently. The current legacy graph runtime is a singleton.
 */
export type ConversationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ConversationJobSnapshot {
  id: string;
  sessionId: string;
  providers: readonly AIProvider[];
  status: ConversationJobStatus;
  error?: string;
}

export interface ScheduleConversationJob {
  id: string;
  sessionId: string;
  providers: readonly AIProvider[];
  execute: (signal: AbortSignal) => Promise<void>;
}

export interface ScheduledConversationJob {
  id: string;
  finished: Promise<ConversationJobSnapshot>;
}

interface JobRecord {
  spec: ScheduleConversationJob;
  status: ConversationJobStatus;
  controller: AbortController;
  resolve: (snapshot: ConversationJobSnapshot) => void;
  finished: Promise<ConversationJobSnapshot>;
  error?: string;
}

type Listener = (snapshot: ConversationJobSnapshot) => void;

export class ConversationExecutionScheduler {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly pending: string[] = [];
  private readonly leased = new Map<AIProvider, string>();
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  schedule(spec: ScheduleConversationJob): ScheduledConversationJob {
    if (!spec.id || !spec.sessionId) throw new Error('A job and conversation ID are required');
    if (this.jobs.has(spec.id)) throw new Error('Duplicate conversation job ID');
    const providers = [...new Set(spec.providers)];
    if (providers.length === 0) throw new Error('A conversation job needs at least one provider');
    const canonical = { ...spec, providers };
    let resolve!: (snapshot: ConversationJobSnapshot) => void;
    const finished = new Promise<ConversationJobSnapshot>((done) => { resolve = done; });
    const job: JobRecord = {
      spec: canonical,
      controller: new AbortController(),
      status: 'queued',
      resolve,
      finished,
    };
    this.jobs.set(spec.id, job);
    this.pending.push(spec.id);
    this.emit(job);
    this.drain();
    return { id: spec.id, finished };
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.status)) return false;
    job.controller.abort();
    if (job.status === 'queued') {
      this.pending.splice(this.pending.indexOf(id), 1);
      this.finish(job, 'cancelled');
      this.drain();
    }
    // Running work retains its leases until execute() settles. A second job
    // may never send to the same native provider while cancellation is pending.
    return true;
  }

  snapshot(id: string): ConversationJobSnapshot | undefined {
    const job = this.jobs.get(id);
    return job ? this.copy(job) : undefined;
  }

  snapshots(): ConversationJobSnapshot[] {
    return [...this.jobs.values()].map((job) => this.copy(job));
  }

  private drain(): void {
    // Preserve first-in-line priority for each provider, but permit unrelated
    // queued work to start immediately instead of head-of-line blocking.
    const earlierPending = new Set<AIProvider>();
    for (const id of [...this.pending]) {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      const providers = job.spec.providers;
      const blocked = providers.some((provider) => earlierPending.has(provider) || this.leased.has(provider));
      if (blocked) {
        providers.forEach((provider) => earlierPending.add(provider));
        continue;
      }
      this.pending.splice(this.pending.indexOf(id), 1);
      providers.forEach((provider) => this.leased.set(provider, id));
      job.status = 'running';
      this.emit(job);
      // No promise continuation may own the lease beyond its own job.
      void Promise.resolve()
        .then(() => job.spec.execute(job.controller.signal))
        .then(
          () => this.finish(job, job.controller.signal.aborted ? 'cancelled' : 'completed'),
          (error: unknown) => this.finish(
            job,
            job.controller.signal.aborted ? 'cancelled' : 'failed',
            error instanceof Error ? error.name : 'workflow-error',
          ),
        )
        .finally(() => {
          for (const provider of providers) {
            if (this.leased.get(provider) === id) this.leased.delete(provider);
          }
          this.drain();
        });
    }
  }

  private finish(job: JobRecord, status: 'completed' | 'failed' | 'cancelled', error?: string): void {
    if (isTerminal(job.status)) return;
    job.status = status;
    job.error = error;
    const snapshot = this.copy(job);
    this.emit(job);
    job.resolve(snapshot);
  }

  private copy(job: JobRecord): ConversationJobSnapshot {
    return {
      id: job.spec.id,
      sessionId: job.spec.sessionId,
      providers: [...job.spec.providers],
      status: job.status,
      ...(job.error ? { error: job.error } : {}),
    };
  }

  private emit(job: JobRecord): void {
    const snapshot = this.copy(job);
    for (const listener of this.listeners) listener(snapshot);
  }
}

function isTerminal(status: ConversationJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
