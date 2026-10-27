import type { AIProvider, BridgeMessage, ProviderState } from '../../shared/types';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { onBridgeMessage } from '../bridge/bus';
import type { AdapterNotice } from '../ui/reportBroken';
import type { ProjectStore } from '../workspace/model';

/** Native window and attached provider WebView client geometry, in physical pixels. */
export interface ProviderWindowGeometry {
  windowWidth: number;
  windowHeight: number;
  webviewWidth: number;
  webviewHeight: number;
  webviewX: number;
  webviewY: number;
}


export interface StoredSnapshotInfo {
  id: string;
  graphId?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface NavBlockedPayload {
  provider: string;
  host: string;
}

// CSS px × devicePixelRatio = 實體像素。dpr 已包含 WebView2 頁面縮放
// （Windows「文字大小」會變成 ZoomFactor），Logical 座標會少乘這個縮放而錯位。
const toBounds = (rect: DOMRectReadOnly) => {
  const dpr = globalThis.devicePixelRatio || 1;
  return {
    x: Math.round(rect.x * dpr),
    y: Math.round(rect.y * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  };
};

const SNAPSHOT_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

function safeSnapshotId(snapshotId: string): string {
  if (!SNAPSHOT_ID_RE.test(snapshotId) || snapshotId === '.' || snapshotId === '..') {
    throw new Error('Invalid snapshot id');
  }
  return snapshotId;
}

export const host = {
  app: {
    version: (): Promise<string> => getVersion(),
    openExternal: (url: string): Promise<void> => invoke('open_external_url', { url }),
  },
  onReturnToWorkbench: async (handler: () => void): Promise<() => void> => {
    const unlisten = await listen('workbench://return', () => handler());
    return unlisten;
  },
  onNavBlocked: async (handler: (payload: NavBlockedPayload) => void): Promise<() => void> => {
    const unlisten = await listen<NavBlockedPayload>('nav://blocked', (event) => handler(event.payload));
    return unlisten;
  },
  provider: {
    open: (provider: AIProvider, bounds: DOMRectReadOnly): Promise<ProviderState> =>
      invoke('provider_open', { provider, bounds: toBounds(bounds) }),
    openWindow: (provider: AIProvider, login = false): Promise<ProviderWindowGeometry> =>
      invoke('provider_open_window', { provider, login }),
    close: (provider: AIProvider): Promise<void> => invoke('provider_close', { provider }),
    show: (provider: AIProvider, focus = false): Promise<void> => invoke('provider_show', { provider, focus }),
    hide: (provider: AIProvider): Promise<void> => invoke('provider_hide', { provider }),
    park: async (provider: AIProvider, bounds: DOMRectReadOnly): Promise<void> => {
      // On WKWebView, keeping an offscreen native child *visible* can clamp
      // its view back onto the application and cover React controls. Hide it
      // first, then store fallback bounds while it is not painted.
      // Hidden provider profiles and background scripts remain loaded.
      await invoke('provider_hide', { provider });
      await invoke('provider_set_bounds', { provider, bounds: toBounds(bounds) });
    },
    eval: (provider: AIProvider, js: string): Promise<void> => invoke('provider_eval', { provider, js }),
    evalWithCallback: (provider: AIProvider, js: string): Promise<string> =>
      invoke('provider_eval_with_callback', { provider, js }),
    send: (provider: AIProvider, text: string): Promise<void> =>
      invoke('provider_eval', {
        provider,
        js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
          v: 1,
          action: 'SEND_MESSAGE',
          provider,
          payload: { text },
        })});`,
      }),
    fill: (provider: AIProvider, text: string): Promise<void> =>
      invoke('provider_eval', {
        provider,
        js: `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.dispatch(${JSON.stringify({
          v: 1,
          action: 'FILL_DRAFT',
          provider,
          payload: { text },
        })});`,
      }),
    stop: (provider: AIProvider): Promise<void> =>
      invoke('provider_eval', {
        provider,
        js: "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.stop === 'function' && window.__MAC_ENGINE__.stop();",
      }),
    openLogin: (provider: AIProvider, bounds: DOMRectReadOnly): Promise<void> =>
      invoke('provider_open_login', { provider, bounds: toBounds(bounds) }),
    openLoginExternal: (provider: AIProvider): Promise<void> => invoke('provider_open_login_external', { provider }),
    reload: (provider: AIProvider): Promise<void> => invoke('provider_reload', { provider }),
    reconnect: (provider: AIProvider): Promise<void> => invoke('provider_reload', { provider, reconnect: true }),
    newSession: (provider: AIProvider): Promise<void> => invoke('provider_new_session', { provider }),
  },
  adapter: {
    push: (provider: AIProvider, _cfg: unknown): Promise<void> => invoke('adapter_push', { provider }),
    reportBroken: (provider: AIProvider): Promise<string> => invoke('report_broken', { provider }),
    openIssue: (provider: AIProvider, body: string): Promise<void> =>
      invoke('open_adapter_issue', { provider, body }),
    onNotice: async (handler: (notice: AdapterNotice) => void): Promise<() => void> => {
      const unlisten = await listen<AdapterNotice>('adapter://notice', (event) => handler(event.payload));
      return unlisten;
    },
  },
  connections: {
    get: (): Promise<ProviderState[]> => invoke('connections_get'),
    onUpdate: async (handler: (state: ProviderState) => void): Promise<() => void> => {
      const unlisten = await listen<ProviderState>('connections://update', (event) => handler(event.payload));
      return unlisten;
    },
  },
  layout: {
    setBounds: (provider: AIProvider, rect: DOMRectReadOnly): Promise<void> =>
      invoke('provider_set_bounds', { provider, bounds: toBounds(rect) }),
  },
  bridge: {
    subscribeTitle: async (handler: (message: BridgeMessage) => void): Promise<() => void> => {
      const unlisten = await listen<BridgeMessage>('bridge://msg', (event) => handler(event.payload));
      return unlisten;
    },
    subscribe: async (handler: (message: BridgeMessage) => void): Promise<() => void> =>
      Promise.resolve(onBridgeMessage(handler)),
    onMessage: async (handler: (message: BridgeMessage) => void): Promise<() => void> => {
      return onBridgeMessage(handler);
    },
  },
  dev: {
    /** Dev-only: forward a line to the Rust stdout so headless harness runs can capture it. */
    log: (message: string): Promise<void> => invoke('dev_log', { message }),
  },
  settings: {
    get: (): Promise<unknown> => invoke('settings_get'),
    set: (settings: unknown): Promise<void> => invoke('settings_set', { settings }),
  },
  snapshot: {
    save: async (snapshotId: string, snapshotJson: string): Promise<void> =>
      invoke('snapshot_save', { snapshotId: safeSnapshotId(snapshotId), snapshotJson }),
    list: (): Promise<StoredSnapshotInfo[]> => invoke('snapshot_list'),
    load: async (snapshotId: string): Promise<string | null> =>
      invoke('snapshot_load', { snapshotId: safeSnapshotId(snapshotId) }),
    delete: async (snapshotId: string): Promise<void> => invoke('snapshot_delete', { snapshotId: safeSnapshotId(snapshotId) }),
  },
  projects: {
    load: (): Promise<ProjectStore> => invoke('projects_load'),
    save: (store: ProjectStore): Promise<void> => invoke('projects_save', { store }),
  },
  sessionCheckpoint: {
    save: (json: string): Promise<void> => invoke('session_checkpoint_save', { json }),
    load: (): Promise<string | null> => invoke('session_checkpoint_load'),
    clear: (): Promise<void> => invoke('session_checkpoint_clear'),
  },
  share: {
    exportMarkdown: (suggestedName: string, content: string): Promise<string | null> =>
      invoke('export_markdown', { suggestedName, content }),
  },
};
