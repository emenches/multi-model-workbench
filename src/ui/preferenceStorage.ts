/** Shared, minimal storage contract for local UI preferences. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Browsers may deny localStorage access; callers keep their existing defaults. */
export function browserPreferenceStorage(): PreferenceStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
