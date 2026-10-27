import { POLL_PULL_MS } from '../../shared/constants';
import type { AIProvider, BridgeMessage } from '../../shared/types';
import { host } from '../host';
import { publishBridgeMessage } from './bus';

export const DONE_WATCHDOG_MS = 5000;
export const PULL_RECOVERY_DELAY_MS = 5_000;
export const PULL_RECOVERY_MAX_ATTEMPTS = 3;
export const SILENT_PULL_PROBE_INTERVAL_MS = 15_000;
// Exact read-only diagnostic expression also whitelisted by the native host.
// It examines our injected objects only, never the site's DOM or user text.
export const CHATGPT_BRIDGE_HEALTH_JS = '(function(){var b=window.__MAC_BRIDGE__;var e=window.__MAC_ENGINE__;var d=b&&b.diagnostics;var n=function(v){return Number.isSafeInteger(v)&&v>=0?v:null};var p=function(v){return typeof v==="string"&&/^(?:waiting-user-anchor|assistant-selector-missing|candidate-rejected|completion-turn-missing|completion-marker-missing|completion-marker-present|diagnostics-error)$/.test(v)?v:null};return {bridgePresent:!!b,enginePresent:!!e,bootMatches:!!b&&!!e&&b.bootId===e.bootId,adapterInstalled:!!e&&typeof e.adapterVersion==="number"&&e.adapterVersion>0,statusTicks:!!e?n(e.statusTicks):null,responsePollTicks:!!e?n(e.responsePollTicks):null,engineAwaiting:!!e&&e.waitingForResponse===true,statusEmits:!!e?n(e.statusEmits):null,fillStarts:!!e?n(e.fillStarts):null,fillDones:!!e?n(e.fillDones):null,titleQueued:!!d?n(d.queued):null,titleStarted:!!d?n(d.started):null,titleFinished:!!d?n(d.finished):null,capturePhase:!!e?p(e.capturePhase):null,captureResponseNodes:!!e?n(e.captureResponseNodes):null,captureAssistantUnits:!!e?n(e.captureAssistantUnits):null,captureLatestUnitDomChars:!!e?n(e.captureLatestUnitDomChars):null,captureTextChars:!!e?n(e.captureTextChars):null,captureAnchor:!!e&&e.captureAnchor===true,captureGenerationSeen:!!e&&e.captureGenerationSeen===true};})()';
export const AWAITING_MAX_MS = 10 * 60 * 1000;
export const AWAITING_ABSOLUTE_MAX_MS = 60 * 60 * 1000;

const lastConsumed = new Map<string, { bootId: string; mid: number }>();
const pending = new Set<AIProvider>();
const degraded = new Set<AIProvider>();
const recoveryTimers = new Map<AIProvider, ReturnType<typeof globalThis.setTimeout>>();
const recoveryAttempts = new Map<AIProvider, number>();
type PullFailureKind = 'callback_timeout' | 'callback_closed' | 'webview_unavailable' | 'host_not_ready' | 'document_blocked' | 'invalid_json' | 'invalid_batch' | 'eval_failed';
const lastPullFailure = new Map<AIProvider, PullFailureKind>();
// Successful empty callbacks otherwise leave no diagnostic footprint, making
// silent title reporting indistinguishable from a stalled response pull loop.
const lastTitleStatusAt = new Map<AIProvider, number>();
const lastEmptyPullProbeAt = new Map<AIProvider, number>();
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
  if (message.transport === 'title' && message.action === 'STATUS_REPORT' && message.provider) {
    lastTitleStatusAt.set(message.provider, Date.now());
  }
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
  lastEmptyPullProbeAt.delete(provider);
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
  maybeReportSilentEmptyPull(provider, batch);
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

// This measures the *native eval callback*, not whether the injected engine
// exists: its read expression also returns [] when __MAC_BRIDGE__ is absent.
// Distinguish a reachable WebView with an empty outbox from an unreachable
// callback without claiming that response extraction is working.
function maybeReportSilentEmptyPull(provider: AIProvider, batch: BridgeMessage[]): void {
  if (provider !== 'chatgpt' || !pending.has(provider) || batch.length !== 0) return;
  const titleAt = lastTitleStatusAt.get(provider);
  if (titleAt === undefined) return;
  const now = Date.now();
  const silentMs = now - titleAt;
  if (silentMs < SILENT_PULL_PROBE_INTERVAL_MS ||
      now - (lastEmptyPullProbeAt.get(provider) ?? titleAt) < SILENT_PULL_PROBE_INTERVAL_MS) return;
  lastEmptyPullProbeAt.set(provider, now);
  void probeChatGptBridge(provider, Math.floor(silentMs / 1_000) * 1_000);
  publish({
    v: 1,
    action: 'STATUS_REPORT',
    provider,
    transport: 'local',
    payload: {
      pullDiagnostic: 'eval-ok-empty',
      statusSilentMs: Math.floor(silentMs / 1_000) * 1_000,
    },
  });
}


interface ChatGptBridgeHealth {
  bridgePresent: boolean;
  enginePresent: boolean;
  bootMatches: boolean;
  adapterInstalled: boolean;
  statusTicks: number | null;
  responsePollTicks: number | null;
  engineAwaiting: boolean;
  statusEmits: number | null;
  fillStarts: number | null;
  fillDones: number | null;
  titleQueued: number | null;
  titleStarted: number | null;
  titleFinished: number | null;
  capturePhase: string | null;
  captureResponseNodes: number | null;
  captureAssistantUnits: number | null;
  captureLatestUnitDomChars: number | null;
  captureTextChars: number | null;
  captureAnchor: boolean;
  captureGenerationSeen: boolean;
}

function isChatGptBridgeHealth(value: unknown): value is ChatGptBridgeHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const health = value as Record<string, unknown>;
  const validTick = (v: unknown) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
  return typeof health.bridgePresent === 'boolean' &&
    typeof health.enginePresent === 'boolean' &&
    typeof health.bootMatches === 'boolean' &&
    typeof health.adapterInstalled === 'boolean' &&
    validTick(health.statusTicks) &&
    validTick(health.responsePollTicks) &&
    typeof health.engineAwaiting === 'boolean' &&
    validTick(health.statusEmits) &&
    validTick(health.fillStarts) &&
    validTick(health.fillDones) &&
    validTick(health.titleQueued) &&
    validTick(health.titleStarted) &&
    validTick(health.titleFinished) &&
    (health.capturePhase === null ||
      (typeof health.capturePhase === 'string' && [
        'waiting-user-anchor', 'assistant-selector-missing', 'candidate-rejected',
        'completion-turn-missing', 'completion-marker-missing',
        'completion-marker-present', 'diagnostics-error',
      ].includes(health.capturePhase))) &&
    validTick(health.captureResponseNodes) &&
    validTick(health.captureAssistantUnits) &&
    validTick(health.captureLatestUnitDomChars) &&
    validTick(health.captureTextChars) &&
    typeof health.captureAnchor === 'boolean' &&
    typeof health.captureGenerationSeen === 'boolean';
}

async function probeChatGptBridge(provider: AIProvider, statusSilentMs: number): Promise<void> {
  try {
    const raw = await host.provider.evalWithCallback(provider, CHATGPT_BRIDGE_HEALTH_JS);
    const health = parsePullResult(raw);
    if (!pending.has(provider)) return;
    if (!isChatGptBridgeHealth(health)) {
      publish({ v: 1, action: 'STATUS_REPORT', provider, transport: 'local',
        payload: { pullDiagnostic: 'bridge-probe-invalid', statusSilentMs },
      });
      return;
    }
    publish({ v: 1, action: 'STATUS_REPORT', provider, transport: 'local',
      payload: { pullDiagnostic: 'bridge-probe', statusSilentMs,
        bridgePresent: health.bridgePresent,
        enginePresent: health.enginePresent,
        bootMatches: health.bootMatches,
        adapterInstalled: health.adapterInstalled,
        statusTicks: health.statusTicks,
        responsePollTicks: health.responsePollTicks,
        engineAwaiting: health.engineAwaiting,
        statusEmits: health.statusEmits,
        fillStarts: health.fillStarts,
        fillDones: health.fillDones,
        titleQueued: health.titleQueued,
        titleStarted: health.titleStarted,
        titleFinished: health.titleFinished,
        capturePhase: health.capturePhase,
        captureResponseNodes: health.captureResponseNodes,
        captureAssistantUnits: health.captureAssistantUnits,
        captureLatestUnitDomChars: health.captureLatestUnitDomChars,
        captureTextChars: health.captureTextChars,
        captureAnchor: health.captureAnchor,
        captureGenerationSeen: health.captureGenerationSeen,
      },
    });
  } catch (error) {
    if (!pending.has(provider)) return;
    publish({ v: 1, action: 'STATUS_REPORT', provider, transport: 'local',
      payload: { pullDiagnostic: 'bridge-probe-failed', statusSilentMs,
        pullFailureKind: classifyPullFailure(error) },
    });
  }
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
  if (/script evaluation is not ready for provider/i.test(message)) return 'host_not_ready';
  if (/script evaluation is not allowed for the current/i.test(message)) return 'document_blocked';
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
  lastTitleStatusAt.clear();
  lastEmptyPullProbeAt.clear();
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
