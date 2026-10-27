import { POLL_PULL_MS } from '../../shared/constants';
import type { AIProvider, BridgeMessage } from '../../shared/types';
import { host } from '../host';
import { publishBridgeMessage } from './bus';

export const DONE_WATCHDOG_MS = 5000;
export const PULL_RECOVERY_DELAY_MS = 5_000;
export const PULL_RECOVERY_MAX_ATTEMPTS = 3;
export const AWAITING_MAX_MS = 10 * 60 * 1000;
export const AWAITING_ABSOLUTE_MAX_MS = 60 * 60 * 1000;

const lastConsumed = new Map<string, { bootId: string; mid: number }>();
const pending = new Set<AIProvider>();
const degraded = new Set<AIProvider>();
const recoveryTimers = new Map<AIProvider, ReturnType<typeof globalThis.setTimeout>>();
const recoveryAttempts = new Map<AIProvider, number>();
type PullFailureKind = 'callback_timeout' | 'callback_closed' | 'webview_unavailable' | 'invalid_json' | 'invalid_batch' | 'eval_failed';
const lastPullFailure = new Map<AIProvider, PullFailureKind>();
const pollTimers = new Map<AIProvider, ReturnType<typeof globalThis.setInterval>>();
const pullInflight = new Map<AIProvider, { promise: Promise<void>; force: boolean }>();
const activeBoot = new Map<AIProvider, string>();
// Survives resetProviderBootState so a later check-in can tell a new document from the one the reset dropped.
const lastSeenBoot = new Map<AIProvider, string>();
const bootRotationListeners = new Set<(provider: AIProvider) => void>();
const doneTimers = new Map<AIProvider, ReturnType<typeof globalThis.setTimeout>>();
const awaitingEpoch = new Map<AIProvider, number>();
const synthesizeInflight = new Map<AIProvider, { token: symbol; promise: Promise<void> }>();
let subscriptionPromise: Promise<() => void> | undefined;
let cleanupSubscription: (() => void) | undefined;
let refCount = 0;

export async function startBridgePull(): Promise<() => void> {
  refCount += 1;
  if (!subscriptionPromise) {
    subscriptionPromise = host.bridge.subscribeTitle(handleTitleMessage);
    void subscriptionPromise.then((cleanup) => {
      cleanupSubscription = cleanup;
      if (refCount === 0) {
        cleanupSubscription();
        cleanupSubscription = undefined;
        subscriptionPromise = undefined;
      }
    });
  }
  await subscriptionPromise;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && cleanupSubscription) {
      cleanupSubscription();
      cleanupSubscription = undefined;
      subscriptionPromise = undefined;
      for (const provider of [...pending]) setProviderAwaiting(provider, false);
      for (const timer of doneTimers.values()) globalThis.clearTimeout(timer);
      doneTimers.clear();
    }
  };
}

export function onProviderBootRotation(listener: (provider: AIProvider) => void): () => void {
  bootRotationListeners.add(listener);
  return () => bootRotationListeners.delete(listener);
}

export function handleTitleMessage(message: BridgeMessage): void {
  if (message.transport === 'title' && message.action !== 'STATUS_REPORT') return;
  if (message.provider && message.bootId) {
    const current = activeBoot.get(message.provider);
    if (current !== message.bootId) {
      // The first boot the host ever sees is startup. A reset clears activeBoot, so fall back to the
      // last bootId this host ever saw. Only a genuinely different document counts as a rotation.
      const previous = current ?? lastSeenBoot.get(message.provider);
      const rotated = previous !== undefined && previous !== message.bootId;
      activeBoot.set(message.provider, message.bootId);
      lastSeenBoot.set(message.provider, message.bootId);
      lastConsumed.delete(message.provider);
      recoverProvider(message.provider);
      if (rotated) notifyProviderBootRotation(message.provider);
    }
  }
  publish(message);
  if (!message.provider) return;
  const payload = message.payload as { bulkReady?: number; doneReady?: boolean } | undefined;
  if (typeof payload?.bulkReady === 'number' && payload.bulkReady > 0) {
    void pullProvider(message.provider);
    if (payload.doneReady === true) armDoneWatchdog(message.provider);
  }
}

export function recoverProvider(provider: AIProvider): void {
  clearDoneWatchdog(provider);
  clearPullRecovery(provider);
  if (!degraded.delete(provider)) return;
  publish({
    v: 1,
    action: 'STATUS_REPORT',
    provider,
    payload: { bridge: 'ok' },
    transport: 'local',
  });
  if (pending.has(provider)) ensurePoll(provider);
}

export function resetProviderPullState(provider: AIProvider): void {
  // Preserve activeBoot/lastConsumed so retry cannot re-deliver already consumed outbox entries.
  recoverProvider(provider);
}

export function resetProviderBootState(provider: AIProvider): void {
  activeBoot.delete(provider);
  lastConsumed.delete(provider);
  recoverProvider(provider);
}

export function setProviderAwaiting(provider: AIProvider, awaiting: boolean): void {
  awaitingEpoch.set(provider, (awaitingEpoch.get(provider) ?? 0) + 1);
  if (awaiting) {
    pending.add(provider);
    ensurePoll(provider);
    if (degraded.has(provider)) schedulePullRecovery(provider);
    return;
  }
  pending.delete(provider);
  clearPullRecovery(provider);
  const timer = pollTimers.get(provider);
  if (timer !== undefined) globalThis.clearInterval(timer);
  pollTimers.delete(provider);
  clearDoneWatchdog(provider);
}

function ensurePoll(provider: AIProvider): void {
  if (pollTimers.has(provider) || degraded.has(provider)) return;
  const timer = globalThis.setInterval(() => {
    if (pending.has(provider)) void pullProvider(provider);
  }, POLL_PULL_MS);
  pollTimers.set(provider, timer);
}

function armDoneWatchdog(provider: AIProvider): void {
  if (!pending.has(provider)) return;
  clearDoneWatchdog(provider);
  const timer = globalThis.setTimeout(() => {
    doneTimers.delete(provider);
    void (async () => {
      await pullProvider(provider, { force: true });
      if (pending.has(provider)) await synthesizeDone(provider, '[Error: bridge degraded]');
    })();
  }, DONE_WATCHDOG_MS);
  doneTimers.set(provider, timer);
}

function clearDoneWatchdog(provider: AIProvider): void {
  const doneTimer = doneTimers.get(provider);
  if (doneTimer !== undefined) globalThis.clearTimeout(doneTimer);
  doneTimers.delete(provider);
}

export async function pullProvider(provider: AIProvider, options: { force?: boolean } = {}): Promise<void> {
  if (degraded.has(provider) && !options.force) return;
  const existing = pullInflight.get(provider);
  if (existing) {
    if (!options.force || existing.force) return existing.promise;
    await existing.promise;
    if (!pending.has(provider)) return;
  }
  const started = pullProviderInner(provider, options).finally(() => {
    if (pullInflight.get(provider)?.promise === started) pullInflight.delete(provider);
  });
  pullInflight.set(provider, { promise: started, force: options.force === true });
  return started;
}

async function pullProviderInner(provider: AIProvider, options: { force?: boolean }): Promise<void> {
  if (degraded.has(provider) && !options.force) return;
  const batch = await pullWithRetry(provider);
  if (!batch) {
    markDegraded(provider, 'pull_failed');
    publish({
      v: 1,
      action: 'STATUS_REPORT',
      provider,
      payload: {
        pullDiagnostic: 'failed',
        pullFailureKind: lastPullFailure.get(provider) ?? 'eval_failed',
        recoveryAttempt: recoveryAttempts.get(provider) ?? 0,
      },
      transport: 'local',
    });
    return;
  }
  if (degraded.has(provider)) {
    publish({
      v: 1,
      action: 'STATUS_REPORT',
      provider,
      payload: { pullDiagnostic: 'recovered', recoveryAttempt: recoveryAttempts.get(provider) ?? 0 },
      transport: 'local',
    });
  }
  lastPullFailure.delete(provider);
  // A successful callback is direct evidence the old provider document is
  // responsive again. Keep boot/mid watermarks intact; never forge DONE.
  if (degraded.has(provider)) recoverProvider(provider);
  let maxMid = 0;
  let sawDone = false;
  const providerBoot = activeBoot.get(provider);
  for (const message of batch) {
    if (!message.bootId || typeof message.mid !== 'number' || !Number.isFinite(message.mid)) continue;
    if (providerBoot && message.bootId !== providerBoot) continue;
    maxMid = Math.max(maxMid, message.mid);
    const previous = lastConsumed.get(provider);
    if (!previous || previous.bootId !== message.bootId) {
      lastConsumed.set(provider, { bootId: message.bootId, mid: 0 });
    }
    const current = lastConsumed.get(provider);
    if (current && message.mid <= current.mid) continue;
    lastConsumed.set(provider, { bootId: message.bootId, mid: message.mid });
    if (message.action === 'RESPONSE_DONE') sawDone = true;
    publish({ ...message, provider, transport: 'pull' });
  }
  if (maxMid > 0) {
    await host.provider.eval(provider, `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.ackBulk(${maxMid});`);
  }
  if (sawDone) setProviderAwaiting(provider, false);
}

function markDegraded(provider: AIProvider, reason: string): void {
  const wasDegraded = degraded.has(provider);
  degraded.add(provider);
  clearDoneWatchdog(provider);
  const timer = pollTimers.get(provider);
  if (timer !== undefined) globalThis.clearInterval(timer);
  pollTimers.delete(provider);
  // Emit the degradation transition once, rather than on every failed probe.
  if (!wasDegraded) {
    publish({
      v: 1,
      action: 'STATUS_REPORT',
      provider,
      payload: { bridge: 'degraded', reason },
      transport: 'local',
    });
  }
  schedulePullRecovery(provider);
}

// An eval callback may fail transiently during WKWebView navigation or a
// busy script. Re-probe only while the workflow is waiting, with a bounded
// retry budget. A successful probe drains the existing outbox; a genuine
// new-document bootId remains a hard workflow failure.
function schedulePullRecovery(provider: AIProvider): void {
  if (!pending.has(provider) || recoveryTimers.has(provider)) return;
  const attempts = recoveryAttempts.get(provider) ?? 0;
  if (attempts >= PULL_RECOVERY_MAX_ATTEMPTS) return;
  const timer = globalThis.setTimeout(() => {
    recoveryTimers.delete(provider);
    if (!pending.has(provider) || !degraded.has(provider)) return;
    recoveryAttempts.set(provider, attempts + 1);
    publish({
      v: 1,
      action: 'STATUS_REPORT',
      provider,
      payload: { pullDiagnostic: 'retrying', recoveryAttempt: attempts + 1 },
      transport: 'local',
    });
    void pullProvider(provider, { force: true });
  }, PULL_RECOVERY_DELAY_MS * (attempts + 1));
  recoveryTimers.set(provider, timer);
}

function clearPullRecovery(provider: AIProvider): void {
  const timer = recoveryTimers.get(provider);
  if (timer !== undefined) globalThis.clearTimeout(timer);
  recoveryTimers.delete(provider);
  recoveryAttempts.delete(provider);
}

function synthesizeDone(provider: AIProvider, payload: string): Promise<void> {
  const existing = synthesizeInflight.get(provider);
  if (existing) return existing.promise;
  const epoch = awaitingEpoch.get(provider);
  const token = Symbol(provider);
  const operation = Promise.resolve()
    .then(() => host.provider.stop(provider))
    .catch(() => undefined)
    .then(() => {
      if (synthesizeInflight.get(provider)?.token !== token || awaitingEpoch.get(provider) !== epoch) return;
      setProviderAwaiting(provider, false);
      publish({
        v: 1,
        action: 'RESPONSE_DONE',
        provider,
        payload,
        transport: 'local',
      });
    })
    .finally(() => {
      if (synthesizeInflight.get(provider)?.token === token) synthesizeInflight.delete(provider);
    });
  synthesizeInflight.set(provider, { token, promise: operation });
  return operation;
}

function notifyProviderBootRotation(provider: AIProvider): void {
  for (const listener of [...bootRotationListeners]) listener(provider);
}

function publish(message: BridgeMessage): void {
  publishBridgeMessage(message);
}

export async function pullWithRetry(provider: AIProvider): Promise<BridgeMessage[] | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await host.provider.evalWithCallback(
        provider,
        'window.__MAC_BRIDGE__ ? window.__MAC_BRIDGE__.peekOutbox() : []',
      );
      let parsed: unknown;
      try {
        parsed = parsePullResult(raw);
      } catch {
        lastPullFailure.set(provider, 'invalid_json');
        if (attempt === 0) await sleep(1000);
        continue;
      }
      if (!Array.isArray(parsed)) {
        lastPullFailure.set(provider, 'invalid_batch');
        if (attempt === 0) await sleep(1000);
        continue;
      }
      lastPullFailure.delete(provider);
      return parsed as BridgeMessage[];
    } catch (error) {
      lastPullFailure.set(provider, classifyPullFailure(error));
      if (attempt === 0) await sleep(1000);
    }
  }
  return null;
}

// Do not include raw WKWebView callback exceptions in diagnostics: they can
// contain browser or site content. Only recognized, fixed error categories.
function classifyPullFailure(error: unknown): PullFailureKind {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (/timed out|timeout/i.test(message)) return 'callback_timeout';
  if (/channel closed|cancelled|canceled/i.test(message)) return 'callback_closed';
  if (/webview not found|provider webview|window not found/i.test(message)) return 'webview_unavailable';
  return 'eval_failed';
}

export function parsePullResult(raw: string): unknown {
  const parsed = JSON.parse(raw) as unknown;
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export function resetBridgePullForTests(): void {
  lastConsumed.clear();
  pending.clear();
  degraded.clear();
  for (const timer of recoveryTimers.values()) globalThis.clearTimeout(timer);
  recoveryTimers.clear();
  recoveryAttempts.clear();
  lastPullFailure.clear();
  activeBoot.clear();
  lastSeenBoot.clear();
  awaitingEpoch.clear();
  pullInflight.clear();
  synthesizeInflight.clear();
  for (const timer of pollTimers.values()) globalThis.clearInterval(timer);
  pollTimers.clear();
  for (const timer of doneTimers.values()) globalThis.clearTimeout(timer);
  doneTimers.clear();
}
