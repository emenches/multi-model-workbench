import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/workbench.css'), 'utf8');

describe('Cogitor typography hierarchy', () => {
  it('uses rem sizing for sidebar titles, actions and secondary labels', () => {
    expect(css).toContain('--wb-type-body: 1rem');
    expect(css).toContain('--wb-type-navigation: .875rem');
    expect(css).toContain('--wb-type-meta: .75rem');
    expect(css).toMatch(/\.workbench-session-row \.workbench-session-item > span\s*\{\s*font-size: inherit;/);
    expect(css).toContain('.workbench-sidebar-project > button:first-child');
    expect(css).toContain('min-height: 38px');
  });

  it('covers chat, activity, dialogs and composer without styling provider pages', () => {
    for (const selector of [
      '.workbench-message-content', '.workbench-composer-textarea',
      '.workbench-agent-pill', '.workbench-activity-drawer',
      '.workbench-dialog-backdrop', '.workbench-message-timestamp',
      '.workbench-sidebar-heading',
    ]) expect(css).toContain(selector);
    expect(css).toContain('Prefer specific component selectors rather than overriding all Tailwind');
  });
});
