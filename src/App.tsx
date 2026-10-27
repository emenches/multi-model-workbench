import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_PROVIDERS, CHAT_MODES, DEFAULT_FREE_TARGET_PROVIDERS } from '../shared/constants';
import type { AIProvider, BridgeMessage, ChatMode, ModeRoles, ProviderState, WorkflowPresetId } from '../shared/types';
import { startBridgePull, resetProviderBootState } from './bridge/pull';
import { isRenderableResponseMessage } from './bridge/render';
import { publishBridgeMessage } from './bridge/bus';
import { EchoPanel } from './dev/EchoPanel';
import { getRuntimeAppVersion } from './appVersion';
import { host, type ProviderWindowGeometry } from './host';
import { ProjectPicker } from './workspace/ProjectPicker';
import { ProviderModelControls } from './ui/ProviderModelControls';
import { MIN_CONSULT_PROVIDERS, availableConsultProviders, chooseConsultRoles } from './ui/consultAvailability';
import { EMPTY_PROJECT_STORE, activeProject, mergeProjectContext, type ProjectStore } from './workspace/model';
import { useI18n } from './i18n/context';
import { MODE_NAME_KEYS } from './i18n/modes';
import type { Locale } from './i18n/resolve';
import { formatI18n, t as translateKey } from './i18n/t';
import { mergePullBridgeState, type PullBridgeState } from './appBridgeState';
import { onCheckpoint, type PendingCheckpoint } from './workflow/checkpoint';
import { isSendable, onStepTimeoutEvent, runWorkflow } from './workflow';
import { createResponseLanguagePolicy } from './workflow/responseLanguage';
import type { PreflightResult } from './workflow/preflight';
import { bubbleAuthorLabel } from './bubbleAuthorLabel';
import {
  manualFocusLockForControl,
  pointerDebounceLock,
  providerFromRoleAssignment,
  refreshManualLockOnRoleAssignment,
  shouldAutoFocus,
  type ManualFocusLock,
  type ManualFocusPointerDown,
} from './ui/autoFocus';
import { CheckpointCard } from './ui/CheckpointCard';
import { AiSisterAvatar } from './ui/AiSisterTheme';
import { ConversationSidebar } from './ui/ConversationSidebar';
import {
  beginNewConversationSession,
  createConversationSession,
  loadConversationSessions,
  removeConversationSession,
  saveConversationSessionsWithQuotaRecovery,
  sessionContentChanged,
  titleFromFirstUserMessage,
  upsertConversationSession,
  type ConversationSession,
  type ConversationSessionMessage,
} from './ui/conversationSessions';
import {
  buildConversationReplayContext,
  createActiveProviderResponse,
  createConversationMessageId,
  ensureFreshProviderSessions,
  pendingProviderSessionResets,
  ProviderSessionResetError,
  type ActiveProviderResponse,
} from './ui/conversationContinuity';
import { FocusPane, type CenterSurface } from './ui/FocusPane';
import { InputBar } from './ui/InputBar';
import { MarkdownText } from './ui/MarkdownText';
import { ThinkingVisualization } from './ui/ThinkingVisualization';
import { makeFileDragGuard } from './ui/fileDrop';
import { PreflightDialog } from './ui/PreflightDialog';
import { PresetCatalog } from './ui/PresetCatalog';
import { PRESET_CATALOG } from './ui/presetCatalogData';
import { ModalDialog } from './ui/ModalDialog';
import { createProcessTrace, reduceProcessTraceEvent, settleProcessTrace, type ProcessTraceState } from './ui/processTraceModel';
import { ProcessTrace } from './ui/ProcessTrace';
import { ReplayPanel, type ReplaySource } from './ui/ReplayPanel';
import { SessionCheckpointNotice } from './ui/SessionCheckpointNotice';
import { loadSessionSidebarCollapsed, saveSessionSidebarCollapsed } from './ui/sessionSidebarPreference';
import { StepTimeoutDialog, type StepTimeoutDialogState } from './ui/StepTimeoutDialog';
import { TargetChips } from './ui/TargetChips';
import { findScrollActiveProvider, isTranscriptNearEnd, scrollTranscriptToEnd, scrollTranscriptToProviderMessage } from './ui/transcriptScroll';
import {
  DEFAULT_FOCUS_LAYOUT_CONSTRAINTS,
  clampFocusPaneWidth,
  dragFocusPaneWidth,
  driveCenteredProviderToStage as driveCenteredProviderToStageCommand,
  focusGridTemplateColumns,
  nonEmptyRect,
  throttleWithFrame,
} from './ui/focusLayout';
import { isSerialMode } from './ui/modeRoles';
import {
  centerHiddenProviders,
  centerPresentationProvider,
  defaultPresentation,
  restorableOpenProviders,
  setProviderPresentation,
  type PresentationByProvider,
  type WebviewPresentationState,
} from './ui/presentation';
import {
  applyCenterHiddenCommands,
  applyCenterStageCommand,
  applyPresentationTransitionCommand,
  type PresentationCommandHost,
  waitForPresentationTargetBounds,
} from './ui/presentationCommands';
import { preflightGraph, workflowGraphs } from './workflow/graph';
import { defaultRolesForPreset, presetForId } from './ui/presetCatalogData';
import { buildPreflightDialogModel } from './ui/preflightModel';
import { preflightFromResult, type PreflightSubject } from './ui/preflightFromResult';
import { processingAfterSend, processingAfterSettle, processingAfterWorkflowStatus } from './ui/processing';
import { Resizer } from './ui/Resizer';
import { SettingsModal } from './ui/SettingsModal';
import {
  activeProvidersForStandby,
  defaultSettings,
  mergeSettings,
  normalizeSettings,
  type AppSettings,
} from './ui/settingsModel';
import {
  clearStartupSessionCheckpointNotice,
  loadStartupSessionCheckpointNotice,
  type StartupSessionCheckpointNotice,
} from './ui/sessionCheckpointStartup';
import { nextStepTimeoutState } from './ui/stepTimeoutState';
import {
  defaultTargets,
  freeModeTargets,
  simpleChatTargets,
  hasEffectiveFreeModeTargets,
  markFreeTargetsTouched,
  waitForProvidersSendable,
  type FreeTargetSelection,
} from './ui/targets';
import { useOverlayGuard } from './ui/useOverlayGuard';
import { buildMarkdown, exportFilename, matchingSnapshotForConversation } from './ui/exportMarkdown';
import { formatReportBody, type AdapterNotice, type ReportDigest } from './ui/reportBroken';
import { persistSnapshotIfEnabled } from './workflow/snapshot/persistence';
import { getLastSnapshot } from './workflow/snapshot/recorder';
import type { ReplayPlan } from './workflow/snapshot/replay';
import type { ExecutionSnapshot } from './workflow/snapshot/types';
import {
  eventFromAdapterNotice,
  eventFromBridgeMessage,
  eventFromNavBlocked,
  eventFromProviderState,
  eventFromStepTimeout,
  eventFromWorkflowPreflightBlocked,
  eventFromWorkflowSettled,
  eventFromWorkflowStart,
} from './diagnostics/eventLog';
import { recordEventLog } from './diagnostics/eventLogStore';
import { ReportPreviewDialog } from './ui/ReportPreviewDialog';

interface Bubble {
  id: string;
  provider?: AIProvider | 'system' | (string & {});
  authorLabel?: string;
  role: 'user' | 'ai';
  content: string;
  final?: boolean;
  truncated?: boolean;
  modeRole?: string;
}

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];

function initialConversationState(): { sessions: ConversationSession[]; active: ConversationSession } {
  const loaded = loadConversationSessions();
  const active = loaded[0] ?? createConversationSession();
  return { sessions: upsertConversationSession(loaded, active), active };
}

function conversationMessages(messages: readonly Bubble[]): ConversationSessionMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.authorLabel ? { authorLabel: message.authorLabel } : {}),
    ...(message.modeRole ? { modeRole: message.modeRole } : {}),
    ...(typeof message.final === 'boolean' ? { final: message.final } : {}),
    ...(typeof message.truncated === 'boolean' ? { truncated: message.truncated } : {}),
  }));
}

function persistConversationSessions(sessions: readonly ConversationSession[]): ConversationSession[] {
  const result = saveConversationSessionsWithQuotaRecovery(sessions);
  if (!result.saved) {
    recordEventLog({
      kind: 'workflow-error',
      summary: 'Conversation history save failed; recent messages may be lost on restart',
      detail: { sessions: sessions.length, reason: result.reason ?? 'unknown' },
    });
    return [...sessions];
  }
  if (result.evictedSessionIds.length > 0) {
    recordEventLog({
      kind: 'workflow-error',
      summary: 'Oldest conversation history was removed to stay within local storage quota',
      detail: { evictedSessionIds: result.evictedSessionIds.join(',') },
    });
  }
  return result.sessions;
}

function bubblesFromSession(session: ConversationSession): Bubble[] {
  return session.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.authorLabel ? { authorLabel: message.authorLabel } : {}),
    ...(message.modeRole ? { modeRole: message.modeRole } : {}),
    ...(typeof message.final === 'boolean' ? { final: message.final } : {}),
    ...(typeof message.truncated === 'boolean' ? { truncated: message.truncated } : {}),
  }));
}

const presentationHost: PresentationCommandHost = {
  close: host.provider.close,
  hide: (provider) => host.provider.park(provider, hiddenProviderLoadBounds()),
  open: host.provider.open,
  setBounds: host.layout.setBounds,
  show: host.provider.show,
};

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function providerSetEquals(left: ReadonlySet<AIProvider>, right: ReadonlySet<AIProvider>): boolean {
  if (left.size !== right.size) return false;
  for (const provider of left) {
    if (!right.has(provider)) return false;
  }
  return true;
}

function hiddenProviderLoadBounds(): DOMRectReadOnly {
  return {
    x: -10_000,
    y: -10_000,
    width: 420,
    height: 320,
    top: -10_000,
    left: -10_000,
    right: -9_580,
    bottom: -9_680,
    toJSON: () => ({}),
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function presentationHiddenProvidersForCenterSurface({
  centerSurface,
  presentation,
  states,
  userHidden,
  providers,
  centerTransitionsInFlight = new Set(),
}: {
  centerSurface: CenterSurface;
  presentation: PresentationByProvider;
  states: Record<AIProvider, ProviderState>;
  userHidden: ReadonlySet<AIProvider>;
  providers: readonly AIProvider[];
  centerTransitionsInFlight?: ReadonlySet<AIProvider>;
}): Set<AIProvider> {
  if (centerSurface === 'native') {
    return new Set(centerHiddenProviders(presentation, states, userHidden, providers, centerTransitionsInFlight));
  }

  const centered = centerPresentationProvider(presentation);
  if (!centered) return new Set();
  if (states[centered]?.webview !== 'loaded' && !centerTransitionsInFlight.has(centered)) return new Set();
  return new Set([centered]);
}

function renderablePayload(payload: unknown): { content: string; truncated: boolean } {
  if (typeof payload === 'string') return { content: payload, truncated: false };
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const typed = payload as { text?: unknown; truncated?: unknown };
    return {
      content: typeof typed.text === 'string' ? typed.text : '',
      truncated: typed.truncated === true,
    };
  }
  return { content: JSON.stringify(payload ?? ''), truncated: false };
}

function isGeneratedImageResponse(content: string): boolean {
  return /^\[Image generated(?::[^\]]+)?\]$/.test(content.trim());
}

export default function App() {
  const { locale, t: translate, setLanguage } = useI18n();
  useEffect(() => {
    void Promise.resolve()
      .then(() => host.dev.log('[MAC_AGENT] READY control-pane'))
      .catch(() => undefined);
  }, []);
  const initialConversation = useMemo(initialConversationState, []);
  const [states, setStates] = useState<Record<AIProvider, ProviderState>>(() =>
    Object.fromEntries(
      PROVIDERS.map((provider) => [
        provider,
        { provider, webview: 'none', dom: 'unknown', login: 'unknown', thinking: false, lastStatusAt: 0 },
      ]),
    ) as Record<AIProvider, ProviderState>,
  );
  const [sessions, setSessions] = useState<ConversationSession[]>(initialConversation.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialConversation.active.id);
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(loadSessionSidebarCollapsed);
  const [messages, setMessages] = useState<Bubble[]>(() => bubblesFromSession(initialConversation.active));
  const [workflowStatus, setWorkflowStatus] = useState('');
  const [mode, setMode] = useState<ChatMode>(initialConversation.active.mode);
  const [presetId, setPresetId] = useState<WorkflowPresetId>(initialConversation.active.presetId ?? initialConversation.active.mode);
  const [replayDrawerOpen, setReplayDrawerOpen] = useState(false);
  const [processTrace, setProcessTrace] = useState<ProcessTraceState | undefined>();
  const [processTraceDetailOpen, setProcessTraceDetailOpen] = useState(false);
  // Keep the reading area usable while retaining a full, opt-in timeline.
  // Full timeline now lives in the optional right-side Activity panel.
  const [targetSelection, setTargetSelection] = useState<FreeTargetSelection>(() => ({
    targets: [...DEFAULT_FREE_TARGET_PROVIDERS],
    defaultsInitialized: true,
    userTouched: false,
  }));
  const [checkpoint, setCheckpoint] = useState<PendingCheckpoint | undefined>();
  const [checkpointDraft, setCheckpointDraft] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [preflightLoginPending, setPreflightLoginPending] = useState(false);
  const [preflight, setPreflight] = useState<{ mode: PreflightSubject; result: PreflightResult } | undefined>();
  const [stepTimeout, setStepTimeout] = useState<StepTimeoutDialogState | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Developer transport testing is opt-in, never part of the default chat.
  const [showDevDiagnostics, setShowDevDiagnostics] = useState(
    import.meta.env.DEV && import.meta.env.VITE_M1_AUTOTEST === '1',
  );
  // The M1 project store is separate from global conversations and provider browser profiles.
  const [projectStore, setProjectStore] = useState<ProjectStore>(EMPTY_PROJECT_STORE);
  const [projectLoadError, setProjectLoadError] = useState<string>();
  const [projectsReady, setProjectsReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void host.projects.load().then((store) => {
      if (mounted) setProjectStore(store);
    }).catch((reason: unknown) => {
      if (mounted) setProjectLoadError(`Cannot read saved projects: ${reason instanceof Error ? reason.message : String(reason)}`);
    }).finally(() => {
      if (mounted) setProjectsReady(true);
    });
    return () => { mounted = false; };
  }, []);
  const activeConversationProjectId = sessions.find((session) => session.id === activeSessionId)?.projectId;
  // Conversation association is authoritative: switching between chats also
  // switches the project instructions applied to the next workflow.
  const effectiveProjectStore = useMemo<ProjectStore>(() => ({
    ...projectStore,
    activeProjectId: projectStore.projects.some((project) => project.id === activeConversationProjectId)
      ? activeConversationProjectId ?? null
      : null,
  }), [projectStore, activeConversationProjectId]);

  const saveProjectStore = useCallback(async (store: ProjectStore): Promise<void> => {
    await host.projects.save(store);
    setProjectStore(store);
    const currentSession = sessions.find((session) => session.id === activeSessionId);
    if (currentSession && (currentSession.projectId ?? null) !== store.activeProjectId) {
      setSessions((current) => {
        const original = current.find((session) => session.id === activeSessionId);
        if (!original) return current;
        const next = { ...original, updatedAt: Date.now() };
        if (store.activeProjectId) next.projectId = store.activeProjectId;
        else delete next.projectId;
        return persistConversationSessions(upsertConversationSession(current, next));
      });
    }
  }, [activeSessionId, sessions]);
  const [shareNotice, setShareNotice] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>();
  const [sessionCheckpointNotice, setSessionCheckpointNotice] = useState<StartupSessionCheckpointNotice | undefined>();
  const [sessionCheckpointReplayBusy, setSessionCheckpointReplayBusy] = useState(false);
  const [reportPreview, setReportPreview] = useState<{ provider: AIProvider; digest: ReportDigest; body: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [adapterNotice, setAdapterNotice] = useState<AdapterNotice | null>(null);
  const [sharing, setSharing] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => defaultSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [initialRestoreComplete, setInitialRestoreComplete] = useState(false);
  const [connectionSnapshotLoaded, setConnectionSnapshotLoaded] = useState(false);
  const [focusPaneWidth, setFocusPaneWidth] = useState(() => defaultSettings().focusPaneWidth);
  const [stageExpanded, setStageExpanded] = useState(false);
  const [messagesMaximized, setMessagesMaximized] = useState(false);
  const [workflowOptionsOpen, setWorkflowOptionsOpen] = useState(false);
  const [providerInspectorOpen, setProviderInspectorOpen] = useState(false);
  const [activityPanelOpen, setActivityPanelOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [modelSettingsProvider, setModelSettingsProvider] = useState<AIProvider>();
  const [providerWindowError, setProviderWindowError] = useState<string>();
  const [providerWindowGeometry, setProviderWindowGeometry] = useState<ProviderWindowGeometry>();
  const [scrollFocusedProvider, setScrollFocusedProvider] = useState<AIProvider | undefined>();
  const [presentation, setPresentation] = useState<PresentationByProvider>(() => defaultPresentation());
  const [centerSurface, setCenterSurface] = useState<CenterSurface>('text');
  const [userHidden, setUserHidden] = useState<Set<AIProvider>>(() => new Set());
  const [centerHidden, setCenterHidden] = useState<Set<AIProvider>>(() => new Set());
  const [centerTransitionsInFlight, setCenterTransitionsInFlight] = useState<Set<AIProvider>>(() => new Set());
  const paneRefs = useRef<Record<string, HTMLElement | null>>({});
  const centerStageRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const transcriptStickToEndRef = useRef(true);
  const transcriptSessionRef = useRef<string>();
  const transcriptLastMessageIdRef = useRef<string>();
  const statesRef = useRef(states);
  const userHiddenRef = useRef<Set<AIProvider>>(userHidden);
  const settingsRef = useRef<AppSettings>(appSettings);
  const localeRef = useRef(locale);
  const autoFollowEnabledRef = useRef(true);
  const manualFocusLockRef = useRef<ManualFocusLock | undefined>();
  const manualFocusPointerDownRef = useRef<ManualFocusPointerDown | undefined>();
  const manualFocusIdlePausedRef = useRef(false);
  const manualFocusIdlePauseStartedAtRef = useRef<number | undefined>();
  const presentationRef = useRef<PresentationByProvider>(presentation);
  const centerSurfaceRef = useRef<CenterSurface>(centerSurface);
  const forcedNativeCenterProviderRef = useRef<AIProvider | undefined>();
  const changeProviderPresentationRef = useRef<(provider: AIProvider, state: WebviewPresentationState) => Promise<void>>(async () => {});
  const centerHiddenRef = useRef<Set<AIProvider>>(centerHidden);
  const centerTransitionsInFlightRef = useRef<Set<AIProvider>>(centerTransitionsInFlight);
  const centerTransitionGenerations = useRef<Map<AIProvider, number>>(new Map());
  const presentationTransitionGenerations = useRef<Record<AIProvider, number>>(
    Object.fromEntries(PROVIDERS.map((provider) => [provider, 0])) as Record<AIProvider, number>,
  );
  const overlayGuardOpenRef = useRef(false);
  const pendingRestore = useRef<Set<AIProvider>>(new Set());
  const dragStartFocusPaneWidth = useRef(defaultSettings().focusPaneWidth);
  const activeResponses = useRef(new Map<AIProvider, ActiveProviderResponse>());
  const replayContextSessionRef = useRef<string | undefined>(
    initialConversation.active.messages.length > 0 ? initialConversation.active.id : undefined,
  );
  const pendingProviderResetRef = useRef<Set<AIProvider>>(new Set());
  const providerSessionResetAttemptRef = useRef(0);
  const workflowExecutionGenerationRef = useRef(0);
  const workflowExecutionTailRef = useRef<Promise<void>>(Promise.resolve());
  const pullBridge = useRef(new Map<AIProvider, PullBridgeState>());
  const replayPanelRef = useRef<ReplayPanel | null>(null);
  const targets = targetSelection.targets;
  const activeProviders = useMemo(
    () => activeProvidersForStandby(appSettings.standbyProvider),
    [appSettings.standbyProvider],
  );
  const savedSimpleAgent = sessions.find((session) => session.id === activeSessionId)?.singleProvider;
  // If a chat explicitly selected an agent, preserve that choice even if it
  // signs out. Never silently redirect a conversation to another model.
  const simpleAgent = savedSimpleAgent ?? activeProviders.find((provider) => isSendable(states[provider]));
  const simpleTargets = simpleChatTargets(
    simpleAgent && activeProviders.includes(simpleAgent) ? simpleAgent : undefined, states,
  );
  const centeredProvider = useMemo(() => centerPresentationProvider(presentation), [presentation]);
  const presentationHidden = useMemo(() => {
    const next = new Set(centerHidden);
    if (centerSurface === 'text' && centeredProvider) next.add(centeredProvider);
    return next;
  }, [centerHidden, centeredProvider, centerSurface]);
  const modalHiddenProviders = useMemo(() => {
    const next = new Set<AIProvider>([...userHidden, ...presentationHidden]);
    return next;
  }, [presentationHidden, userHidden]);
  const loadedModalProviders = useMemo(() => {
    const centered = centerPresentationProvider(presentation);
    if (centerSurface !== 'native' || !centered) return [];
    if (states[centered].webview !== 'loaded') return [];
    if (modalHiddenProviders.has(centered)) return [];
    return [centered];
  }, [centerSurface, modalHiddenProviders, presentation, states]);
  const hasFreeModeTargets = useMemo(() => hasEffectiveFreeModeTargets(targets, states), [states, targets]);
  const anySendableTargets = useMemo(() => defaultTargets(states, activeProviders), [activeProviders, states]);
  const requiredModeProviders = useMemo(() => {
    // Consult can reuse two distinct, signed-in providers for its later,
    // sequential review and synthesis roles.
    if (mode === 'consult') return availableConsultProviders(states, activeProviders);
    const roles = defaultRolesForPreset(mode, presetId, appSettings.modeRoles);
    return roles
      ? ([...new Set(Object.values(roles))] as AIProvider[])
      : presetForId(presetId).requiredProviders;
  }, [mode, presetId, appSettings.modeRoles, states, activeProviders]);
  const readyModeProviders = useMemo(
    () => requiredModeProviders.filter((provider) => isSendable(states[provider])),
    [requiredModeProviders, states],
  );
  const missingModeProviderCount = mode === 'consult'
    ? Math.max(0, MIN_CONSULT_PROVIDERS - readyModeProviders.length)
    : Math.max(0, requiredModeProviders.length - readyModeProviders.length);
  const noSendableProviders = !settingsLoaded || (presetId === 'simple'
    ? simpleTargets.length !== 1
    : presetId === 'brainstorm'
      ? readyModeProviders.length === 0
    : mode === 'free'
      ? !hasFreeModeTargets
      : anySendableTargets.length === 0);
  const modeSendBlocked = (mode !== 'free' || presetId === 'brainstorm') && missingModeProviderCount > 0;
  const openProviders = useMemo(
    () => activeProviders.filter((provider) => states[provider].webview === 'loaded'),
    [activeProviders, states],
  );
  const latestCenterBubble = useMemo(() => {
    if (!centeredProvider) return undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'ai' && message.provider === centeredProvider) return message;
    }
    return undefined;
  }, [centeredProvider, messages]);
  const centerText = latestCenterBubble?.content;
  const centerTextFinal = latestCenterBubble?.final === true;

  const overlayGuardOpen =
    (Boolean(preflight) && !preflightLoginPending) || Boolean(stepTimeout?.timedOut) || settingsOpen || Boolean(reportPreview) || processTraceDetailOpen || messagesMaximized;
  const manualFocusIdlePaused = Boolean(checkpoint) || Boolean(stepTimeout);
  overlayGuardOpenRef.current = overlayGuardOpen;

  const setCenterSurfaceMode = useCallback((surface: CenterSurface) => {
    centerSurfaceRef.current = surface;
    setCenterSurface(surface);
  }, []);

  useEffect(() => {
    if (centeredProvider && forcedNativeCenterProviderRef.current === centeredProvider) {
      forcedNativeCenterProviderRef.current = undefined;
      setCenterSurfaceMode('native');
      return;
    }
    forcedNativeCenterProviderRef.current = undefined;
    setCenterSurfaceMode('text');
  }, [centeredProvider, setCenterSurfaceMode]);

  useOverlayGuard(overlayGuardOpen, loadedModalProviders, async (provider) => {
    // The old modal cleanup called provider.show() for every loaded child,
    // including side/parked views. Those native children can float over the
    // entire React UI on macOS. Restore only the current native center.
    if (presentationRef.current[provider] !== 'center' ||
        centerSurfaceRef.current !== 'native' ||
        userHiddenRef.current.has(provider) ||
        overlayGuardOpenRef.current) return;
    await nextAnimationFrame();
    const bounds = nonEmptyRect(centerStageRef.current?.getBoundingClientRect());
    if (!bounds) return;
    await host.layout.setBounds(provider, bounds);
    if (presentationRef.current[provider] === 'center' &&
        centerSurfaceRef.current === 'native' &&
        !overlayGuardOpenRef.current &&
        !userHiddenRef.current.has(provider)) {
      await host.provider.show(provider);
    }
  });

  useEffect(() => {
    const guard = makeFileDragGuard();
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  useEffect(() => {
    userHiddenRef.current = userHidden;
  }, [userHidden]);

  useEffect(() => {
    settingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', appSettings.theme !== 'light');
    document.documentElement.classList.toggle('ai-sister', appSettings.theme === 'ai-sister');
  }, [appSettings.theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${appSettings.fontSize}px`;
  }, [appSettings.fontSize]);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    saveSessionSidebarCollapsed(sessionSidebarCollapsed);
  }, [sessionSidebarCollapsed]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSessions((current) => {
        const existing = current.find((session) => session.id === activeSessionId);
        const storedMessages = conversationMessages(messages);
        const storedPresetId = conversationPresetId(presetId, mode);
        if (existing && !sessionContentChanged(existing, storedMessages, mode, storedPresetId)) return current;
        const base = existing ?? createConversationSession({ id: activeSessionId, mode, presetId: storedPresetId });
        const next = upsertConversationSession(current, {
          ...base,
          title: titleFromFirstUserMessage(storedMessages),
          updatedAt: Date.now(),
          mode,
          presetId: storedPresetId,
          messages: storedMessages,
        });
        return persistConversationSessions(next);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, messages, mode, presetId]);

  const setManualFocusLock = useCallback((lock: ManualFocusLock | undefined) => {
    manualFocusLockRef.current = lock;
  }, []);

  const markManualFocusControl = useCallback((provider: AIProvider) => {
    const now = Date.now();
    manualFocusPointerDownRef.current = { provider, at: now };
    const lock = manualFocusLockForControl(provider, presentationRef.current[provider], now);
    if (lock) setManualFocusLock(lock);
  }, [setManualFocusLock]);

  useEffect(() => {
    presentationRef.current = presentation;
  }, [presentation]);

  useEffect(() => {
    centerHiddenRef.current = centerHidden;
  }, [centerHidden]);

  useEffect(() => {
    centerTransitionsInFlightRef.current = centerTransitionsInFlight;
  }, [centerTransitionsInFlight]);

  useEffect(() => {
    return onCheckpoint((pending) => {
      setCheckpoint(pending);
      setCheckpointDraft(pending?.draft ?? '');
    });
  }, []);

  useEffect(() => {
    manualFocusIdlePausedRef.current = manualFocusIdlePaused;
    if (manualFocusIdlePaused) {
      manualFocusIdlePauseStartedAtRef.current ??= Date.now();
      return;
    }

    if (manualFocusIdlePauseStartedAtRef.current !== undefined) {
      manualFocusIdlePauseStartedAtRef.current = undefined;
      if (manualFocusLockRef.current) setManualFocusLock({ ...manualFocusLockRef.current, at: Date.now() });
    }
  }, [manualFocusIdlePaused, setManualFocusLock]);

  useEffect(() => {
    if (!shareNotice) return;
    const t = window.setTimeout(() => setShareNotice(undefined), 5000);
    return () => window.clearTimeout(t);
  }, [shareNotice]);

  useEffect(() => {
    if (!adapterNotice) return;
    const t = window.setTimeout(() => setAdapterNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [adapterNotice]);

  useEffect(() => {
    let disposed = false;
    void loadStartupSessionCheckpointNotice()
      .then((notice) => {
        if (!disposed) setSessionCheckpointNotice(notice);
      })
      .catch(() => {
        // Startup interruption detection is best-effort.
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void host.adapter
      .onNotice((notice) => {
        if (disposed) return;
        setAdapterNotice(notice);
        recordEventLog(eventFromAdapterNotice(notice));
      })
      .then((fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // Adapter notices are diagnostic-only and must not interrupt startup.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void host.onNavBlocked((payload) => {
      recordEventLog(eventFromNavBlocked(payload));
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const persistSettingsPatch = useCallback(async (patch: Partial<AppSettings>) => {
    const next = mergeSettings(settingsRef.current, patch);
    settingsRef.current = next;
    setAppSettings(next);
    setLanguage(next.language);
    await host.settings.set(next);
  }, [setLanguage]);

  useEffect(() => {
    setTargetSelection((current) => {
      const nextTargets = current.userTouched
        ? current.targets.filter((provider) => activeProviders.includes(provider))
        : [...activeProviders];
      if (
        current.defaultsInitialized &&
        nextTargets.length === current.targets.length &&
        nextTargets.every((provider, index) => provider === current.targets[index])
      ) {
        return current;
      }
      return { ...current, targets: nextTargets, defaultsInitialized: true };
    });
  }, [activeProviders]);

  useEffect(() => {
    let disposed = false;
    void host.settings
      .get()
      .then((value) => {
        if (disposed) return;
        const loaded = normalizeSettings(value);
        settingsRef.current = loaded;
        setAppSettings(loaded);
        setLanguage(loaded.language);
        setFocusPaneWidth(loaded.focusPaneWidth);
        setPresentation(loaded.presentation);
        pendingRestore.current = new Set(restorableOpenProviders(loaded.openProviders, loaded.presentation));
        setInitialRestoreComplete(pendingRestore.current.size === 0);
      })
      .catch(() => {
        if (disposed) return;
        const defaults = defaultSettings();
        settingsRef.current = defaults;
        setAppSettings(defaults);
        setLanguage(defaults.language);
        setPresentation(defaults.presentation);
        setInitialRestoreComplete(true);
      })
      .finally(() => {
        if (!disposed) setSettingsLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, [setLanguage]);

  useEffect(() => {
    const handleBridgeMessage = (message: BridgeMessage) => {
      recordEventLog(eventFromBridgeMessage(message));
      if (message.action === 'STATUS_REPORT' && message.provider) {
        const payload = message.payload as { bridge?: 'ok' | 'degraded'; reason?: string } | undefined;
        if (payload?.bridge) {
          if (message.transport === 'local') {
            if (payload.bridge === 'degraded') pullBridge.current.set(message.provider, { bridge: 'degraded', reason: payload.reason });
            else pullBridge.current.delete(message.provider);
          }
          setStates((current) => ({
            ...current,
            [message.provider as AIProvider]: {
              ...current[message.provider as AIProvider],
              bridge: payload.bridge,
              bridgeReason: payload.reason,
            },
          }));
        }
        return;
      }
      if (message.action === 'WORKFLOW_STATUS') {
        const status = typeof message.payload === 'string' ? message.payload : '';
        setWorkflowStatus(status);
        setProcessTrace((current) => (current ? reduceProcessTraceEvent(current, message, localeRef.current) : current));
        if (status === '') {
          setManualFocusLock(undefined);
          setStepTimeout((current) => nextStepTimeoutState(current, { type: 'settle' }));
        }
        setIsProcessing((current) => processingAfterWorkflowStatus(current, status));
        return;
      }
      if (message.action === 'ROLE_ASSIGNMENT') {
        const provider = providerFromRoleAssignment(message);
        if (!provider) return;
        const payload = message.payload as { label?: unknown } | undefined;
        activeResponses.current.set(
          provider,
          createActiveProviderResponse(provider, typeof payload?.label === 'string' ? payload.label : undefined),
        );
        setProcessTrace((current) => (current ? reduceProcessTraceEvent(current, message, localeRef.current) : current));
        const now = Date.now();
        const refreshedLock = refreshManualLockOnRoleAssignment(manualFocusLockRef.current, now, {
          idlePaused: manualFocusIdlePausedRef.current,
        });
        setManualFocusLock(refreshedLock);
        const manualLock = refreshedLock ?? pointerDebounceLock(manualFocusPointerDownRef.current, now);
        if (
          shouldAutoFocus({
            autoFollowEnabled: autoFollowEnabledRef.current,
            manualLock,
            candidate: provider,
            centered: centerPresentationProvider(presentationRef.current),
          })
        ) {
          void changeProviderPresentationRef.current(provider, 'center');
        }
        return;
      }
      if (message.action === 'WORKFLOW_STEP_CONFIRMED' || message.action === 'WORKFLOW_STEP_FAILED') {
        // A provider's raw RESPONSE_DONE is not proof that the running graph
        // accepted the answer. Only the active waiter emits this local event.
        // Keep it out of the chat transcript; it updates progress only.
        setProcessTrace((current) => (current ? reduceProcessTraceEvent(current, message, localeRef.current) : current));
        return;
      }
      if (!isRenderableResponseMessage(message) || !message.provider) return;
      setProcessTrace((current) => (current ? reduceProcessTraceEvent(current, message, localeRef.current) : current));
      let active = activeResponses.current.get(message.provider);
      if (!active) {
        active = createActiveProviderResponse(message.provider);
        activeResponses.current.set(message.provider, active);
      }
      const { content, truncated } = renderablePayload(message.payload);
      if (
        message.action === 'RESPONSE_DONE' &&
        isGeneratedImageResponse(content) &&
        centerPresentationProvider(presentationRef.current) === message.provider
      ) {
        setCenterSurfaceMode('native');
      }
      setMessages((current) => {
        const id = active.id;
        const existing = current.find((bubble) => bubble.id === id);
        if (existing) {
          return current.map((bubble) =>
            bubble.id === id
              ? { ...bubble, content, truncated, final: message.action === 'RESPONSE_DONE' ? true : bubble.final }
              : bubble,
          );
        }
        return [
          ...current,
          {
            id,
            role: 'ai',
            provider: message.provider,
            modeRole: active.label,
            content,
            truncated,
            final: message.action === 'RESPONSE_DONE',
          },
        ];
      });
      if (message.action === 'RESPONSE_DONE') {
        activeResponses.current.delete(message.provider);
      }
    };

    let disposed = false;
    let cleanupPull: (() => void) | undefined;
    let cleanupUpdates: (() => void) | undefined;
    let cleanupBridge: (() => void) | undefined;

    void startBridgePull().then((cleanup) => {
      if (disposed) cleanup();
      else cleanupPull = cleanup;
    });
    void host.connections.get().then((snapshot) => {
      if (disposed) return;
      const mergedSnapshot = snapshot.map((state) => mergePullBridgeState(state, pullBridge.current.get(state.provider)));
      for (const state of mergedSnapshot) recordEventLog(eventFromProviderState(state, 'snapshot'));
      setStates((current) => ({
        ...current,
        ...Object.fromEntries(mergedSnapshot.map((state) => [state.provider, state])),
      }));
      setConnectionSnapshotLoaded(true);
    });
    void host.connections.onUpdate((state) => {
      const merged = mergePullBridgeState(state, pullBridge.current.get(state.provider));
      recordEventLog(eventFromProviderState(merged));
      setStates((current) => ({ ...current, [state.provider]: merged }));
    }).then((cleanup) => {
      if (disposed) cleanup();
      else cleanupUpdates = cleanup;
    });
    void host.bridge.onMessage(handleBridgeMessage).then((cleanup) => {
      if (disposed) cleanup();
      else cleanupBridge = cleanup;
    });
    const cleanupTimeout = onStepTimeoutEvent((event) => {
      recordEventLog(eventFromStepTimeout(event));
      setStepTimeout((current) => nextStepTimeoutState(current, event));
    });

    return () => {
      disposed = true;
      cleanupPull?.();
      cleanupUpdates?.();
      cleanupBridge?.();
      cleanupTimeout();
    };
  }, [setCenterSurfaceMode, setManualFocusLock]);

  const handleTargetsChange = useCallback((nextTargets: AIProvider[]) => {
    setTargetSelection((current) => markFreeTargetsTouched(current, nextTargets));
  }, []);

  const boundsForProvider = useCallback((provider: AIProvider): DOMRectReadOnly | undefined => {
    if (presentationRef.current[provider] === 'center') {
      return nonEmptyRect(centerStageRef.current?.getBoundingClientRect());
    }
    return nonEmptyRect(paneRefs.current[provider]?.getBoundingClientRect());
  }, []);

  const fallbackBoundsForProvider = useCallback(
    (provider: AIProvider): DOMRectReadOnly => boundsForProvider(provider) ?? new DOMRect(24, 24, 420, 320),
    [boundsForProvider],
  );

  const boundsForPresentationTarget = useCallback((_provider: AIProvider, state: WebviewPresentationState): DOMRectReadOnly | undefined => {
    if (state === 'center') return nonEmptyRect(centerStageRef.current?.getBoundingClientRect());
    if (state === 'side') return hiddenProviderLoadBounds();
    return undefined;
  }, []);

  const beginPresentationTransition = useCallback((provider: AIProvider): number => {
    const generation = presentationTransitionGenerations.current[provider] + 1;
    presentationTransitionGenerations.current[provider] = generation;
    return generation;
  }, []);

  const presentationTransitionCurrent = useCallback(
    (provider: AIProvider, state: WebviewPresentationState, generation: number): boolean =>
      presentationTransitionGenerations.current[provider] === generation && presentationRef.current[provider] === state,
    [],
  );

  const publishCenterTransitionsInFlight = useCallback(() => {
    const next = new Set(centerTransitionGenerations.current.keys());
    centerTransitionsInFlightRef.current = next;
    setCenterTransitionsInFlight(next);
  }, []);

  const startCenterTransitionInFlight = useCallback(
    (provider: AIProvider, generation: number) => {
      centerTransitionGenerations.current.set(provider, generation);
      publishCenterTransitionsInFlight();
    },
    [publishCenterTransitionsInFlight],
  );

  const clearCenterTransitionInFlight = useCallback(
    (provider: AIProvider, generation?: number) => {
      if (generation !== undefined && centerTransitionGenerations.current.get(provider) !== generation) return;
      if (!centerTransitionGenerations.current.delete(provider)) return;
      publishCenterTransitionsInFlight();
    },
    [publishCenterTransitionsInFlight],
  );

  const clearUserHiddenProvider = useCallback((provider: AIProvider) => {
    setUserHidden((current) => {
      if (!current.has(provider)) {
        userHiddenRef.current = current;
        return current;
      }
      const copy = new Set(current);
      copy.delete(provider);
      userHiddenRef.current = copy;
      return copy;
    });
  }, []);

  const waitForProviderPresentationBounds = useCallback(
    (provider: AIProvider, state: WebviewPresentationState, generation: number): Promise<DOMRectReadOnly | undefined> =>
      waitForPresentationTargetBounds({
        getBounds: () => boundsForPresentationTarget(provider, state),
        waitFrame: nextAnimationFrame,
        shouldContinue: () =>
          presentationTransitionCurrent(provider, state, generation) &&
          (state !== 'center' || (centerSurfaceRef.current === 'native' && !overlayGuardOpenRef.current)),
      }),
    [boundsForPresentationTarget, presentationTransitionCurrent],
  );

  const openProvider = useCallback(async (provider: AIProvider) => {
    const rect = fallbackBoundsForProvider(provider);
    resetProviderBootState(provider);
    await host.provider.open(provider, rect);
  }, [fallbackBoundsForProvider]);

  const ensureProviderLoadedHidden = useCallback(
    async (provider: AIProvider, bounds: DOMRectReadOnly, shouldContinue: () => boolean = () => true) => {
      if (!shouldContinue()) return;
      if (statesRef.current[provider].webview !== 'loaded') {
        resetProviderBootState(provider);
        await host.provider.open(provider, bounds);
      }
      if (!shouldContinue()) return;
      await host.provider.park(provider, bounds);
    },
    [],
  );

  const restoreProvider = useCallback(
    async (provider: AIProvider) => {
      const target = presentationRef.current[provider];
      if (target === 'chip') return;
      if (target === 'side') {
        await ensureProviderLoadedHidden(
          provider,
          hiddenProviderLoadBounds(),
          () => presentationRef.current[provider] === 'side',
        );
        return;
      }
      if (target === 'center' && centerSurfaceRef.current === 'text') {
        await ensureProviderLoadedHidden(
          provider,
          hiddenProviderLoadBounds(),
          () => presentationRef.current[provider] === 'center' && centerSurfaceRef.current === 'text',
        );
        return;
      }
      await openProvider(provider);
    },
    [ensureProviderLoadedHidden, openProvider],
  );

  const syncBounds = useCallback(async (provider: AIProvider) => {
    if (statesRef.current[provider].webview !== 'loaded') return;
    const shouldPaintCenter =
      presentationRef.current[provider] === 'center' &&
      centerSurfaceRef.current === 'native' &&
      !userHiddenRef.current.has(provider) &&
      !overlayGuardOpenRef.current;
    if (!shouldPaintCenter) {
      await host.provider.park(provider, hiddenProviderLoadBounds());
      return;
    }
    const rect = boundsForProvider(provider);
    if (!rect) return;
    await host.layout.setBounds(provider, rect);
  }, [boundsForProvider]);

  const syncAllBounds = useCallback(() => {
    for (const provider of PROVIDERS) {
      void syncBounds(provider);
    }
  }, [syncBounds]);

  const driveCenteredProviderToStage = useCallback(async (provider: AIProvider) => {
    if (centerSurfaceRef.current !== 'native') return;
    // overlay(設定、preflight 等)開啟時 guard 已 hide webview；此處若照常把
    // bounds 推回舞台，syncBounds 的 park→show 會讓 webview 重新蓋在 overlay 上。
    if (overlayGuardOpenRef.current) return;
    await driveCenteredProviderToStageCommand({
      provider,
      presentation: presentationRef.current[provider],
      webview: statesRef.current[provider].webview,
      bounds: centerStageRef.current?.getBoundingClientRect(),
      setBounds: host.layout.setBounds,
    });
  }, []);

  const setPaneRef = useCallback(
    (provider: AIProvider, el: HTMLElement | null) => {
      paneRefs.current[provider] = el;
      if (!el) return;
      void syncBounds(provider);
      if (pendingRestore.current.has(provider)) {
        pendingRestore.current.delete(provider);
        void restoreProvider(provider).finally(() => {
          if (pendingRestore.current.size === 0) setInitialRestoreComplete(true);
        });
      }
    },
    [restoreProvider, syncBounds],
  );

  const resyncNativeBounds = useCallback(() => {
    syncAllBounds();
    if (centeredProvider && centerSurfaceRef.current === 'native') void driveCenteredProviderToStage(centeredProvider);
  }, [centeredProvider, driveCenteredProviderToStage, syncAllBounds]);

  // FocusPane 面板在極端小視窗下允許捲動；捲動不會觸發 ResizeObserver（尺寸沒變，只是位置變了），
  // 靠這個 onScroll 立即重新同步原生 webview 座標，而不是只依賴既有的 2.5s 輪詢 fallback。
  const handleFocusPaneScroll = useMemo(() => throttleWithFrame(resyncNativeBounds), [resyncNativeBounds]);

  const updateScrollFocusedProvider = useCallback(() => {
    const container = transcriptRef.current;
    if (!container) return;
    const provider = findScrollActiveProvider(container);
    setScrollFocusedProvider((current) => (current === provider ? current : provider));
  }, []);

  // 訊息面板捲動時，換左側對應 chip 反白，讓長回應也能看得出是哪個 AI 講的。
  const handleTranscriptScroll = useMemo(() => throttleWithFrame(updateScrollFocusedProvider), [updateScrollFocusedProvider]);

  useEffect(() => {
    handleTranscriptScroll();
  }, [messages, handleTranscriptScroll]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(handleTranscriptScroll);
    observer.observe(container);
    return () => observer.disconnect();
  }, [handleTranscriptScroll]);

  const setCenterStageRef = useCallback(
    (el: HTMLDivElement | null) => {
      centerStageRef.current = el;
      if (!el) return;
      const provider = centerPresentationProvider(presentationRef.current);
      if (!provider) return;
      if (centerSurfaceRef.current === 'native') void syncBounds(provider);
      if (pendingRestore.current.has(provider)) {
        pendingRestore.current.delete(provider);
        void restoreProvider(provider).finally(() => {
          if (pendingRestore.current.size === 0) setInitialRestoreComplete(true);
        });
      }
    },
    [restoreProvider, syncBounds],
  );

  useEffect(() => {
    if (!settingsLoaded || initialRestoreComplete || pendingRestore.current.size === 0) return;

    for (const provider of Array.from(pendingRestore.current)) {
      const state = presentation[provider];
      if (state === 'chip') {
        pendingRestore.current.delete(provider);
        continue;
      }
      const hasPlaceholder = state === 'center' ? Boolean(centerStageRef.current) : Boolean(paneRefs.current[provider]);
      if (!hasPlaceholder) continue;
      pendingRestore.current.delete(provider);
      void restoreProvider(provider).finally(() => {
        if (pendingRestore.current.size === 0) setInitialRestoreComplete(true);
      });
    }

    if (pendingRestore.current.size === 0) setInitialRestoreComplete(true);
  }, [centeredProvider, initialRestoreComplete, presentation, restoreProvider, settingsLoaded]);

  const persistPresentation = useCallback(
    async (next: PresentationByProvider) => {
      presentationRef.current = next;
      setPresentation(next);
      await persistSettingsPatch({ presentation: next });
      if (presentationRef.current !== next) {
        await host.settings.set(settingsRef.current);
      }
    },
    [persistSettingsPatch],
  );

  const hideCenterSiblingsForTransition = useCallback(
    async (provider: AIProvider, generation: number) => {
      if (centerSurfaceRef.current !== 'native') return;
      const previous = centerHiddenRef.current;
      const next = new Set(
        centerHiddenProviders(
          presentationRef.current,
          statesRef.current,
          userHiddenRef.current,
          PROVIDERS,
          centerTransitionsInFlightRef.current,
        ),
      );
      const snapshot = () => ({
        states: statesRef.current,
        presentation: presentationRef.current,
        userHidden: userHiddenRef.current,
        overlayGuardOpen: overlayGuardOpenRef.current,
      });
      const shouldContinueNative = () => presentationTransitionCurrent(provider, 'center', generation) && centerSurfaceRef.current === 'native';

      await applyCenterHiddenCommands({
        host: presentationHost,
        previousHidden: previous,
        nextHidden: next,
        snapshot,
        getRestoreBounds: () => centerSurfaceRef.current === 'native'
          ? nonEmptyRect(centerStageRef.current?.getBoundingClientRect())
          : undefined,
        shouldContinue: shouldContinueNative,
        restoreRemoved: false,
      });

      if (shouldContinueNative() && !providerSetEquals(previous, next)) {
        centerHiddenRef.current = next;
        setCenterHidden(next);
      } else if (centerSurfaceRef.current !== 'native') {
        await applyCenterHiddenCommands({
          host: presentationHost,
          previousHidden: next,
          nextHidden: new Set(),
          snapshot,
          getRestoreBounds: () => centerSurfaceRef.current === 'native'
            ? nonEmptyRect(centerStageRef.current?.getBoundingClientRect())
            : undefined,
          shouldContinue: () => centerSurfaceRef.current !== 'native',
        });
      }
    },
    [presentationTransitionCurrent],
  );

  const changeProviderPresentation = useCallback(
    async (provider: AIProvider, state: WebviewPresentationState) => {
      if (!activeProvidersForStandby(settingsRef.current.standbyProvider).includes(provider)) return;
      const generation = beginPresentationTransition(provider);
      const next = setProviderPresentation(presentationRef.current, provider, state);
      if (state === 'center') startCenterTransitionInFlight(provider, generation);
      else clearCenterTransitionInFlight(provider);

      await persistPresentation(next);
      clearUserHiddenProvider(provider);

      if (state === 'chip') {
        await applyPresentationTransitionCommand({
          host: presentationHost,
          provider,
          state,
          bounds: new DOMRect(0, 0, 0, 0),
          webview: statesRef.current[provider].webview,
          currentWebview: () => statesRef.current[provider].webview,
          shouldContinue: () => presentationTransitionCurrent(provider, state, generation),
        });
        if (presentationTransitionCurrent(provider, state, generation)) resetProviderBootState(provider);
        return;
      }

      const ensureTextCenterLoadedHidden = async () => {
        try {
          await ensureProviderLoadedHidden(
            provider,
            hiddenProviderLoadBounds(),
            () => presentationTransitionCurrent(provider, 'center', generation) && centerSurfaceRef.current === 'text',
          );
        } catch (error) {
          clearCenterTransitionInFlight(provider, generation);
          throw error;
        }
      };

      if (state === 'center' && centerSurfaceRef.current !== 'native') {
        await ensureTextCenterLoadedHidden();
        return;
      }

      const bounds = await waitForProviderPresentationBounds(provider, state, generation);
      if (!bounds) {
        if (state === 'center' && centerSurfaceRef.current === 'text') {
          await ensureTextCenterLoadedHidden();
        } else if (state === 'center') {
          clearCenterTransitionInFlight(provider, generation);
        }
        return;
      }

      if (state === 'center' && centerSurfaceRef.current !== 'native') {
        await ensureTextCenterLoadedHidden();
        return;
      }

      if (state === 'center') await hideCenterSiblingsForTransition(provider, generation);
      if (!presentationTransitionCurrent(provider, state, generation)) return;

      try {
        const shouldContinue = () =>
          presentationTransitionCurrent(provider, state, generation) &&
          (state !== 'center' || (centerSurfaceRef.current === 'native' && !overlayGuardOpenRef.current && !userHiddenRef.current.has(provider)));
        if (statesRef.current[provider].webview !== 'loaded') resetProviderBootState(provider);
        await applyPresentationTransitionCommand({
          host: presentationHost,
          provider,
          state,
          bounds,
          webview: statesRef.current[provider].webview,
          currentWebview: () => statesRef.current[provider].webview,
          shouldContinue,
        });
        if (state === 'center' && !shouldContinue() && statesRef.current[provider].webview === 'loaded') {
          await host.provider.park(provider, hiddenProviderLoadBounds());
        }
      } catch (error) {
        if (state === 'center') clearCenterTransitionInFlight(provider, generation);
        throw error;
      }
    },
    [
      beginPresentationTransition,
      clearCenterTransitionInFlight,
      clearUserHiddenProvider,
      ensureProviderLoadedHidden,
      hideCenterSiblingsForTransition,
      persistPresentation,
      presentationTransitionCurrent,
      startCenterTransitionInFlight,
      waitForProviderPresentationBounds,
    ],
  );

  useEffect(() => {
    changeProviderPresentationRef.current = changeProviderPresentation;
  }, [changeProviderPresentation]);

  const forceProviderNativeCenter = useCallback(
    async (provider: AIProvider) => {
      if (!activeProvidersForStandby(settingsRef.current.standbyProvider).includes(provider)) {
        throw new Error(`${provider} is configured as the standby provider`);
      }
      forcedNativeCenterProviderRef.current = provider;
      setCenterSurfaceMode('native');
      markManualFocusControl(provider);
      try {
        await changeProviderPresentationRef.current(provider, 'center');
      } finally {
        if (centerPresentationProvider(presentationRef.current) === provider) {
          setCenterSurfaceMode('native');
        } else if (forcedNativeCenterProviderRef.current === provider) {
          forcedNativeCenterProviderRef.current = undefined;
        }
      }
    },
    [markManualFocusControl, setCenterSurfaceMode],
  );

  const changeProviderPresentationManually = useCallback(
    async (provider: AIProvider, state: WebviewPresentationState) => {
      markManualFocusControl(provider);
      await changeProviderPresentation(provider, state);
    },
    [changeProviderPresentation, markManualFocusControl],
  );

  const autoFocusRunCandidate = useCallback((candidate: AIProvider | undefined) => {
    if (!candidate) return;
    const now = Date.now();
    const refreshedLock = refreshManualLockOnRoleAssignment(manualFocusLockRef.current, now, {
      idlePaused: manualFocusIdlePausedRef.current,
    });
    setManualFocusLock(refreshedLock);
    const manualLock = refreshedLock ?? pointerDebounceLock(manualFocusPointerDownRef.current, now);
    if (
      shouldAutoFocus({
        autoFollowEnabled: autoFollowEnabledRef.current,
        manualLock,
        candidate,
        centered: centerPresentationProvider(presentationRef.current),
      })
    ) {
      void changeProviderPresentationRef.current(candidate, 'center');
    }
  }, [setManualFocusLock]);

  useEffect(() => {
    const nativeCenterSurface = centerSurfaceRef.current === 'native';
    const next = presentationHiddenProvidersForCenterSurface({
      centerSurface: nativeCenterSurface ? 'native' : 'text',
      presentation,
      states,
      userHidden,
      providers: PROVIDERS,
      centerTransitionsInFlight,
    });
    const previous = centerHiddenRef.current;
    const centered = centerPresentationProvider(presentation);
    const snapshot = () => ({
      states: statesRef.current,
      presentation: presentationRef.current,
      userHidden: userHiddenRef.current,
      overlayGuardOpen: overlayGuardOpenRef.current,
    });

    if (centered && states[centered].webview === 'loaded') {
      if (nativeCenterSurface) {
        const bounds = nonEmptyRect(centerStageRef.current?.getBoundingClientRect());
        if (bounds) {
          const shouldPaintCenter = () =>
            presentationRef.current[centered] === 'center' &&
            centerSurfaceRef.current === 'native' &&
            !userHiddenRef.current.has(centered) &&
            !overlayGuardOpenRef.current;
          void (async () => {
            await applyPresentationTransitionCommand({
              host: presentationHost,
              provider: centered,
              state: 'center',
              bounds,
              webview: statesRef.current[centered].webview,
              currentWebview: () => statesRef.current[centered].webview,
              shouldContinue: shouldPaintCenter,
            });
            if (!shouldPaintCenter()) {
              if (presentationRef.current[centered] === 'center' && statesRef.current[centered].webview === 'loaded') {
                await host.provider.park(centered, hiddenProviderLoadBounds());
              }
              return;
            }
            await applyCenterStageCommand({
              host: presentationHost,
              provider: centered,
              bounds,
              overlappingProviders: Array.from(next),
              currentWebview: (candidate) => statesRef.current[candidate].webview,
              shouldContinue: () => presentationRef.current[centered] === 'center' && centerSurfaceRef.current === 'native',
            });
            if (centerSurfaceRef.current !== 'native') {
              if (presentationRef.current[centered] === 'center' && statesRef.current[centered].webview === 'loaded') {
                await host.provider.park(centered, hiddenProviderLoadBounds());
              }
              await applyCenterHiddenCommands({
                host: presentationHost,
                previousHidden: next,
                nextHidden: new Set(),
                snapshot,
                getRestoreBounds: () => centerSurfaceRef.current === 'native'
                  ? nonEmptyRect(centerStageRef.current?.getBoundingClientRect())
                  : undefined,
                shouldContinue: () => centerSurfaceRef.current !== 'native',
              });
            }
          })();
        }
      }
    }

    void applyCenterHiddenCommands({
      host: presentationHost,
      previousHidden: previous,
      nextHidden: next,
      snapshot,
      getRestoreBounds: () => centerSurfaceRef.current === 'native'
        ? nonEmptyRect(centerStageRef.current?.getBoundingClientRect())
        : undefined,
    });

    if (!providerSetEquals(previous, next)) {
      centerHiddenRef.current = next;
      setCenterHidden(next);
    }
  }, [centerSurface, centerTransitionsInFlight, presentation, states, userHidden]);

  useEffect(() => {
    for (const provider of Array.from(centerTransitionsInFlight)) {
      if (presentation[provider] !== 'center' || states[provider].webview === 'loaded') {
        clearCenterTransitionInFlight(provider);
      }
    }
  }, [centerTransitionsInFlight, clearCenterTransitionInFlight, presentation, states]);

  useEffect(() => {
    if (
      !settingsLoaded ||
      !connectionSnapshotLoaded ||
      !initialRestoreComplete ||
      settingsOpen ||
      openProviders.join('|') === settingsRef.current.openProviders.join('|')
    ) {
      return;
    }
    void persistSettingsPatch({ openProviders });
  }, [connectionSnapshotLoaded, initialRestoreComplete, openProviders, persistSettingsPatch, settingsLoaded, settingsOpen]);

  useEffect(() => {
    const onResize = () => {
      const containerWidth = gridRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setFocusPaneWidth((current) => clampFocusPaneWidth(current, containerWidth));
      resyncNativeBounds();
    };
    window.addEventListener('resize', onResize);

    const observers: ResizeObserver[] = [];
    if ('ResizeObserver' in window) {
      for (const provider of PROVIDERS) {
        const el = paneRefs.current[provider];
        if (!el) continue;
        const observer = new ResizeObserver(() => {
          void syncBounds(provider);
        });
        observer.observe(el);
        observers.push(observer);
      }
      if (centeredProvider && centerSurface === 'native' && centerStageRef.current) {
        const observer = new ResizeObserver(() => {
          void driveCenteredProviderToStage(centeredProvider);
        });
        observer.observe(centerStageRef.current);
        observers.push(observer);
      }
    }

    const timer = window.setInterval(onResize, 2500);
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearInterval(timer);
      for (const observer of observers) observer.disconnect();
    };
  }, [centerSurface, centeredProvider, driveCenteredProviderToStage, resyncNativeBounds, syncBounds]);

  useEffect(() => {
    syncAllBounds();
  }, [focusPaneWidth, presentation, syncAllBounds]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container) return;
    const sessionChanged = transcriptSessionRef.current !== activeSessionId;
    const latestMessage = messages[messages.length - 1];
    const userSentMessage =
      latestMessage?.role === 'user' && transcriptLastMessageIdRef.current !== latestMessage.id;
    transcriptSessionRef.current = activeSessionId;
    transcriptLastMessageIdRef.current = latestMessage?.id;
    if (sessionChanged || userSentMessage) transcriptStickToEndRef.current = true;
    if (transcriptStickToEndRef.current) scrollTranscriptToEnd(container);
  }, [activeSessionId, messages]);

  // overlay 關閉後立即把置中的 webview 推回舞台，不等 2.5 秒的定時同步。
  useEffect(() => {
    if (overlayGuardOpen) return;
    if (centeredProvider && centerSurfaceRef.current === 'native') void driveCenteredProviderToStage(centeredProvider);
  }, [overlayGuardOpen, centeredProvider, driveCenteredProviderToStage]);

  const executeSend = async (trimmed: string, preparedWorkflowTargets?: AIProvider[], preparedWorkflowRoles?: ModeRoles) => {
    if (!trimmed) return;
    const brainstorm = presetId === 'brainstorm';
    const workflowTargets = mode === 'free' && !brainstorm
      ? presetId === 'simple'
        ? simpleChatTargets(simpleAgent, statesRef.current)
        : preparedWorkflowTargets ?? freeModeTargets(targets, statesRef.current)
      : undefined;
    if (workflowTargets?.length === 0) return;
    const previousWorkflowExecution = workflowExecutionTailRef.current;
    let releaseWorkflowExecution = () => {};
    workflowExecutionTailRef.current = new Promise<void>((resolve) => {
      releaseWorkflowExecution = resolve;
    });
    await previousWorkflowExecution;
    try {
      const workflowExecutionGeneration = workflowExecutionGenerationRef.current + 1;
      workflowExecutionGenerationRef.current = workflowExecutionGeneration;
      if (mode === 'free') {
        const brainstormRoles = brainstorm ? defaultRolesForPreset(mode, presetId, settingsRef.current.modeRoles) : undefined;
        autoFocusRunCandidate(brainstormRoles ? Object.values(brainstormRoles)[0] : workflowTargets?.[0]);
      }
      const replayContext =
        replayContextSessionRef.current === activeSessionId ? buildConversationReplayContext(messages) : undefined;
      setMessages((current) => [
        ...current,
        { id: createConversationMessageId('user'), role: 'user', content: trimmed, final: true },
      ]);
      setIsProcessing(processingAfterSend());
      setProcessTrace(createProcessTrace(mode, workflowTargets ?? [], localeRef.current, presetId));
      const workflowStartedAt = Date.now();
      const snapshotSettings = settingsRef.current;
      const workflowRoles = preparedWorkflowRoles ?? defaultRolesForPreset(mode, presetId, snapshotSettings.modeRoles);
      recordEventLog(eventFromWorkflowStart(mode, trimmed.length, workflowTargets?.length));
      const result = await runWorkflow({
        text: trimmed,
        context: mergeProjectContext(effectiveProjectStore, replayContext),
        mode,
        presetId,
        roles: workflowRoles,
        targets: workflowTargets,
        activeProviders: activeProvidersForStandby(snapshotSettings.standbyProvider),
        locale: localeRef.current,
        snapshotPersistence: snapshotSettings.snapshotPersistence,
        snapshotRedactionTier: snapshotSettings.snapshotRedactionTier,
        responseLanguagePolicy: createResponseLanguagePolicy(snapshotSettings.responseLanguage, localeRef.current),
      });
      if (workflowExecutionGeneration !== workflowExecutionGenerationRef.current) return;
      const blockedPreflight = preflightFromResult(mode, result, presetId);
      if (result.ok) replayContextSessionRef.current = undefined;
      if (blockedPreflight) {
        recordEventLog(
          eventFromWorkflowPreflightBlocked(mode, blockedPreflight.result.unavailable.length + blockedPreflight.result.aliased.length),
        );
        setPreflight(blockedPreflight);
        setProcessTrace((current) => (current?.steps.length === 0 ? undefined : current));
      }
      recordEventLog(eventFromWorkflowSettled(mode, Date.now() - workflowStartedAt));
      setStepTimeout(undefined);
      setCheckpoint(undefined);
      setCheckpointDraft('');
      activeResponses.current.clear();
      setIsProcessing(processingAfterSettle());
    } finally {
      releaseWorkflowExecution();
    }
  };

  const send = async (trimmed: string): Promise<boolean> => {
    if (!trimmed) return false;
    const brainstorm = presetId === 'brainstorm';
    const serialMode = isSerialMode(mode) ? mode as Exclude<ChatMode, 'free'> : undefined;
    const modeRoles = settingsRef.current.modeRoles;
    const consultRoles = mode === 'consult'
      ? chooseConsultRoles(
          modeRoles.consult,
          availableConsultProviders(
            statesRef.current,
            activeProvidersForStandby(settingsRef.current.standbyProvider),
          ),
        )
      : undefined;
    // Unlike Free mode, Consult must have two independent providers to
    // compare answers. Do not silently fall back to a single-model review.
    if (mode === 'consult' && !consultRoles) {
      setWorkflowStatus('Consult requires two signed-in, ready providers.');
      return false;
    }
    const workflowRoles = mode === 'consult'
      ? consultRoles
      : brainstorm
        ? defaultRolesForPreset(mode, presetId, modeRoles)
        : serialMode
          ? defaultRolesForPreset(serialMode, undefined, modeRoles)
          : undefined;
    const participants = workflowRoles
      ? [...new Set(Object.values(workflowRoles))]
      : presetId === 'simple'
        ? simpleChatTargets(simpleAgent, statesRef.current)
        : freeModeTargets(targets, statesRef.current);

    const providersToFreshen = pendingProviderSessionResets(
      pendingProviderResetRef.current,
      participants,
      (provider) => statesRef.current[provider].webview === 'loaded',
    );
    if (providersToFreshen.length > 0) {
      const resetAttempt = ++providerSessionResetAttemptRef.current;
      setIsProcessing(processingAfterSend());
      setWorkflowStatus(translate('input.preparingSession'));
      try {
        await ensureFreshProviderSessions(providersToFreshen, {
          resetBootState: resetProviderBootState,
          newSession: (provider) => host.provider.newSession(provider),
        });
        if (providerSessionResetAttemptRef.current !== resetAttempt) return false;
        for (const provider of providersToFreshen) pendingProviderResetRef.current.delete(provider);
        // 重置後頁面重新導航，login 狀態要等下一輪 STATUS_REPORT 才回穩；
        // 不等的話 fan-out 目標會被暫時性的 logged_out/blocked 誤過濾掉。
        await waitForProvidersSendable(
          providersToFreshen,
          () => statesRef.current,
          undefined,
          undefined,
          () => providerSessionResetAttemptRef.current !== resetAttempt,
        );
        if (providerSessionResetAttemptRef.current !== resetAttempt) return false;
        setWorkflowStatus('');
      } catch (reason) {
        const resetError = reason instanceof ProviderSessionResetError ? reason : undefined;
        for (const provider of resetError?.completedProviders ?? []) pendingProviderResetRef.current.delete(provider);
        const failures = resetError?.failures ?? providersToFreshen.map((provider) => ({ provider, reason }));
        for (const failure of failures) {
          recordEventLog({
            kind: 'workflow-error',
            provider: failure.provider,
            summary: `${AI_PROVIDERS[failure.provider].name} session restore reset failed`,
            detail: { failure: failure.reason instanceof Error ? failure.reason.message : String(failure.reason) },
          });
        }
        if (providerSessionResetAttemptRef.current === resetAttempt) {
          setWorkflowStatus(translate('input.sessionResetFailed'));
          setIsProcessing(false);
        }
        return false;
      }
    }

    const serialGraph = brainstorm ? workflowGraphs.brainstorm : serialMode ? workflowGraphs[serialMode] : undefined;
    if (serialGraph) {
      try {
        const result = await preflightGraph(
          serialGraph,
          workflowRoles,
          activeProvidersForStandby(settingsRef.current.standbyProvider),
        );
        if (!result.ok) {
          recordEventLog(eventFromWorkflowPreflightBlocked(mode, result.unavailable.length + result.aliased.length));
          setPreflight({ mode: brainstorm ? 'brainstorm' : serialMode!, result });
          setIsProcessing(false);
          return false;
        }
      } catch {
        setWorkflowStatus(translate('input.sendFailed'));
        setIsProcessing(false);
        return false;
      }
    }

    const workflowTargets = serialGraph
      ? undefined
      : presetId === 'simple'
        ? simpleChatTargets(simpleAgent, statesRef.current)
        : freeModeTargets(targets, statesRef.current);
    if (workflowTargets?.length === 0) {
      setWorkflowStatus(translate('input.sendFailed'));
      setIsProcessing(false);
      return false;
    }

    void executeSend(trimmed, workflowTargets, workflowRoles);
    return true;
  };

  const dismissStartupSessionCheckpoint = useCallback(() => {
    setSessionCheckpointNotice(undefined);
    void clearStartupSessionCheckpointNotice();
  }, []);

  const replayStartupSessionCheckpoint = useCallback(() => {
    if (!sessionCheckpointNotice?.replaySnapshot) return;
    const source: ReplaySource = {
      kind: 'stored',
      snapshotId: sessionCheckpointNotice.replaySnapshot.id,
      info: sessionCheckpointNotice.replaySnapshot,
    };
    setReplayDrawerOpen(true);
    setSessionCheckpointReplayBusy(true);
    const replay = replayPanelRef.current?.startReplay(source);
    if (replay) {
      void replay.finally(() => setSessionCheckpointReplayBusy(false));
    } else {
      setSessionCheckpointReplayBusy(false);
    }
  }, [sessionCheckpointNotice]);

  const cancelWorkflow = () => {
    providerSessionResetAttemptRef.current += 1;
    publishBridgeMessage({ v: 1, action: 'CANCEL_WORKFLOW', transport: 'local' });
    setManualFocusLock(undefined);
    setIsProcessing(false);
    setWorkflowStatus('');
    setStepTimeout(undefined);
    setCheckpoint(undefined);
    setCheckpointDraft('');
    activeResponses.current.clear();
    setProcessTrace((current) => (current ? settleProcessTrace(current) : current));
  };

  const startNewConversation = useCallback((projectId?: string) => {
    if (isProcessing) return;
    const now = Date.now();
    const transition = beginNewConversationSession({
      sessions,
      activeSessionId,
      messages: conversationMessages(messages),
      mode,
      presetId: conversationPresetId(presetId, mode),
      projectId,
      now,
    });
    setSessions(persistConversationSessions(transition.sessions));
    setActiveSessionId(transition.active.id);
    replayContextSessionRef.current = undefined;
    setMessages([]);
    setMode('free');
    setPresetId('simple');
    setWorkflowStatus('');
    setProcessTrace(undefined);
    setReplayDrawerOpen(false);
    setTargetSelection({ targets: [...activeProviders], defaultsInitialized: true, userTouched: false });
    activeResponses.current.clear();
    pendingProviderResetRef.current = new Set(
      activeProviders.filter((provider) => statesRef.current[provider].webview === 'loaded'),
    );
  }, [activeProviders, activeSessionId, isProcessing, messages, mode, presetId, sessions]);

  const assignConversationProject = useCallback((session: ConversationSession, projectId?: string) => {
    if (isProcessing) return;
    const assignedId = projectId && projectStore.projects.some((project) => project.id === projectId)
      ? projectId : undefined;
    setSessions((current) => {
      const existing = current.find((candidate) => candidate.id === session.id);
      if (!existing || existing.projectId === assignedId) return current;
      const next: ConversationSession = { ...existing, updatedAt: Date.now() };
      if (assignedId) next.projectId = assignedId;
      else delete next.projectId;
      return persistConversationSessions(upsertConversationSession(current, next));
    });
  }, [isProcessing, projectStore.projects]);

  const createSidebarProject = useCallback(async (name: string) => {
    if (isProcessing || !projectsReady) throw new Error('Projects are unavailable while a workflow is active.');
    if (projectStore.projects.length >= 100) throw new Error('Project limit reached.');
    const now = Date.now();
    const projectId = `project-${crypto.randomUUID()}`;
    const nextStore: ProjectStore = {
      ...projectStore,
      activeProjectId: projectId,
      projects: [...projectStore.projects, { id: projectId, name, instructions: '', createdAt: now, updatedAt: now }],
    };
    await host.projects.save(nextStore);
    setProjectStore(nextStore);
    // Start a fresh chat within the new project; the previous conversation is archived.
    startNewConversation(projectId);
  }, [isProcessing, projectsReady, projectStore, startNewConversation]);

  const selectConversationSession = useCallback(
    (session: ConversationSession) => {
      if (isProcessing || session.id === activeSessionId) return;
      setActiveSessionId(session.id);
      replayContextSessionRef.current = session.messages.length > 0 ? session.id : undefined;
      setMessages(bubblesFromSession(session));
      setMode(session.mode);
      setPresetId(session.presetId ?? session.mode);
      setWorkflowStatus('');
      setProcessTrace(undefined);
      setReplayDrawerOpen(false);
      setTargetSelection({ targets: [...activeProviders], defaultsInitialized: true, userTouched: false });
      activeResponses.current.clear();
      // 切換歷史只換本地畫面，保留 provider webview 原連線（不重連）讓使用者能繼續瀏覽；
      // 遠端 thread 仍屬於前一個 session，真正送出前 executeSend 會先建立乾淨 provider session。
      pendingProviderResetRef.current = new Set(
        activeProviders.filter((provider) => statesRef.current[provider].webview === 'loaded'),
      );
    },
    [activeProviders, activeSessionId, isProcessing],
  );

  const deleteConversationSession = useCallback(
    (session: ConversationSession) => {
      if (isProcessing) return;
      const remaining = removeConversationSession(sessions, session.id);
      if (session.id !== activeSessionId) {
        setSessions(persistConversationSessions(remaining));
        return;
      }

      const nextActive = remaining[0] ?? createConversationSession();
      const next = upsertConversationSession(remaining, nextActive);
      setSessions(persistConversationSessions(next));
      selectConversationSession(nextActive);
    },
    [activeSessionId, isProcessing, selectConversationSession, sessions],
  );

  const exportConversation = async () => {
    if (messages.length === 0 || sharing) return;
    setSharing(true);
    try {
      const now = new Date();
      const appVersion = await getRuntimeAppVersion();
      const snapshot = matchingSnapshotForConversation(messages, getLastSnapshot());
      const exportPreset =
        presetId === 'brainstorm'
          ? {
              id: presetId,
              icon: '✨',
              name: translateKey('preset.brainstorm.displayName', localeRef.current),
            }
          : undefined;
      const { content } = buildMarkdown(messages, mode, now, { appVersion, snapshot, preset: exportPreset });
      const saved = await host.share.exportMarkdown(exportFilename(mode, now, exportPreset?.id), content);
      if (saved) setShareNotice({ kind: 'ok', text: formatI18n(translateKey('share.exported', localeRef.current), { path: saved }) });
    } catch (reason) {
      recordEventLog({
        ts: Date.now(),
        kind: 'workflow-error',
        summary: translateKey('share.exportFailed', localeRef.current),
        detail: { operation: 'export', error: reason instanceof Error ? reason.message : String(reason) },
      });
      setShareNotice({ kind: 'error', text: translateKey('share.exportFailed', localeRef.current) });
    } finally {
      setSharing(false);
    }
  };

  const reportProvider = useCallback(
    async (provider: AIProvider) => {
      if (reportBusy) return;
      setReportBusy(true);
      try {
        const raw = await host.adapter.reportBroken(provider);
        const digest = JSON.parse(raw) as ReportDigest;
        setReportPreview({ provider, digest, body: formatReportBody(digest) });
      } finally {
        setReportBusy(false);
      }
    },
    [reportBusy],
  );

  const openReportIssue = async () => {
    if (!reportPreview || reportBusy) return;
    setReportBusy(true);
    try {
      await host.adapter.openIssue(reportPreview.provider, reportPreview.body);
    } finally {
      setReportBusy(false);
    }
  };

  const dragFocusPane = (deltaX: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      dragStartFocusPaneWidth.current = focusPaneWidth;
      return;
    }
    const containerWidth = gridRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxWidth = Math.max(
      DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.minFocusPaneWidth,
      containerWidth - DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.minCenterWidth - DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.resizerWidth,
    );
    const nextWidth = dragFocusPaneWidth(
      dragStartFocusPaneWidth.current,
      deltaX,
      DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.minFocusPaneWidth,
      maxWidth,
    );
    setFocusPaneWidth(nextWidth);
    if (phase === 'end') void persistSettingsPatch({ focusPaneWidth: nextWidth });
  };

  const enlargeCenter = useCallback(() => {
    const provider = centerPresentationProvider(presentationRef.current);
    if (!provider) return;
    // A native WKWebView paints above React regardless of CSS z-index.
    // Real page lives in a separate, movable OS window, while the workbench
    // stays in the readable text mode with all of its controls accessible.
    setProviderWindowError(undefined);
    setProviderWindowGeometry(undefined);
    void (async () => {
      await ensureProviderLoadedHidden(provider, hiddenProviderLoadBounds());
      const dimensions = await host.provider.openWindow(provider);
      setProviderWindowGeometry(dimensions);
    })().catch((error: unknown) => {
      setProviderWindowError(error instanceof Error ? error.message : String(error));
    });
  }, [ensureProviderLoadedHidden]);

  const viewWorkflowProvider = useCallback((provider: AIProvider) => {
    // Inspect the actual provider page without restarting or claiming a step
    // has completed. Uses the existing permanent native window and session.
    setProviderWindowError(undefined);
    void (async () => {
      await ensureProviderLoadedHidden(provider, hiddenProviderLoadBounds());
      setProviderWindowGeometry(await host.provider.openWindow(provider));
    })().catch((error: unknown) => {
      setProviderWindowError(error instanceof Error ? error.message : String(error));
    });
  }, [ensureProviderLoadedHidden]);

  const openProviderModelSettings = useCallback((provider: AIProvider) => {
    setModelSettingsProvider(provider);
    setProviderWindowError(undefined);
    setProviderWindowGeometry(undefined);
    // Model and effort menus belong to the provider. Never pretend a local
    // preference changed the model if the actual page cannot confirm it.
    void (async () => {
      await ensureProviderLoadedHidden(provider, hiddenProviderLoadBounds());
      const geometry = await host.provider.openWindow(provider);
      setProviderWindowGeometry(geometry);
    })().catch((error: unknown) => {
      setProviderWindowError(error instanceof Error ? error.message : String(error));
    });
  }, [ensureProviderLoadedHidden]);

  const collapseCenter = useCallback(() => {
    const provider = centerPresentationProvider(presentationRef.current);
    forcedNativeCenterProviderRef.current = undefined;
    if (provider) {
      beginPresentationTransition(provider);
      clearCenterTransitionInFlight(provider);
    }
    setCenterSurfaceMode('text');
    if (provider && statesRef.current[provider].webview === 'loaded') {
      void host.provider.park(provider, hiddenProviderLoadBounds());
    }
  }, [beginPresentationTransition, clearCenterTransitionInFlight, setCenterSurfaceMode]);

  // Native menu shortcut: make the workbench usable even if a login WebView
  // or a popup has covered every clickable React control.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void host.onReturnToWorkbench(() => {
      setStageExpanded(false);
      setMessagesMaximized(false);
      collapseCenter();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [collapseCenter]);

  const openProviderLogin = useCallback(
    async (provider: AIProvider) => {
      if (!activeProvidersForStandby(settingsRef.current.standbyProvider).includes(provider)) {
        throw new Error(`${provider} is configured as the standby provider`);
      }
      setMessagesMaximized(false);
      for (let attempt = 0; attempt < 8 && overlayGuardOpenRef.current; attempt += 1) {
        await nextAnimationFrame();
      }
      if (overlayGuardOpenRef.current) throw new Error('Cannot open provider login while an overlay is active');
      // Open authentication in a movable, native standalone provider window.
      // Keep the same browser instance/profile so workflows still see login.
      await changeProviderPresentationRef.current(provider, 'center');
      await ensureProviderLoadedHidden(provider, hiddenProviderLoadBounds());
      const dimensions = await host.provider.openWindow(provider, true);
      setProviderWindowGeometry(dimensions);
      setCenterSurfaceMode('text');
    },
    [ensureProviderLoadedHidden, setCenterSurfaceMode],
  );

  const openPreflightLogin = useCallback(
    async (provider: AIProvider) => {
      setPreflightLoginPending(true);
      try {
        await openProviderLogin(provider);
      } finally {
        setPreflightLoginPending(false);
      }
    },
    [openProviderLogin],
  );

  const applySavedSettings = (settings: AppSettings) => {
    const previousStandby = settingsRef.current.standbyProvider;
    const nextActiveProviders = activeProvidersForStandby(settings.standbyProvider);
    if (previousStandby !== settings.standbyProvider) {
      setTargetSelection((current) => {
        if (!current.userTouched) {
          return { targets: [...nextActiveProviders], defaultsInitialized: true, userTouched: false };
        }
        const nextTargets = Array.from(
          new Set(
            current.targets
              .map((provider) => (provider === settings.standbyProvider ? previousStandby : provider))
              .filter((provider) => nextActiveProviders.includes(provider)),
          ),
        );
        return { ...current, targets: nextTargets, defaultsInitialized: true };
      });
      pendingRestore.current.delete(settings.standbyProvider);
      pendingProviderResetRef.current.delete(settings.standbyProvider);
      setUserHidden((current) => {
        const next = new Set(current);
        next.delete(settings.standbyProvider);
        return next;
      });
      if (statesRef.current[settings.standbyProvider].webview !== 'none') {
        void host.provider.close(settings.standbyProvider).catch(() => undefined);
      }
    }
    settingsRef.current = settings;
    presentationRef.current = settings.presentation;
    setAppSettings(settings);
    setLanguage(settings.language);
    setFocusPaneWidth(settings.focusPaneWidth);
    setPresentation(settings.presentation);
  };

  const selectSimpleAgent = useCallback((provider: AIProvider) => {
    if (isProcessing || !activeProviders.includes(provider)) return;
    setSessions((current) => {
      const existing = current.find((session) => session.id === activeSessionId);
      if (!existing || existing.singleProvider === provider) return current;
      return persistConversationSessions(upsertConversationSession(current, {
        ...existing, mode: 'free', presetId: 'simple', singleProvider: provider, updatedAt: Date.now(),
      }));
    });
  }, [activeProviders, activeSessionId, isProcessing]);

  const selectPreset = useCallback(
    (nextPresetId: WorkflowPresetId) => {
      if (isProcessing) return;
      const nextPreset = presetForId(nextPresetId);
      setMode(nextPreset.graphId);
      setPresetId(nextPreset.id);
      if (nextPreset.id === 'brainstorm') {
        setTargetSelection({ targets: [...activeProviders], defaultsInitialized: true, userTouched: false });
      }
    },
    [activeProviders, isProcessing],
  );

  const persistReplaySnapshot = useCallback((snapshot: ExecutionSnapshot) => {
    const snapshotSettings = settingsRef.current;
    return persistSnapshotIfEnabled(snapshot, {
      enabled: snapshotSettings.snapshotPersistence,
      tier: snapshotSettings.snapshotRedactionTier,
    });
  }, []);

  const prepareReplayTrace = useCallback((plan: ReplayPlan) => {
    const replayMode = modeFromReplayPlan(plan);
    if (!replayMode) return;
    const replayTargets = replayMode === 'free' ? plan.targets ?? [] : [];
    const replayPreset = plan.graph?.id === 'brainstorm' ? 'brainstorm' : undefined;
    setProcessTrace(createProcessTrace(replayMode, replayTargets, localeRef.current, replayPreset));
    setIsProcessing(processingAfterSend());
    recordEventLog(eventFromWorkflowStart(replayMode, plan.question?.length ?? 0, replayTargets.length || undefined));
  }, []);

  const settleReplayTrace = useCallback(() => {
    setManualFocusLock(undefined);
    setStepTimeout(undefined);
    setIsProcessing(processingAfterSettle());
  }, [setManualFocusLock]);

  const layoutWidth = gridRef.current?.getBoundingClientRect().width ?? (typeof window === 'undefined' ? 1280 : window.innerWidth);
  const focusPaneMaxWidth = Math.max(
    DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.minFocusPaneWidth,
    layoutWidth - DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.minCenterWidth - DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.resizerWidth,
  );
  const modeBlockedMessage = modeSendBlocked
    ? formatI18n(translate('input.modeNotReady'), { remaining: missingModeProviderCount })
    : undefined;

  const simpleAgentChooser = presetId === 'simple' ? (
    <div className="workbench-simple-agent flex flex-wrap items-center justify-center gap-2.5">
      <label htmlFor="workbench-simple-agent-select" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {translate('preset.simple.agentLabel')}
      </label>
      <select id="workbench-simple-agent-select" className="workbench-simple-agent-select rounded-xl border px-3 py-2 text-xs font-semibold"
        value={simpleAgent ?? ''} disabled={isProcessing} aria-label={translate('preset.simple.agentLabel')}
        onChange={(event) => selectSimpleAgent(event.target.value as AIProvider)}>
        {!simpleAgent ? <option value="">{translate('preset.simple.noAgent')}</option> : null}
        {simpleAgent && !simpleTargets.length
          ? <option value={simpleAgent}>{AI_PROVIDERS[simpleAgent].name} · {translate('connection.notReady')}</option>
          : null}
        {activeProviders.filter((provider) => isSendable(states[provider])).map((provider) => (
          <option key={provider} value={provider}>{AI_PROVIDERS[provider].name}</option>
        ))}
      </select>
      <span className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
        {translate('preset.simple.oneAgentNote')}
      </span>
    </div>
  ) : null;
  const composer = (
    <InputBar
      onSend={send}
      onCancel={cancelWorkflow}
      disabled={noSendableProviders}
      sendBlocked={modeSendBlocked}
      blockedMessage={modeBlockedMessage}
      isProcessing={isProcessing}
      locale={locale}
    />
  );
  const newChatWelcome = messages.length === 0 && !isProcessing;
  return (
    <main className="app-shell workbench-shell h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div
        ref={gridRef}
        className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)]"
        style={{ gridTemplateColumns: messagesMaximized
          ? '0px 0px minmax(0,1fr)'
          : providerInspectorOpen
            ? focusGridTemplateColumns(focusPaneWidth)
            : `${sessionSidebarCollapsed ? '60px' : '208px'} 0px minmax(0,1fr)` }}
      >
        <div
          aria-hidden={messagesMaximized || undefined}
          className={`ai-sister-left-shell workbench-left-shell flex min-h-0 min-w-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
            messagesMaximized ? 'invisible overflow-hidden pointer-events-none' : ''
          }`}
        >
          <ConversationSidebar
            collapsed={sessionSidebarCollapsed}
            sessions={sessions}
            projects={projectStore.projects}
            activeSessionId={activeSessionId}
            disabled={isProcessing || !projectsReady}
            locale={locale}
            labels={{
              toggle: translate('conversation.toggle'),
              newConversation: translate('conversation.new'),
              history: translate('conversation.history'),
              empty: translate('conversation.empty'),
              deleteConversation: translate('conversation.delete'),
              confirmDeleteConversation: translate('conversation.deleteConfirm'),
              projects: translate('sidebar.projects'),
              newProject: translate('sidebar.newProject'),
              projectName: translate('sidebar.projectName'),
              create: translate('sidebar.create'),
              cancel: translate('sidebar.cancel'),
              unassigned: translate('sidebar.unassigned'),
              moveTo: translate('sidebar.moveTo'),
              newInProject: translate('sidebar.newInProject'),
              expand: translate('sidebar.expand'),
              collapse: translate('sidebar.collapse'),
              projectSettings: translate('sidebar.projectSettings'),
            }}
            onToggle={() => setSessionSidebarCollapsed((current) => !current)}
            onNewConversation={startNewConversation}
            onSelectSession={selectConversationSession}
            onDeleteSession={deleteConversationSession}
            onAssignProject={assignConversationProject}
            onCreateProject={createSidebarProject}
            onOpenProjectSettings={() => setProjectSettingsOpen(true)}
          />
          {providerInspectorOpen && !messagesMaximized ? (
            <div className="workbench-inspector-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold">{translate('sidebar.agents')}</h2>
                <button type="button" className="rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
                  onClick={() => setProviderInspectorOpen(false)} aria-label={translate('workbench.hideDetails')}>{translate('workbench.hideDetails')}</button>
              </div>
              <FocusPane
              providers={activeProviders}
              centeredProvider={centeredProvider}
              scrollFocusedProvider={scrollFocusedProvider}
              states={states}
              presentation={presentation}
              centerSurface={centerSurface}
              centerText={centerText}
              centerTextFinal={centerTextFinal}
              userHidden={userHidden}
              presentationHidden={presentationHidden}
              setPaneRef={setPaneRef}
              setCenterStageRef={setCenterStageRef}
              changeProviderPresentation={changeProviderPresentationManually}
              onManualFocusControl={markManualFocusControl}
              onEnlargeCenter={enlargeCenter}
              onCollapseCenter={collapseCenter}
              onOpenLogin={openProviderLogin}
              syncBounds={syncBounds}
              onFocusScroll={handleFocusPaneScroll}
              reportProvider={reportProvider}
              reportBusy={reportBusy}
              processTrace={processTrace}
              onTraceDetailOpenChange={setProcessTraceDetailOpen}
              onChipClick={(provider) => {
                const container = transcriptRef.current;
                if (container) scrollTranscriptToProviderMessage(container, provider);
              }}
              stageExpanded={stageExpanded}
              onToggleStageExpanded={() => setStageExpanded((current) => !current)}
            />
            </div>
          ) : null}
        </div>

        <div className={`min-h-0 min-w-0 ${providerInspectorOpen && !messagesMaximized ? '' : 'invisible pointer-events-none'}`}>
          {providerInspectorOpen && !messagesMaximized ? (
            <Resizer
              label={translate('layout.resizeFocusPane')}
              onDrag={dragFocusPane}
              value={focusPaneWidth}
              min={DEFAULT_FOCUS_LAYOUT_CONSTRAINTS.minFocusPaneWidth}
              max={focusPaneMaxWidth}
            />
          ) : null}
        </div>

        <section className="ai-sister-conversation-workspace workbench-conversation-workspace relative flex min-h-0 min-w-0 flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
          <header className="ai-sister-conversation-toolbar workbench-conversation-header border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <div className="workbench-conversation-header-main flex flex-wrap items-center justify-between gap-3">
              <div className="workbench-conversation-identity min-w-0 flex-1">
                <div className="workbench-header-eyebrow">{translate('workbench.eyebrow')}</div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="workbench-conversation-title truncate text-xl font-semibold" title={sessions.find((session) => session.id === activeSessionId)?.title ?? translate('workbench.conversation')}>
                    {sessions.find((session) => session.id === activeSessionId)?.title ?? translate('workbench.conversation')}
                  </h1>
                  {isProcessing ? <span className="workbench-header-live flex items-center gap-1.5"><span className="workbench-live-indicator" aria-hidden="true" /> {translate('workbench.live')}</span> : null}
                </div>
              </div>
              <div className="workbench-header-actions flex flex-wrap items-center gap-1.5">
                <button type="button"
                  className={`workbench-icon-button ${replayDrawerOpen ? 'workbench-icon-button-selected' : ''}`}
                  aria-label={translate('replay.historyToggle')} title={translate('replay.historyToggle')}
                  aria-expanded={replayDrawerOpen} aria-controls="replay-history-panel"
                  onClick={() => setReplayDrawerOpen((open) => !open)}>
                  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" />
                  </svg>
                  <span className="workbench-action-label">{translate('replay.historyToggle')}</span>
                </button>
                <button type="button" className="workbench-icon-button"
                  onClick={() => void exportConversation()} disabled={messages.length === 0 || sharing}
                  aria-label={translate('header.exportMarkdown')} title={translate('header.exportMarkdown')}>
                  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 16v4h14v-4" />
                  </svg>
                  <span className="workbench-action-label">{translate('header.exportMarkdown')}</span>
                </button>
                <button type="button"
                  className={`workbench-icon-button ${messagesMaximized ? 'workbench-icon-button-selected' : ''}`}
                  aria-label={translate(messagesMaximized ? 'header.restoreMessages' : 'header.maximizeMessages')}
                  title={translate(messagesMaximized ? 'header.restoreMessages' : 'header.maximizeMessages')}
                  aria-pressed={messagesMaximized}
                  onClick={() => setMessagesMaximized((current) => !current)}>
                  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    {messagesMaximized ? <><path d="M9 3v6H3"/><path d="M15 21v-6h6"/><path d="M3 15h6v6"/><path d="M21 9h-6V3"/></>
                      : <><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></>}
                  </svg>
                </button>
                {import.meta.env.DEV ? (
                  <button type="button"
                    className={`workbench-icon-button ${showDevDiagnostics ? 'workbench-icon-button-selected' : ''}`}
                    onClick={() => setShowDevDiagnostics((current) => !current)}
                    aria-pressed={showDevDiagnostics} aria-controls="workbench-dev-diagnostics">Diagnostics</button>
                ) : null}
                <button type="button" className="workbench-icon-button" onClick={() => setSettingsOpen(true)}
                  title={translate('header.settings')} aria-label={translate('header.settings')}>
                  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .35 1.88l-1.9 1.9a1.7 1.7 0 0 0-1.88-.35l-1.15.48a1.7 1.7 0 0 0-1.06 1.57H10.3a1.7 1.7 0 0 0-1.06-1.57l-1.15-.48a1.7 1.7 0 0 0-1.88.35l-1.9-1.9A1.7 1.7 0 0 0 4.66 15l-.48-1.15a1.7 1.7 0 0 0-1.57-1.06V10.2a1.7 1.7 0 0 0 1.57-1.06L4.66 8a1.7 1.7 0 0 0-.35-1.88l1.9-1.9a1.7 1.7 0 0 0 1.88.35l1.15-.48A1.7 1.7 0 0 0 10.3 2.5h3.46a1.7 1.7 0 0 0 1.06 1.57l1.15.48a1.7 1.7 0 0 0 1.88-.35l1.9 1.9A1.7 1.7 0 0 0 19.4 8l.48 1.15a1.7 1.7 0 0 0 1.57 1.06v2.58a1.7 1.7 0 0 0-1.57 1.06z"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="workbench-conversation-header-sub flex flex-wrap items-center gap-2">
              <button type="button" disabled={isProcessing}
                onClick={() => setWorkflowOptionsOpen(true)}
                aria-haspopup="dialog" aria-expanded={workflowOptionsOpen}
                aria-controls="workbench-workflow-options"
                className="workbench-mode-select flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900">
                <span className="workbench-mode-select-icon" aria-hidden="true">{presetId === 'brainstorm' ? '✨' : CHAT_MODES[mode].icon}</span>
                {translate(presetForId(presetId).displayNameKey)}
                <span className="text-zinc-400" aria-hidden="true">⌄</span>
              </button>
              {!newChatWelcome ? simpleAgentChooser : null}
              <span className="workbench-header-separator" aria-hidden="true"/>
              <span className="workbench-conversation-status truncate text-xs text-zinc-500 dark:text-zinc-400">
                {workflowStatus || (isProcessing ? translate('processTrace.awaiting') : translate('processTrace.settled'))}
              </span>
            </div>
            <div className="workbench-connected-agent-strip mt-3 flex flex-wrap items-center gap-1.5" aria-label={translate('sidebar.agents')}>
              {activeProviders.filter((provider) => states[provider].login === 'logged_in').map((provider) => (
                <button key={provider} type="button" className="workbench-agent-pill inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"
                  onClick={() => openProviderModelSettings(provider)} title={AI_PROVIDERS[provider].name}>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true"/>
                  {AI_PROVIDERS[provider].name}
                </button>
              ))}
              <div className="relative">
                <button type="button" className="workbench-agent-add rounded-full border px-3 py-1.5 text-xs"
                  aria-haspopup="menu" aria-expanded={agentMenuOpen}
                  onClick={() => setAgentMenuOpen((open) => !open)}>+ {translate('sidebar.addAgent')}</button>
                {agentMenuOpen ? (
                  <div className="workbench-agent-menu absolute left-0 top-full z-30 mt-1 min-w-48 space-y-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" role="menu">
                    {activeProviders.filter((provider) => states[provider].login !== 'logged_in').map((provider) => (
                      <button key={provider} type="button" role="menuitem"
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => { setAgentMenuOpen(false); void openProviderLogin(provider).catch((error: unknown) => setProviderWindowError(error instanceof Error ? error.message : String(error))); }}>
                        <span>{AI_PROVIDERS[provider].name}</span>
                        <span className="text-zinc-500">{translate('sidebar.agentLogin')}</span>
                      </button>
                    ))}
                    <button type="button" role="menuitem" className="w-full rounded-lg border-t border-zinc-200 px-2 py-2 text-left text-xs dark:border-zinc-700"
                      onClick={() => { setAgentMenuOpen(false); setSettingsOpen(true); }}>{translate('header.settings')}</button>
                  </div>
                ) : null}
              </div>
              <button type="button" className={`workbench-agent-tools ml-auto rounded-full border px-3 py-1.5 text-xs ${providerInspectorOpen ? 'workbench-icon-button-selected' : ''}`}
                onClick={() => setProviderInspectorOpen((open) => !open)} aria-expanded={providerInspectorOpen}>
                {translate('workbench.providerView')}
              </button>
              <button type="button" className="workbench-activity-button rounded-full border px-3 py-1.5 text-xs"
                aria-expanded={activityPanelOpen} aria-controls="workbench-activity-drawer"
                onClick={() => setActivityPanelOpen((open) => !open)}>
                {translate('sidebar.activity')}
                {processTrace?.steps.some((step) => step.status === 'active') ? <span className="ml-1 h-1.5 w-1.5 rounded-full bg-sky-500 inline-block" aria-hidden="true"/> : null}
              </button>
            </div>
            {modelSettingsProvider && activeProviders.includes(modelSettingsProvider) ? (
              <div className="workbench-model-controls-popover mt-2">
                <ProviderModelControls provider={modelSettingsProvider} onOpenProvider={openProviderModelSettings}
                  onClose={() => setModelSettingsProvider(undefined)}/>
              </div>
            ) : null}
          </header>
          {checkpoint ? (
            <details className="workbench-checkpoint-inline mt-3 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950" open>
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-100">{translate('checkpoint.confirmEachStep')}</summary>
              <div className="border-t border-amber-300 p-3 dark:border-amber-900">
                <CheckpointCard checkpoint={checkpoint} draft={checkpointDraft}
                  onDraftChange={setCheckpointDraft}
                  onNativeEdit={(provider) => { void forceProviderNativeCenter(provider); }}
                  locale={locale}/>
              </div>
            </details>
          ) : null}
          {activityPanelOpen ? (
            <aside id="workbench-activity-drawer" aria-label={translate('sidebar.activity')} className="workbench-activity-drawer">
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-semibold">{translate('sidebar.activity')}</h2>
                <button type="button" className="rounded-lg px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => setActivityPanelOpen(false)} aria-label={translate('workbench.hideDetails')}>×</button>
              </div>
              <div className="workbench-activity-drawer-content min-h-0 flex-1 overflow-y-auto p-3">
                {processTrace && (processTrace.steps.length > 0 || processTrace.currentStatus)
                  ? <ProcessTrace trace={processTrace} locale={locale} expanded compact={false} states={states}
                      onViewProvider={viewWorkflowProvider} onDetailOpenChange={setProcessTraceDetailOpen}/>
                  : <p className="p-3 text-xs text-zinc-500 dark:text-zinc-400">{translate('workbench.noActiveRun')}</p>}
              </div>
            </aside>
          ) : null}
          {providerWindowGeometry && import.meta.env.DEV && showDevDiagnostics ? (
            <div role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <span className="font-semibold">Native page geometry</span>
              <span>Window {providerWindowGeometry.windowWidth} × {providerWindowGeometry.windowHeight} physical px</span>
              <span>WebView {providerWindowGeometry.webviewWidth} × {providerWindowGeometry.webviewHeight} physical px</span>
              <span>Position {providerWindowGeometry.webviewX},{providerWindowGeometry.webviewY}</span>
              <button type="button" className="ml-auto rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={() => setProviderWindowGeometry(undefined)}>
                Hide
              </button>
            </div>
          ) : null}
          {providerWindowError ? (
            <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <span>Could not open the separate provider window: {providerWindowError}</span>
              <button type="button" onClick={() => setProviderWindowError(undefined)} className="rounded border border-current px-2 py-1">Dismiss</button>
            </div>
          ) : null}
          <div
            id="replay-history-panel"
            hidden={!replayDrawerOpen}
            className="mt-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 pb-3"
          >
            <ReplayPanel
              ref={replayPanelRef}
              locale={locale}
              responseLanguagePolicy={createResponseLanguagePolicy(appSettings.responseLanguage, locale)}
              activeProviders={activeProviders}
              onReplayWillRun={prepareReplayTrace}
              onReplaySettled={settleReplayTrace}
              onSnapshotComplete={persistReplaySnapshot}
              onOpenLogin={openProviderLogin}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
          {sessionCheckpointNotice ? (
            <SessionCheckpointNotice
              notice={sessionCheckpointNotice}
              replaying={sessionCheckpointReplayBusy}
              onDismiss={dismissStartupSessionCheckpoint}
              onReplay={sessionCheckpointNotice.replaySnapshot ? replayStartupSessionCheckpoint : undefined}
              locale={locale}
            />
          ) : null}
          {shareNotice ? (
            <div
              role={shareNotice.kind === 'error' ? 'alert' : 'status'}
              className={
                shareNotice.kind === 'error'
                  ? 'mt-3 border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200'
                  : 'mt-3 border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200'
              }
            >
              {shareNotice.text}
            </div>
          ) : null}
          {adapterNotice ? (
            <div role={adapterNotice.kind.endsWith('failed') ? 'alert' : 'status'} className={`mt-3 border px-3 py-2 text-xs ${adapterNoticeClass(adapterNotice.kind)}`}>
              {adapterNoticeText(adapterNotice)}
            </div>
          ) : null}
          <div
            ref={transcriptRef}
            className={`ai-sister-conversation-transcript workbench-reading-area mt-3 min-h-0 flex-1 overflow-auto border-y border-zinc-200 dark:border-zinc-800 py-4 ${activityPanelOpen ? 'workbench-reading-with-activity' : ''}`}
            onScroll={(event) => {
              transcriptStickToEndRef.current = isTranscriptNearEnd(event.currentTarget);
              handleTranscriptScroll();
            }}
          >
            {newChatWelcome ? (
              <div className="workbench-new-chat-screen flex min-h-full flex-col items-center justify-center px-3 py-6">
                <div className="workbench-new-chat-body mx-auto w-full max-w-2xl">
                  <h2 className="workbench-new-chat-title text-center text-2xl font-semibold tracking-tight">
                    {translate('sidebar.emptyTitle')}
                  </h2>
                  <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">{translate('sidebar.emptySubtitle')}</p>
                  <div className="workbench-new-chat-workflows mt-8 flex flex-wrap justify-center gap-2" aria-label={translate('sidebar.workflowChoice')}>
                    {PRESET_CATALOG.map((preset) => (
                      <button key={preset.id} type="button" disabled={isProcessing}
                        className={`workbench-new-chat-workflow rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${presetId === preset.id ? 'workbench-new-chat-workflow-selected' : ''}`}
                        aria-pressed={presetId === preset.id} title={translate(preset.descriptionKey)}
                        onClick={() => selectPreset(preset.id)}>
                        {preset.graphId === 'free' && preset.id !== 'brainstorm' ? '✦ ' : ''}
                        {translate(preset.displayNameKey)}
                      </button>
                    ))}
                  </div>
                  {simpleAgentChooser ? <div className="mt-5">{simpleAgentChooser}</div> : null}
                  <div className="workbench-new-chat-project mx-auto mt-5 flex max-w-xl items-center justify-center gap-2">
                    <label className="sr-only" htmlFor="workbench-new-chat-project">{translate('sidebar.chooseProject')}</label>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{translate('sidebar.chooseProject')}</span>
                    <select id="workbench-new-chat-project" className="max-w-52 rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-xs dark:border-zinc-700"
                      value={effectiveProjectStore.activeProjectId ?? ''}
                      onChange={(event) => {
                        const session = sessions.find((item) => item.id === activeSessionId);
                        if (session) assignConversationProject(session, event.target.value || undefined);
                      }}>
                      <option value="">{translate('sidebar.general')}</option>
                      {projectStore.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                    <button type="button" className="rounded-lg px-2 py-1.5 text-xs text-sky-700 hover:bg-zinc-100 dark:text-sky-300 dark:hover:bg-zinc-800"
                      onClick={() => setProjectSettingsOpen(true)}>+ {translate('sidebar.newProject')}</button>
                  </div>
                  <div className="workbench-new-chat-composer mt-4">{composer}</div>
                </div>
              </div>
            ) : (
              <ChatArea messages={messages} locale={locale} states={states} trace={isProcessing ? processTrace : undefined} />
            )}
          </div>
          {import.meta.env.DEV && showDevDiagnostics ? (
            <section
              id="workbench-dev-diagnostics"
              aria-label="Developer transport diagnostics"
              className="mt-2 max-h-60 shrink-0 overflow-auto rounded-lg border border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium">Developer transport diagnostics</h3>
                <button type="button" className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700" onClick={() => setShowDevDiagnostics(false)}>
                  Hide
                </button>
              </div>
              <EchoPanel />
            </section>
          ) : null}
          <div className={`ai-sister-conversation-composer workbench-composer-region shrink-0 border-t border-zinc-200 pt-2 dark:border-zinc-800 ${newChatWelcome ? 'hidden' : ''}`}>
            {!newChatWelcome ? composer : null}
          </div>
        </section>
      </div>
      {projectSettingsOpen ? (
        <ModalDialog titleId="workbench-project-editor-title" onEscape={() => setProjectSettingsOpen(false)}
          onBackdrop={() => setProjectSettingsOpen(false)}
          panelClassName="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="workbench-project-editor-title" className="text-lg font-semibold">{translate('sidebar.projectSettings')}</h2>
            <button type="button" className="rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
              onClick={() => setProjectSettingsOpen(false)}>{translate('sidebar.cancel')}</button>
          </div>
          <ProjectPicker store={effectiveProjectStore} onSave={saveProjectStore}
            disabled={isProcessing || !projectsReady} loadError={projectLoadError}/>
        </ModalDialog>
      ) : null}
      {workflowOptionsOpen ? (
        <ModalDialog titleId="workbench-mode-title" descriptionId="workbench-mode-description"
          onEscape={() => setWorkflowOptionsOpen(false)}
          onBackdrop={() => setWorkflowOptionsOpen(false)}
          panelClassName="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
        >
          <div id="workbench-workflow-options" className="flex items-start justify-between gap-4">
            <div>
              <h2 id="workbench-mode-title" className="text-xl font-semibold">Choose a workflow</h2>
              <p id="workbench-mode-description" className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Compare, review, research, and collaborate with your connected models.
              </p>
            </div>
            <button type="button" className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700" onClick={() => setWorkflowOptionsOpen(false)}>Close</button>
          </div>
          <div className="mt-5">
            <PresetCatalog mode={mode} selectedPresetId={presetId}
              onSelectPreset={(selected) => {
                selectPreset(selected);
                setWorkflowOptionsOpen(false);
              }}
              locale={locale} states={states} modeRoles={appSettings.modeRoles}
              activeProviders={activeProviders} disabled={isProcessing} layout="dialog"
            />
          </div>
          {mode === 'free' && presetId !== 'brainstorm' ? (
            <div className="mt-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <h3 className="mb-2 text-sm font-semibold">{translate('input.sendSelectedProviders')}</h3>
              <TargetChips providers={activeProviders} states={states} selected={targets} onChange={handleTargetsChange} disabled={isProcessing} locale={locale}/>
            </div>
          ) : null}
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Connection status and response completion are separate.</p>
        </ModalDialog>
      ) : null}
      {preflight ? (
        <PreflightDialog
          model={buildPreflightDialogModel(preflight.mode, preflight.result, states, locale)}
          hidden={preflightLoginPending}
          activeProviders={activeProviders}
          onOpenLogin={openPreflightLogin}
          onOpenSettings={() => {
            setPreflight(undefined);
            setSettingsOpen(true);
          }}
          onClose={() => setPreflight(undefined)}
          onSwitchMode={() => {
            setMode('free');
            setPresetId('free');
            setPreflight(undefined);
          }}
          locale={locale}
        />
      ) : null}
      {stepTimeout?.timedOut ? <StepTimeoutDialog event={stepTimeout} onClose={() => setStepTimeout(undefined)} locale={locale} /> : null}
      <SettingsModal
        open={settingsOpen}
        openProviders={openProviders}
        focusPaneWidth={focusPaneWidth}
        presentation={presentation}
        providerStates={states}
        providerSelectionDisabled={isProcessing}
        activeModeRoleSettings={presetId === 'brainstorm' ? 'roundtable' : mode === 'free' ? undefined : mode}
        onClose={() => setSettingsOpen(false)}
        onSaved={applySavedSettings}
      />
      {reportPreview ? (
        <ReportPreviewDialog
          preview={reportPreview}
          busy={reportBusy}
          onOpenIssue={openReportIssue}
          onCancel={() => setReportPreview(null)}
          locale={locale}
        />
      ) : null}
    </main>
  );
}

function adapterNoticeClass(kind: string): string {
  if (kind === 'updated' || kind === 'downgraded') return 'border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200';
  if (kind === 'report-failed') return 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200';
  if (kind.endsWith('-failed')) return 'border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200';
  return 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200';
}

function adapterNoticeText(notice: AdapterNotice): string {
  const provider = notice.provider in AI_PROVIDERS ? AI_PROVIDERS[notice.provider as AIProvider].name : notice.provider;
  if (notice.kind === 'updated' || notice.kind === 'downgraded') {
    const version = notice.version != null ? ` to v${notice.version}` : '';
    return `${provider} adapter ${notice.kind}${version}.`;
  }
  return `${provider}: ${notice.message || notice.kind}`;
}

export function ChatArea({
  messages,
  locale,
  states,
  trace,
}: {
  messages: Bubble[];
  locale: Locale;
  states: Record<AIProvider, ProviderState>;
  trace?: ProcessTraceState;
}) {
  const activeSteps = trace?.steps.filter((step) => step.status === 'active' && step.kind !== 'fanout') ?? [];
  const activeProviders = new Set(activeSteps.map((step) => step.provider).filter((provider): provider is AIProvider => provider !== undefined));
  if (messages.length === 0) {
    const providers = Object.values(states);
    const anyReady = providers.some((state) => isSendable(state));
    const anyChecking = providers.some((state) =>
      (state.webview === 'loaded' || state.webview === 'creating') &&
      (state.login === 'unknown' || state.dom === 'unknown'),
    );
    return (
      <div className="grid min-h-32 place-items-center p-6 text-center" role="status">
        <div>
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{translateKey('chat.noMessages', locale)}</div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {translateKey(anyReady ? 'chat.readyPrompt' : anyChecking ? 'chat.reconnecting' : 'chat.noProviders', locale)}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 p-2">
      {messages.map((message) => {
        const p = message.provider;
        // While this provider is still working, the decorative waiting scene
        // replaces its redundant in-flight transcript placeholder.
        if (message.role === 'ai' && !message.final && p && activeProviders.has(p as AIProvider)) return null;
        const isProvider = typeof p === 'string' && p in AI_PROVIDERS;
        const thinking = isProvider && !message.final && states[p as AIProvider]?.thinking === true;
        const statusLabel =
          message.role === 'ai' && !message.final ? translateKey(thinking ? 'chat.thinking' : 'chat.streaming', locale) : '';

        return (
          <article
            key={message.id}
            className={`ai-sister-message workbench-message ${message.role === 'user' ? 'workbench-message-user' : 'workbench-message-other'} border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3`}
            data-provider={isProvider ? p : undefined}
          >
            <div className="workbench-message-header mb-1 flex items-center gap-2">
              {isProvider ? <AiSisterAvatar provider={p as AIProvider} active={thinking} size="md" /> : null}
              <div className="text-xs uppercase text-zinc-500 dark:text-zinc-500">
                {bubbleAuthorLabel(message)}
                {message.modeRole ? ` · ${message.modeRole}` : ''}
                {statusLabel ? ` ${statusLabel}` : ''}
              </div>
            </div>
            {thinking ? (
              <div className="whitespace-pre-wrap text-sm italic text-zinc-500 dark:text-zinc-500">{translateKey('chat.thinking', locale)}</div>
            ) : (
              <div className="workbench-message-content text-sm">
                <MarkdownText text={message.content} />
              </div>
            )}
            {message.truncated ? <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{translateKey('chat.truncated', locale)}</div> : null}
          </article>
        );
      })}
      {activeSteps.length > 0 ? (
        <ThinkingVisualization activeSteps={activeSteps} states={states} locale={locale} />
      ) : null}
    </div>
  );
}

function modeFromReplayPlan(plan: ReplayPlan): ChatMode | undefined {
  const candidate = plan.graph?.mode ?? plan.graph?.id;
  return typeof candidate === 'string' && candidate in CHAT_MODES ? (candidate as ChatMode) : undefined;
}

function conversationPresetId(presetId: WorkflowPresetId, mode: ChatMode): WorkflowPresetId | undefined {
  return mode === 'free' && (presetId === 'brainstorm' || presetId === 'simple') ? presetId : undefined;
}
