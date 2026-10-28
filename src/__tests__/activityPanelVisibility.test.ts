import { describe, expect, it } from 'vitest';
import { activityPanelAfterSend, activityPanelForSession } from '../ui/activityPanelVisibility';

describe('Activity panel session defaults', () => {
  it('starts closed for empty and restored conversations', () => {
    expect(activityPanelForSession()).toBe(false);
  });

  it('auto-opens on the first accepted prompt even when the chat contains old messages', () => {
    expect(activityPanelAfterSend(false, false)).toBe(true);
    expect(activityPanelAfterSend(true, false)).toBe(true);
  });

  it('preserves a manual Close on later prompts in the same selected conversation', () => {
    expect(activityPanelAfterSend(false, true)).toBe(false);
    expect(activityPanelAfterSend(true, true)).toBe(true);
  });
});
