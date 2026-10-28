import { describe, expect, it } from 'vitest';
import { activityPanelAfterSend, activityPanelForSession } from '../ui/activityPanelVisibility';

describe('Activity panel session defaults', () => {
  it('stays hidden on an empty new conversation, and appears for existing conversations', () => {
    expect(activityPanelForSession(0)).toBe(false);
    expect(activityPanelForSession(1)).toBe(true);
    expect(activityPanelForSession(14)).toBe(true);
  });

  it('automatically opens when the first prompt starts a chat', () => {
    expect(activityPanelAfterSend(false, 0)).toBe(true);
    expect(activityPanelAfterSend(true, 0)).toBe(true);
  });

  it('respects the user closing Activity after the session has started', () => {
    expect(activityPanelAfterSend(false, 1)).toBe(false);
    expect(activityPanelAfterSend(false, 5)).toBe(false);
    expect(activityPanelAfterSend(true, 5)).toBe(true);
  });
});
