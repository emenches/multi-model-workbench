import { browserPreferenceStorage, type PreferenceStorage } from './preferenceStorage';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'cogitor:sidebar-width:v1';
export const DEFAULT_SIDEBAR_WIDTH = 304;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 480;

export type SidebarWidthStorage = PreferenceStorage;

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(value)));
}

export function loadSidebarWidth(storage: SidebarWidthStorage | undefined = browserPreferenceStorage()): number {
  if (!storage) return DEFAULT_SIDEBAR_WIDTH;
  try {
    const saved = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (saved === null || saved.trim() === '') return DEFAULT_SIDEBAR_WIDTH;
    return clampSidebarWidth(Number(saved));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function saveSidebarWidth(value: number, storage: SidebarWidthStorage | undefined = browserPreferenceStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(value)));
    return true;
  } catch {
    return false;
  }
}
