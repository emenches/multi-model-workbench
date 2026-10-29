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
import { EMPTY_PROJECT_STORE, mergeProjectContext, type ProjectStore } from './workspace/model';
import { useI18n } from './i18n/context';
import type { Locale } from './i18n/resolve';
import { formatI18n, t as translateKey } from './i18n/t';
import { mergePullBridgeState, type PullBridgeState } from './appBridgeState';
import { onCheckpoint, type PendingCheckpoint } from './workflow/checkpoint';
import { isSendable, onStepTimeoutEvent, runWorkflow } from './workflow';
import { ConversationDirectRuntime } from './workflow/conversationDirectRuntime';
import type { ConversationJobSnapshot } from './workflow/conversationScheduler';
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
import { ConversationSidebar } from './ui/ConversationSidebar';
import {
  beginNewConversationSession,
  createConversationSession,
  removeConversationSession,
  sessionContentChanged,
  titleFromFirstUserMessage,
  upsertConversationSession,
  type ConversationSession,
} from './ui/conversationSessions';
import {
  bubblesFromSession,
  conversationMessages,
  initialConversationState,
  persistConversationSessions,
  type Bubble,
} from './ui/conversationPersistence';
import {
  buildConversationReplayContext,
  questionWithConversationContext,
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
import { loadLastUsedPreset, saveLastUsedPreset } from './ui/lastUsedPresetPreference';
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, loadSidebarWidth, saveSidebarWidth } from './ui/sidebarWidthPreference';
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
import { activityPanelAfterSend, activityPanelForSession } from './ui/activityPanelVisibility';
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

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];

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

// Keep previously-open agents visible while their native sessions are verified.
// Sidebar-free restoration needs a native stage only for a visibly centered page.
export function canRestoreWithoutInspectorPane(presentation: WebviewPresentationState, surface: 'text' | 'native', hasCenterStage: boolean): boolean {
  return presentation !== 'center' || surface !== 'native' || hasCenterStage;
}

export function agentHeaderStatus(state: ProviderState, wasOpen: boolean, restoring: boolean): 'ready' | 'checking' | 'open' | null {
  if (state.login === 'logged_out' || state.login === 'blocked') return null;
  if (isSendable(state)) return 'ready';
  if (state.webview === 'creating' || state.webview === 'loaded' || state.login === 'logged_in') return 'checking';
  if (wasOpen) return restoring ? 'checking' : 'open';
  return null;
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
  // Reading history while a workflow runs never changes the workflow's owning session.
  const [readingSessionId, setReadingSessionId] = useState<string>();
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(loadSessionSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [messages, setMessages] = useState<Bubble[]>(() => bubblesFromSession(initialConversation.active));
  const [workflowStatus, setWorkflowStatus] = useState('');
  const [mode, setMode] = useState<ChatMode>(initialConversation.active.mode);
  const [presetId, setPresetId] = useState<WorkflowPresetId>(
    initialConversation.active.presetId
      ?? (initialConversation.active.mode === 'free' && initialConversation.active.messages.length === 0
        ? 'simple'
        : initialConversation.active.mode),
  );
  // The top-level mode switch doesn't discard the user's multi-agent workflow.
  const lastUsedPresetRef = useRef<WorkflowPresetId>(
    loadLastUsedPreset(initialConversation.active.presetId ?? initialConversation.active.mode),
  );
  const lastMultiPresetRef = useRef<WorkflowPresetId>(
    lastUsedPresetRef.current !== 'simple'
      ? lastUsedPresetRef.current
      : initialConversation.active.presetId && initialConversation.active.presetId !== 'simple'
        ? initialConversation.active.presetId
        : initialConversation.active.mode !== 'free' ? initialConversation.active.mode : 'consult',
  );
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
  // WORKFLOW_STATUS can briefly clear before runWorkflow resolves. Keep a
  // separate owner lock so history previews cannot steal in-flight results.
  const [runningSessionId, setRunningSessionId] = useState<string>();
  const [directRuns, setDirectRuns] = useState<Record<string, ConversationJobSnapshot>>({});
  const directRuntimeRef = useRef<ConversationDirectRuntime>();
  // Each native provider belongs to one execution path at a time. The legacy
  // workflow still runs as a singleton; do not start it while direct runs exist.
  const directOwnedSessionIdsRef = useRef(new Set<string>());
  const directTouchedProvidersRef = useRef(new Set<AIProvider>());
  const legacyRunActiveRef = useRef(false);
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
  const workflowBusy = isProcessing || runningSessionId !== undefined;
  const readingSession = workflowBusy && readingSessionId && readingSessionId !== activeSessionId
    ? sessions.find((session) => session.id === readingSessionId)
    : undefined;
  const directJobs = Object.values(directRuns);
  const activeDirectJob = [...directJobs].reverse().find((job) => job.sessionId === activeSessionId);
  const activeDirectBusy = activeDirectJob?.status === 'running' || activeDirectJob?.status === 'queued';
  const anyDirectBusy = directJobs.some((job) => job.status === 'running' || job.status === 'queued');
  const directView = directOwnedSessionIdsRef.current.has(activeSessionId) && !workflowBusy;
  const savedActiveSession = sessions.find((session) => session.id === activeSessionId);
  const visibleMessages = directView && savedActiveSession ? bubblesFromSession(savedActiveSession) : messages;
  const sidebarRunStatuses: Record<string, ConversationJobSnapshot['status']> = {};
  for (const job of directJobs) sidebarRunStatuses[job.sessionId] = job.status;
  if (runningSessionId) sidebarRunStatuses[runningSessionId] = 'running';
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
  const [activityPanelOpen, setActivityPanelOpen] = useState(() => activityPanelForSession());
  // A restored conversation may contain history but no new Activity in this view.
  const sentInSelectedSessionRef = useRef(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
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
  const restoringProviders = useRef<Set<AIProvider>>(new Set());
  const dragStartFocusPaneWidth = useRef(defaultSettings().focusPaneWidth);
  const dragStartSidebarWidth = useRef(DEFAULT_SIDEBAR_WIDTH);
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
  const simpleAgent = savedSimpleAgent
    ?? activeProviders.find((provider) => isSendable(states[provider]))
    ?? activeProviders.find((provider) => appSettings.openProviders.includes(provider)
      && states[provider].login !== 'logged_out' && states[provider].login !== 'blocked');
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
  const connectionsChecking = !settingsLoaded || !connectionSnapshotLoaded || !initialRestoreComplete
    || activeProviders.some((provider) => states[provider].webview === 'creating'
      || (states[provider].webview === 'loaded' && states[provider].login === 'unknown'));
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
    const runtime = new ConversationDirectRuntime({
      update: (reducer) => {
        setSessions((current) => persistConversationSessions(reducer(current)));
      },
    });
    directRuntimeRef.current = runtime;
    const unsubscribe = runtime.coordinator.subscribe((snapshot) => {
      setDirectRuns((current) => ({ ...current, [snapshot.id]: snapshot }));
    });
    return () => {
      unsubscribe();
      runtime.coordinator.scheduler.snapshots().forEach((job) => {
        if (job.status === 'running' || job.status === 'queued') runtime.cancel(job.id);
      });
      runtime.dispose();
      if (directRuntimeRef.current === runtime) directRuntimeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    userHiddenRef.current = userHidden;
  }, [userHidden]);

  useEffect(() => {
    settingsRef.current = appSettings;
  }, [appSettings]);

  useEffect(() => {
    // Dark is the only supported UI theme; the HTML root already starts dark.
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('ai-sister');
  }, []);

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
        // A direct run writes directly to its owning saved conversation. Never
        // overwrite streaming replies with the selected view's stale React state.
        if (directOwnedSessionIdsRef.current.has(activeSessionId) && !legacyRunActiveRef.current) return current;
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
        // Saved native pages must restore without a mounted inspector (including
        // pages formerly displayed as chips). Never auto-open the standby model.
        pendingRestore.current = new Set(loaded.openProviders.filter((provider) =>
          activeProvidersForStandby(loaded.standbyProvider).includes(provider),
        ));
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
      // Background direct runs own provider messages via the run router. The
      // legacy listener must not append their response to the viewed chat,
      // including late native DONE events after a run has just settled.
      if (!legacyRunActiveRef.current && directTouchedProvidersRef.current.has(message.provider)) return;
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
            timestamp: Date.now(),
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
      if (target === 'chip' || target === 'side') {
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

  const beginSavedProviderRestore = useCallback((provider: AIProvider) => {
    if (!pendingRestore.current.has(provider) || restoringProviders.current.has(provider)) return;
    pendingRestore.current.delete(provider);
    restoringProviders.current.add(provider);
    void restoreProvider(provider).catch(() => {
      // A failed restore stays not-sendable; its header pill offers a manual Open.
    }).finally(() => {
      restoringProviders.current.delete(provider);
      if (pendingRestore.current.size === 0 && restoringProviders.current.size === 0) {
        setInitialRestoreComplete(true);
      }
    });
  }, [restoreProvider]);

  const setPaneRef = useCallback(
    (provider: AIProvider, el: HTMLElement | null) => {
      paneRefs.current[provider] = el;
      if (!el) return;
      void syncBounds(provider);
      beginSavedProviderRestore(provider);
    },
    [beginSavedProviderRestore, syncBounds],
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
      beginSavedProviderRestore(provider);
    },
    [beginSavedProviderRestore, syncBounds],
  );

  useEffect(() => {
    if (!settingsLoaded || initialRestoreComplete) return;
    for (const provider of Array.from(pendingRestore.current)) {
      // Invisible native pages have no React pane to wait for.
      if (!canRestoreWithoutInspectorPane(presentation[provider], centerSurfaceRef.current, Boolean(centerStageRef.current))) continue;
      beginSavedProviderRestore(provider);
    }
    if (pendingRestore.current.size === 0 && restoringProviders.current.size === 0) {
      setInitialRestoreComplete(true);
    }
  }, [beginSavedProviderRestore, centeredProvider, initialRestoreComplete, presentation, settingsLoaded]);

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
    const latestMessage = visibleMessages[visibleMessages.length - 1];
    const userSentMessage =
      latestMessage?.role === 'user' && transcriptLastMessageIdRef.current !== latestMessage.id;
    transcriptSessionRef.current = activeSessionId;
    transcriptLastMessageIdRef.current = latestMessage?.id;
    if (sessionChanged || userSentMessage) transcriptStickToEndRef.current = true;
    if (transcriptStickToEndRef.current) scrollTranscriptToEnd(container);
  }, [activeSessionId, visibleMessages]);

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
        ? simpleChatTargets(simpleAgent && activeProviders.includes(simpleAgent) ? simpleAgent : undefined, statesRef.current)
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
      // History alone is not new Activity. Reveal the panel when this
      // selected conversation receives its first newly accepted prompt.
      const previouslySent = sentInSelectedSessionRef.current;
      sentInSelectedSessionRef.current = true;
      setActivityPanelOpen((open) => activityPanelAfterSend(open, previouslySent));
      setMessages((current) => [
        ...current,
        { id: createConversationMessageId('user'), role: 'user', content: trimmed, timestamp: Date.now(), final: true },
      ]);
      legacyRunActiveRef.current = true;
      directOwnedSessionIdsRef.current.delete(activeSessionId);
      setRunningSessionId(activeSessionId);
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
      legacyRunActiveRef.current = false;
      setRunningSessionId(undefined);
      releaseWorkflowExecution();
    }
  };

  const send = async (trimmed: string): Promise<boolean> => {
    if (!trimmed) return false;
    // Record the implicit initial agent as soon as this conversation is sent.
    // Otherwise a restarted Simple Chat could silently choose a different
    // model if login/availability ordering changes.
    if (presetId === 'simple' && simpleAgent && !savedSimpleAgent) {
      setSessions((current) => {
        const existing = current.find((session) => session.id === activeSessionId);
        if (!existing || existing.singleProvider) return current;
        return persistConversationSessions(upsertConversationSession(current, {
          ...existing, mode: 'free', presetId: 'simple', singleProvider: simpleAgent,
          updatedAt: Date.now(),
        }));
      });
    }
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
        ? simpleChatTargets(simpleAgent && activeProviders.includes(simpleAgent) ? simpleAgent : undefined, statesRef.current)
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
        ? simpleChatTargets(simpleAgent && activeProviders.includes(simpleAgent) ? simpleAgent : undefined, statesRef.current)
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
    if (workflowBusy) return;
    const now = Date.now();
    const transition = beginNewConversationSession({
      sessions,
      activeSessionId,
      messages: conversationMessages(messages),
      mode,
      presetId: conversationPresetId(presetId, mode),
      projectId,
      newMode: presetForId(lastUsedPresetRef.current).graphId,
      newPresetId: lastUsedPresetRef.current,
      now,
    });
    setSessions(persistConversationSessions(transition.sessions));
    setActiveSessionId(transition.active.id);
    setReadingSessionId(undefined);
    replayContextSessionRef.current = undefined;
    setMessages([]);
    sentInSelectedSessionRef.current = false;
    setActivityPanelOpen(false);
    setMode(transition.active.mode);
    setPresetId(transition.active.presetId ?? transition.active.mode);
    if (lastUsedPresetRef.current !== 'simple') lastMultiPresetRef.current = lastUsedPresetRef.current;
    setWorkflowStatus('');
    setProcessTrace(undefined);
    setReplayDrawerOpen(false);
    setTargetSelection({ targets: [...activeProviders], defaultsInitialized: true, userTouched: false });
    activeResponses.current.clear();
    pendingProviderResetRef.current = new Set(
      activeProviders.filter((provider) => statesRef.current[provider].webview === 'loaded'),
    );
  }, [activeProviders, activeSessionId, workflowBusy, messages, mode, presetId, sessions]);

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
      if (workflowBusy) {
        // Preview a saved transcript without changing the active session,
        // execution context, response routing, provider windows, or reset flags.
        setReadingSessionId(session.id === activeSessionId ? undefined : session.id);
        return;
      }
      setReadingSessionId(undefined);
      if (session.id === activeSessionId) return;
      // Flush the just-completed conversation before switching: its debounced
      // autosave may not have fired yet when a workflow settles.
      const storedMessages = conversationMessages(messages);
      const storedPresetId = conversationPresetId(presetId, mode);
      setSessions((current) => {
        const existing = current.find((item) => item.id === activeSessionId);
        if (!existing || !sessionContentChanged(existing, storedMessages, mode, storedPresetId)) return current;
        return persistConversationSessions(upsertConversationSession(current, {
          ...existing, title: titleFromFirstUserMessage(storedMessages), updatedAt: Date.now(),
          mode, presetId: storedPresetId, messages: storedMessages,
        }));
      });
      setActiveSessionId(session.id);
      replayContextSessionRef.current = session.messages.length > 0 ? session.id : undefined;
      setMessages(bubblesFromSession(session));
      sentInSelectedSessionRef.current = false;
      setActivityPanelOpen(activityPanelForSession());
      setMode(session.mode);
      setPresetId(session.presetId ?? session.mode);
      setWorkflowStatus('');
      setProcessTrace(undefined);
      setReplayDrawerOpen(false);
      setTargetSelection({ targets: [...activeProviders], defaultsInitialized: true, userTouched: false });
      activeResponses.current.clear();
      // The next SEND makes fresh native provider sessions; browsing history
      // does not touch the currently running remote conversation.
      pendingProviderResetRef.current = new Set(
        activeProviders.filter((provider) => statesRef.current[provider].webview === 'loaded'),
      );
    },
    [activeProviders, activeSessionId, workflowBusy, messages, mode, presetId],
  );

  useEffect(() => {
    // Once the background workflow settles, promote the read-only preview to
    // an ordinary selected conversation. Until then, its session is untouched.
    if (workflowBusy || !readingSessionId) return;
    const session = sessions.find((item) => item.id === readingSessionId);
    if (session) selectConversationSession(session);
    else setReadingSessionId(undefined);
  }, [workflowBusy, readingSessionId, sessions, selectConversationSession]);

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

  const dragSidebar = (deltaX: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      dragStartSidebarWidth.current = sidebarWidth;
      return;
    }
    const containerWidth = gridRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, containerWidth - 520));
    const nextWidth = clampSidebarWidth(Math.min(maxWidth, dragStartSidebarWidth.current + deltaX));
    setSidebarWidth(nextWidth);
    if (phase === 'end') saveSidebarWidth(nextWidth);
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
      lastUsedPresetRef.current = nextPreset.id;
      saveLastUsedPreset(nextPreset.id);
      if (nextPreset.id !== 'simple') lastMultiPresetRef.current = nextPreset.id;
      if (nextPreset.id === 'brainstorm') {
        setTargetSelection({ targets: [...activeProviders], defaultsInitialized: true, userTouched: false });
      }
    },
    [activeProviders, isProcessing],
  );

  const selectExperience = useCallback((next: 'chat' | 'multi') => {
    if (isProcessing) return;
    selectPreset(next === 'chat' ? 'simple' : lastMultiPresetRef.current);
  }, [isProcessing, selectPreset]);

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
  const sidebarMaxWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, layoutWidth - 520));
  const visibleSidebarWidth = Math.min(sidebarWidth, sidebarMaxWidth);
  const effectiveFocusWidth = clampFocusPaneWidth(
    Math.max(focusPaneWidth, sessionSidebarCollapsed ? 420 : visibleSidebarWidth + 180),
    layoutWidth,
  );
  const modeBlockedMessage = modeSendBlocked
    ? formatI18n(translate('input.modeNotReady'), { remaining: missingModeProviderCount })
    : undefined;

  const simpleAgentChooser = presetId === 'simple' ? (
    <div className="workbench-simple-agent flex flex-wrap items-center gap-2.5">
      <label htmlFor="workbench-simple-agent-select" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {translate('preset.simple.agentLabel')}
      </label>
      <select id="workbench-simple-agent-select" className="workbench-simple-agent-select rounded-xl border px-3 py-2 text-xs font-semibold"
        value={simpleAgent ?? ''} disabled={isProcessing} aria-label={translate('preset.simple.agentLabel')}
        onChange={(event) => selectSimpleAgent(event.target.value as AIProvider)}>
        {!simpleAgent ? <option value="">{translate(connectionsChecking ? 'connection.stale' : 'preset.simple.noAgent')}</option> : null}
        {simpleAgent && !simpleTargets.length
          ? <option value={simpleAgent}>{AI_PROVIDERS[simpleAgent].name} · {translate(connectionsChecking ? 'connection.stale' : 'connection.notReady')}</option>
          : null}
        {activeProviders.filter((provider) => isSendable(states[provider])).map((provider) => (
          <option key={provider} value={provider}>{AI_PROVIDERS[provider].name}</option>
        ))}
      </select>
      <span className="sr-only">{translate('preset.simple.oneAgentNote')}</span>
    </div>
  ) : null;
  const experienceSwitcher = (
    <div className="workbench-experience-switch inline-flex items-center rounded-full p-1" role="group" aria-label={translate('composer.mode')}>
      {(['chat', 'multi'] as const).map((choice) => (
        <button key={choice} type="button" className={`workbench-experience-option rounded-full px-4 py-1.5 text-xs font-semibold ${(presetId === 'simple' ? 'chat' : 'multi') === choice ? 'workbench-experience-selected' : ''}`}
          aria-pressed={(presetId === 'simple' ? 'chat' : 'multi') === choice}
          disabled={isProcessing} onClick={() => selectExperience(choice)}>
          {translate(choice === 'chat' ? 'composer.chat' : 'composer.multi')}
        </button>
      ))}
    </div>
  );
  const composer = (
    <InputBar
      onSend={send}
      onCancel={cancelWorkflow}
      disabled={noSendableProviders}
      disabledPlaceholder={connectionsChecking ? translate('input.checkingProviders') : undefined}
      projects={projectStore.projects}
      currentProjectId={effectiveProjectStore.activeProjectId ?? undefined}
      projectsDisabled={isProcessing || !projectsReady}
      onChooseProject={(projectId) => {
        const session = sessions.find((item) => item.id === activeSessionId);
        if (session) assignConversationProject(session, projectId);
      }}
      onCreateProject={() => setProjectSettingsOpen(true)}
      sendBlocked={modeSendBlocked}
      blockedMessage={modeBlockedMessage}
      isProcessing={isProcessing}
      locale={locale}
    />
  );
  const multiControls = presetId !== 'simple' ? (
    <div className="workbench-multi-controls mx-auto flex w-full flex-wrap items-center gap-2 px-2 pt-2 text-xs">
      <label className="text-zinc-500 dark:text-zinc-400" htmlFor="workbench-multi-workflow">{translate('composer.workflow')}</label>
      <select id="workbench-multi-workflow" className="workbench-multi-select rounded-lg px-2.5 py-1.5 font-medium"
        value={presetId} disabled={isProcessing} onChange={(event) => selectPreset(event.target.value as WorkflowPresetId)}>
        {PRESET_CATALOG.filter((preset) => preset.id !== 'simple').map((preset) => (
          <option key={preset.id} value={preset.id}>{translate(preset.displayNameKey)}</option>
        ))}
      </select>
      <button type="button" className="workbench-multi-config rounded-lg px-2.5 py-1.5 font-medium" disabled={isProcessing}
        onClick={() => setWorkflowOptionsOpen(true)}>{translate('composer.configureAgents')}</button>
      <span className="ml-auto text-zinc-500 dark:text-zinc-400">{formatI18n(translate('preset.readinessAny'), { ready: anySendableTargets.length })}</span>
    </div>
  ) : null;
  const composerStack = (
    <div className="workbench-composer-stack">
      {composer}
      {presetId === 'simple' ? <div className="workbench-chat-controls px-2 pt-2">{simpleAgentChooser}</div> : multiControls}
    </div>
  );
  return (
    <main className="app-shell workbench-shell h-screen overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div
        ref={gridRef}
        className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)]"
        style={{ gridTemplateColumns: messagesMaximized
          ? '0px 0px minmax(0,1fr)'
          : providerInspectorOpen
            ? focusGridTemplateColumns(effectiveFocusWidth)
            : `${sessionSidebarCollapsed ? '60px' : `${visibleSidebarWidth + 6}px`} 0px minmax(0,1fr)` }}
      >
        <div
          aria-hidden={messagesMaximized || undefined}
          className={`ai-sister-left-shell workbench-left-shell flex min-h-0 min-w-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
            messagesMaximized ? 'invisible overflow-hidden pointer-events-none' : ''
          }`}
        >
          <ConversationSidebar
            width={visibleSidebarWidth}
            brandActive={isProcessing}
            collapsed={sessionSidebarCollapsed}
            sessions={sessions}
            projects={projectStore.projects}
            activeSessionId={readingSession?.id ?? activeSessionId}
            sessionStatuses={runningSessionId ? { [runningSessionId]: 'running' } : undefined}
            disabled={workflowBusy || !projectsReady}
            historyDisabled={!projectsReady}
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
          {!sessionSidebarCollapsed && !messagesMaximized ? (
            <div className="workbench-sidebar-resizer w-[6px] shrink-0">
              <Resizer label={translate('conversation.resizeSidebar')} onDrag={dragSidebar}
                value={visibleSidebarWidth} min={MIN_SIDEBAR_WIDTH} max={sidebarMaxWidth} />
            </div>
          ) : null}
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
                                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="workbench-conversation-title truncate text-xl font-semibold" title={sessions.find((session) => session.id === activeSessionId)?.title ?? translate('workbench.conversation')}>
                    {sessions.find((session) => session.id === activeSessionId)?.title ?? translate('workbench.conversation')}
                  </h1>
                  {isProcessing ? <span className="workbench-header-live flex items-center gap-1.5"><span className="workbench-live-indicator" aria-hidden="true" /> {translate('workbench.live')}</span> : null}
                </div>
              </div>
              <div className="workbench-header-actions flex items-center gap-1.5">
                <button type="button"
                  className={`workbench-icon-button workbench-primary-activity ${activityPanelOpen ? 'workbench-icon-button-selected' : ''}`}
                  title={translate('sidebar.activity')} aria-label={translate('sidebar.activity')}
                  aria-expanded={activityPanelOpen} aria-controls="workbench-activity-drawer"
                  onClick={() => setActivityPanelOpen((open) => !open)}>
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                  {isProcessing ? <span className="workbench-header-activity-dot" aria-hidden="true" /> : null}
                </button>
                <div className="relative" onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setHeaderMoreOpen(false);
                }}>
                  <button type="button" className={`workbench-icon-button ${headerMoreOpen ? 'workbench-icon-button-selected' : ''}`}
                    aria-haspopup="menu" aria-expanded={headerMoreOpen}
                    aria-label={translate('workbench.moreActions')} title={translate('workbench.moreActions')}
                    onClick={() => { setHeaderMoreOpen((open) => !open); setAgentMenuOpen(false); }}>
                    <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" aria-hidden="true" fill="currentColor">
                      <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
                    </svg>
                  </button>
                  {headerMoreOpen ? (
                    <div className="workbench-header-more-menu absolute right-0 top-full z-40 mt-2 min-w-52 space-y-0.5 rounded-xl p-1.5 shadow-xl"
                      role="menu" aria-label={translate('workbench.moreActions')}
                      onKeyDown={(event) => { if (event.key === 'Escape') setHeaderMoreOpen(false); }}>
                      <button type="button" role="menuitem" className="workbench-menu-item"
                        onClick={() => { setHeaderMoreOpen(false); setReplayDrawerOpen((open) => !open); }}
                        aria-expanded={replayDrawerOpen} aria-controls="replay-history-panel">
                        {translate('replay.historyToggle')}
                      </button>
                      <button type="button" role="menuitem" className="workbench-menu-item"
                        onClick={() => { setHeaderMoreOpen(false); void exportConversation(); }}
                        disabled={messages.length === 0 || sharing}>{translate('header.exportMarkdown')}</button>
                      <button type="button" role="menuitem" className="workbench-menu-item"
                        onClick={() => { setHeaderMoreOpen(false); setMessagesMaximized((open) => !open); }}>
                        {translate(messagesMaximized ? 'header.restoreMessages' : 'header.maximizeMessages')}
                      </button>
                      <button type="button" role="menuitem" className="workbench-menu-item"
                        onClick={() => { setHeaderMoreOpen(false); setProviderInspectorOpen((open) => !open); }}>
                        {translate('workbench.providerView')}
                      </button>
                      <button type="button" role="menuitem" className="workbench-menu-item"
                        onClick={() => { setHeaderMoreOpen(false); setSettingsOpen(true); }}>
                        {translate('header.settings')}
                      </button>
                      {import.meta.env.DEV ? (
                        <button type="button" role="menuitem" className="workbench-menu-item"
                          onClick={() => { setHeaderMoreOpen(false); setShowDevDiagnostics((open) => !open); }}>
                          Diagnostics
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="workbench-conversation-header-sub flex flex-wrap items-center gap-2">
              {!readingSession ? experienceSwitcher : null}
              {isProcessing || workflowStatus ? (
                <span className="workbench-conversation-status truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {workflowStatus || translate('processTrace.awaiting')}
                </span>
              ) : null}
            </div>
            <div className="workbench-connected-agent-strip mt-3 flex flex-wrap items-center gap-1.5" aria-label={translate('sidebar.agents')}>
              {activeProviders.map((provider) => {
                const status = agentHeaderStatus(states[provider], appSettings.openProviders.includes(provider), connectionsChecking);
                if (!status) return null;
                const statusLabel = translate(status === 'ready' ? 'connection.ready' : status === 'checking' ? 'connection.stale' : 'connection.noWebview');
                return (
                  <button key={provider} type="button" data-agent-status={status}
                    className="workbench-agent-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                    onClick={() => {
                      if (status === 'ready') openProviderModelSettings(provider);
                      else void openProviderLogin(provider).catch((error: unknown) => setProviderWindowError(error instanceof Error ? error.message : String(error)));
                    }}
                    aria-label={`${AI_PROVIDERS[provider].name}: ${statusLabel}`}
                    title={`${AI_PROVIDERS[provider].name} · ${statusLabel}`}>
                    <span className="workbench-agent-status-dot" aria-hidden="true"/>
                    <span>{AI_PROVIDERS[provider].name}</span>
                    <span className="workbench-agent-status-label">{statusLabel}</span>
                  </button>
                );
              })}
              <div className="relative">
                <button type="button" className="workbench-agent-add rounded-full border px-3 py-1.5 text-xs"
                  aria-haspopup="menu" aria-expanded={agentMenuOpen}
                  onClick={() => setAgentMenuOpen((open) => !open)}>+ {translate('sidebar.addAgent')}</button>
                {agentMenuOpen ? (
                  <div className="workbench-agent-menu absolute left-0 top-full z-30 mt-1 min-w-48 space-y-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" role="menu">
                    {activeProviders.filter((provider) => !agentHeaderStatus(states[provider], appSettings.openProviders.includes(provider), connectionsChecking)).map((provider) => (
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
                  : <div className="space-y-2 p-3 text-sm text-zinc-500 dark:text-zinc-400" role="status">
                       <p>{translate('workbench.activityHint')}</p>
                       <p className="text-xs">{translate('workbench.noActiveRun')}</p>
                     </div>}
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
            {readingSession ? (
              <div className="mb-3 mx-3 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400" role="status">
                Viewing saved conversation · The running workflow continues in its original conversation.
              </div>
            ) : null}
            <ChatArea messages={readingSession ? bubblesFromSession(readingSession) : messages}
              locale={locale} states={states} trace={isProcessing && !readingSession ? processTrace : undefined} />
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
          <div className={`ai-sister-conversation-composer workbench-composer-region shrink-0 border-t border-zinc-200 pt-2 dark:border-zinc-800 ${readingSession ? 'hidden' : ''}`}>
            {composerStack}
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
                // Collaborative workflows have editable role assignments.
                // Simple Chat and Free use the agent/target controls next to
                // the composer, so don't open unrelated global settings.
                if (selected !== 'simple' && selected !== 'free') setSettingsOpen(true);
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
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{translate('composer.clickWorkflowToConfigure')}</p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Connection status and response completion are separate.</p>
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
            {typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) && message.timestamp > 0 && message.timestamp <= 8_640_000_000_000_000 ? (
              <time className="workbench-message-timestamp mt-2 block text-xs text-zinc-500 dark:text-zinc-400"
                dateTime={new Date(message.timestamp).toISOString()}>
                {new Date(message.timestamp).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            ) : null}
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
