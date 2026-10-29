import type { WorkflowPresetId } from '../../shared/types';
import { PRESET_CATALOG } from './presetCatalogData';

export const LAST_USED_PRESET_STORAGE_KEY = 'multi-ai-chat:last-used-preset:v1';

export interface PresetPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PresetPreferenceStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadLastUsedPreset(
  fallback: WorkflowPresetId = 'simple',
  storage: PresetPreferenceStorage | undefined = defaultStorage(),
): WorkflowPresetId {
  try {
    const value = storage?.getItem(LAST_USED_PRESET_STORAGE_KEY);
    return PRESET_CATALOG.some((preset) => preset.id === value) ? value as WorkflowPresetId : fallback;
  } catch {
    return fallback;
  }
}

export function saveLastUsedPreset(
  preset: WorkflowPresetId,
  storage: PresetPreferenceStorage | undefined = defaultStorage(),
): boolean {
  if (!PRESET_CATALOG.some((entry) => entry.id === preset) || !storage) return false;
  try {
    storage.setItem(LAST_USED_PRESET_STORAGE_KEY, preset);
    return true;
  } catch {
    return false;
  }
}
