import { browserPreferenceStorage, type PreferenceStorage } from './preferenceStorage';

export const SESSION_SIDEBAR_COLLAPSED_STORAGE_KEY = 'multi-ai-chat:session-sidebar-collapsed:v1';

export type SessionSidebarPreferenceStorage = PreferenceStorage;

export function loadSessionSidebarCollapsed(storage: SessionSidebarPreferenceStorage | undefined = browserPreferenceStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SESSION_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSessionSidebarCollapsed(
  collapsed: boolean,
  storage: SessionSidebarPreferenceStorage | undefined = browserPreferenceStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SESSION_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}


