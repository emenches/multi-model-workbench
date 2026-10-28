import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, loadSidebarWidth, MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH, saveSidebarWidth, SIDEBAR_WIDTH_STORAGE_KEY,
} from '../ui/sidebarWidthPreference';

describe('user-adjustable sidebar width', () => {
  it('defaults to a readable width and clamps unreasonable values', () => {
    expect(loadSidebarWidth({ getItem: () => null, setItem: () => {} })).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(-100)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it('persists valid drag widths without changing chat data', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
    };
    expect(saveSidebarWidth(351.6, storage)).toBe(true);
    expect(data.get(SIDEBAR_WIDTH_STORAGE_KEY)).toBe('352');
    expect(loadSidebarWidth(storage)).toBe(352);
  });

  it('recovers when storage is unavailable', () => {
    const broken = { getItem: (): string => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadSidebarWidth(broken)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(saveSidebarWidth(310, broken)).toBe(false);
  });
});
