import { describe, expect, it } from 'vitest';
import { enableMacGlass, isMacDesktop } from '../ui/macGlass';

describe('macOS-only experimental glass chrome', () => {
  it('recognizes native macOS, not Windows, Linux, iPad or ordinary browsers', () => {
    expect(isMacDesktop('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
    expect(isMacDesktop('MacPPC', 'Other')).toBe(true);
    expect(isMacDesktop('Win32', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false);
    expect(isMacDesktop('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
    expect(isMacDesktop('iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0)')).toBe(false);
  });

  it('only toggles a cosmetic root class, never a native permission or provider view', () => {
    const changes: Array<[string, boolean]> = [];
    const root = {
      classList: {
        toggle(name: string, enabled: boolean) {
          changes.push([name, enabled]);
        },
      },
    } as unknown as HTMLElement;
    enableMacGlass(root, 'MacIntel', 'Macintosh');
    enableMacGlass(root, 'Win32', 'Windows NT');
    expect(changes).toEqual([
      ['cogitor-mac-glass', true],
      ['cogitor-mac-glass', false],
    ]);
  });
});
