import { describe, expect, it } from 'vitest';
import {
  LAST_USED_PRESET_STORAGE_KEY,
  loadLastUsedPreset,
  saveLastUsedPreset,
  type PresetPreferenceStorage,
} from '../ui/lastUsedPresetPreference';

function storage(initial: string | null = null): PresetPreferenceStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      expect(key).toBe(LAST_USED_PRESET_STORAGE_KEY);
      return this.value;
    },
    setItem(key, value) {
      expect(key).toBe(LAST_USED_PRESET_STORAGE_KEY);
      this.value = value;
    },
  };
}

describe('last explicitly used workflow preset', () => {
  it('defaults to the supplied fallback on first launch and restores Consult for the next chat', () => {
    const saved = storage();
    expect(loadLastUsedPreset('simple', saved)).toBe('simple');
    expect(saveLastUsedPreset('consult', saved)).toBe(true);
    expect(loadLastUsedPreset('simple', saved)).toBe('consult');
    expect(saveLastUsedPreset('simple', saved)).toBe(true);
    expect(loadLastUsedPreset('consult', saved)).toBe('simple');
  });

  it('rejects invalid persisted presets and ignores unavailable storage', () => {
    expect(loadLastUsedPreset('debate', storage('bogus'))).toBe('debate');
    expect(saveLastUsedPreset('bogus' as never, storage())).toBe(false);
    const broken: PresetPreferenceStorage = {
      getItem() { throw new Error('unavailable'); },
      setItem() { throw new Error('unavailable'); },
    };
    expect(loadLastUsedPreset('roundtable', broken)).toBe('roundtable');
    expect(saveLastUsedPreset('consult', broken)).toBe(false);
  });
});
